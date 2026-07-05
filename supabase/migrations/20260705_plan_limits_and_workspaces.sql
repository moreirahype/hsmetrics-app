-- HS Metrics: limites por plano no servidor + múltiplos negócios por dono.
-- Rode após 20260704_fix_bootstrap_workspace_ambiguity.sql.

-- Limites comerciais de cada plano (espelham a landing page).
create or replace function public.plan_limits(plan_name text)
returns table (
  sales_limit integer,
  workspace_limit integer,
  ad_account_limit integer,
  webhook_limit integer,
  team_limit integer
)
language sql
immutable
as $$
  select limits.sales_limit, limits.workspace_limit, limits.ad_account_limit, limits.webhook_limit, limits.team_limit
  from (values
    ('start', 300, 1, 1, 1, 0),
    ('pro', 2000, 3, 3, 3, 3),
    ('scale', 10000, 10, 10, 10, 10)
  ) as limits(plan, sales_limit, workspace_limit, ad_account_limit, webhook_limit, team_limit)
  where limits.plan = lower(coalesce(plan_name, ''));
$$;

-- O workspace mais antigo do dono carrega a assinatura que vale para todos os negócios dele.
create or replace function public.owner_root_workspace_id(target_workspace_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select w2.id
  from public.workspaces w1
  join public.workspaces w2 on w2.owner_id = w1.owner_id
  where w1.id = target_workspace_id
  order by w2.created_at asc
  limit 1;
$$;

create or replace function public.owner_subscription(target_workspace_id uuid)
returns public.subscriptions
language sql
stable
security definer
set search_path = public
as $$
  select s.*
  from public.subscriptions s
  where s.workspace_id = public.owner_root_workspace_id(target_workspace_id)
  limit 1;
$$;

-- Criação de negócios adicionais respeitando o limite do plano.
create or replace function public.create_workspace(workspace_name text default 'Novo negócio')
returns table (workspace_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_record public.subscriptions;
  limits record;
  owned_count integer;
  created_id uuid;
  root_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select w.id into root_id
  from public.workspaces w
  where w.owner_id = auth.uid()
  order by w.created_at asc
  limit 1;

  if root_id is null then
    raise exception 'workspace_not_found';
  end if;

  select * into subscription_record from public.owner_subscription(root_id);
  if subscription_record.id is null or subscription_record.status is distinct from 'active' then
    raise exception 'subscription_inactive';
  end if;

  select * into limits from public.plan_limits(subscription_record.plan);
  if limits.workspace_limit is null then
    raise exception 'subscription_plan_invalid';
  end if;

  select count(*) into owned_count
  from public.workspaces w
  where w.owner_id = auth.uid();

  if owned_count >= limits.workspace_limit then
    raise exception 'workspace_limit_reached';
  end if;

  insert into public.workspaces (owner_id, name)
  values (auth.uid(), coalesce(nullif(trim(workspace_name), ''), 'Novo negócio'))
  returning id into created_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (created_id, auth.uid(), 'owner');

  workspace_id := created_id;
  return next;
end;
$$;

revoke all on function public.create_workspace(text) from public;
grant execute on function public.create_workspace(text) to authenticated;

-- Limite mensal de vendas: soma as vendas aprovadas de TODOS os negócios do dono
-- e usa a assinatura do workspace raiz (vale também para negócios extras).
create or replace function public.enforce_monthly_sales_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_record public.subscriptions;
  limits record;
  used_sales bigint;
  owner_user uuid;
begin
  if new.status <> 'approved' then return new; end if;

  select * into subscription_record from public.owner_subscription(new.workspace_id);

  if subscription_record.status is distinct from 'active' then
    raise exception 'subscription_inactive';
  end if;
  if subscription_record.current_period_ends_at is not null
     and subscription_record.current_period_ends_at < now() then
    raise exception 'subscription_expired';
  end if;

  select * into limits from public.plan_limits(subscription_record.plan);
  if limits.sales_limit is null then raise exception 'subscription_plan_invalid'; end if;

  select w.owner_id into owner_user from public.workspaces w where w.id = new.workspace_id;

  select count(*) into used_sales
  from public.transactions t
  join public.workspaces w on w.id = t.workspace_id
  where w.owner_id = owner_user
    and t.status = 'approved'
    and t.occurred_at >= date_trunc('month', new.occurred_at)
    and t.occurred_at < date_trunc('month', new.occurred_at) + interval '1 month';

  if used_sales >= limits.sales_limit then raise exception 'monthly_sales_limit_reached'; end if;
  return new;
end;
$$;

drop trigger if exists transactions_plan_limit_trigger on public.transactions;
create trigger transactions_plan_limit_trigger
  before insert on public.transactions
  for each row execute function public.enforce_monthly_sales_limit();

-- Limite de usuários da equipe por plano, verificado ao gerar o convite.
create or replace function public.create_attendant_invite(target_attendant_id uuid)
returns table (invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_attendant public.attendants%rowtype;
  raw_token text;
  invite_expiry timestamptz := now() + interval '30 days';
  subscription_record public.subscriptions;
  limits record;
  team_count integer;
  owner_user uuid;
begin
  select * into target_attendant
  from public.attendants
  where id = target_attendant_id
    and deleted_at is null
    and active = true;

  if target_attendant.id is null or not public.can_manage_workspace(target_attendant.workspace_id) then
    raise exception 'attendant_not_found';
  end if;

  select * into subscription_record from public.owner_subscription(target_attendant.workspace_id);
  select * into limits from public.plan_limits(subscription_record.plan);
  if coalesce(limits.team_limit, 0) < 1 then
    raise exception 'team_limit_reached';
  end if;

  -- Conta acessos já vinculados em todos os negócios do dono (sem contar este atendente).
  select w.owner_id into owner_user from public.workspaces w where w.id = target_attendant.workspace_id;
  select count(*) into team_count
  from public.attendants a
  join public.workspaces w on w.id = a.workspace_id
  where w.owner_id = owner_user
    and a.user_id is not null
    and a.deleted_at is null
    and a.id <> target_attendant.id;

  if team_count >= limits.team_limit then
    raise exception 'team_limit_reached';
  end if;

  delete from public.attendant_invites
  where attendant_id = target_attendant.id
    and accepted_at is null;

  raw_token := encode(gen_random_bytes(24), 'hex');
  insert into public.attendant_invites (
    workspace_id, attendant_id, token_hash, created_by, expires_at
  ) values (
    target_attendant.workspace_id,
    target_attendant.id,
    encode(digest(raw_token, 'sha256'), 'hex'),
    auth.uid(),
    invite_expiry
  );

  return query select raw_token, invite_expiry;
end;
$$;

revoke all on function public.create_attendant_invite(uuid) from public;
grant execute on function public.create_attendant_invite(uuid) to authenticated;

-- Limite de contas de anúncio ativas por plano (ao reativar manualmente).
create or replace function public.enforce_ad_account_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_record public.subscriptions;
  limits record;
  active_count integer;
  owner_user uuid;
begin
  if new.active is distinct from true then return new; end if;
  if tg_op = 'UPDATE' and old.active = true then return new; end if;

  select * into subscription_record from public.owner_subscription(new.workspace_id);
  select * into limits from public.plan_limits(subscription_record.plan);
  if limits.ad_account_limit is null then return new; end if;

  select w.owner_id into owner_user from public.workspaces w where w.id = new.workspace_id;
  select count(*) into active_count
  from public.ad_accounts a
  join public.workspaces w on w.id = a.workspace_id
  where w.owner_id = owner_user
    and a.active = true
    and a.id <> new.id;

  if active_count >= limits.ad_account_limit then
    raise exception 'ad_account_limit_reached';
  end if;
  return new;
end;
$$;

drop trigger if exists ad_accounts_plan_limit_trigger on public.ad_accounts;
create trigger ad_accounts_plan_limit_trigger
  before insert or update of active on public.ad_accounts
  for each row execute function public.enforce_ad_account_limit();
