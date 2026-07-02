-- HS Metrics: production multi-tenant foundation.
-- Run after supabase/schema.sql.

alter table public.workspaces
  add column if not exists lead_metric_source text not null default 'conversations'
    check (lead_metric_source in ('leads', 'conversations')),
  add column if not exists subtract_attendant_commission boolean not null default false,
  add column if not exists subtract_attendant_fixed boolean not null default false,
  add column if not exists show_refund_metrics boolean not null default false;

alter table public.products
  add column if not exists is_front boolean not null default false,
  add column if not exists deleted_at timestamptz;

alter table public.attendants
  add column if not exists started_on date,
  add column if not exists pauses text not null default '',
  add column if not exists deleted_at timestamptz;

alter table public.transactions
  add column if not exists product_name text,
  add column if not exists attendant_name text,
  add column if not exists status text not null default 'approved'
    check (status in ('approved', 'refunded', 'chargeback')),
  add column if not exists refunded_amount_brl numeric(14,2) not null default 0,
  add column if not exists ad_account_id uuid references public.ad_accounts(id) on delete set null;

alter table public.notification_preferences
  add column if not exists show_attendant boolean not null default true;

alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('pending', 'active', 'past_due', 'canceled', 'expired'));

create table if not exists public.integration_secrets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  secrets jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, provider)
);

create table if not exists public.oauth_states (
  state text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pending_entitlements (
  email text primary key,
  provider text not null default 'cakto',
  provider_customer_id text,
  provider_subscription_id text,
  status text not null,
  plan text not null,
  current_period_ends_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.integration_secrets enable row level security;
alter table public.oauth_states enable row level security;
alter table public.pending_entitlements enable row level security;
revoke all on public.integration_secrets from anon, authenticated;
revoke all on public.oauth_states from anon, authenticated;
revoke all on public.pending_entitlements from anon, authenticated;

create unique index if not exists products_workspace_name_unique
  on public.products (workspace_id, lower(name))
  where deleted_at is null;

create unique index if not exists attendants_workspace_name_unique
  on public.attendants (workspace_id, lower(name))
  where deleted_at is null;

create unique index if not exists subscriptions_workspace_unique
  on public.subscriptions (workspace_id);

create or replace function public.workspace_role(target_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.workspace_role(target_workspace_id) in ('owner', 'admin'), false);
$$;

create or replace function public.bootstrap_workspace(workspace_name text default 'Meu negócio')
returns table (workspace_id uuid, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  created_workspace_id uuid;
  pending record;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select wm.workspace_id, wm.role
    into created_workspace_id, member_role
  from public.workspace_members wm
  where wm.user_id = auth.uid()
  order by wm.created_at
  limit 1;

  if created_workspace_id is null then
    insert into public.profiles (id, email, name)
    values (
      auth.uid(),
      coalesce(auth.jwt() ->> 'email', ''),
      coalesce(auth.jwt() -> 'user_metadata' ->> 'name', '')
    )
    on conflict (id) do update set
      email = excluded.email,
      name = coalesce(nullif(excluded.name, ''), public.profiles.name),
      updated_at = now();

    insert into public.workspaces (owner_id, name)
    values (auth.uid(), coalesce(nullif(trim(workspace_name), ''), 'Meu negócio'))
    returning id into created_workspace_id;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (created_workspace_id, auth.uid(), 'owner');

    insert into public.subscriptions (workspace_id, provider, status, plan)
    values (created_workspace_id, 'cakto', 'pending', 'start');

    select * into pending
    from public.pending_entitlements pe
    where lower(pe.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    limit 1;

    if pending.email is not null then
      update public.subscriptions set
        provider = pending.provider,
        provider_customer_id = pending.provider_customer_id,
        provider_subscription_id = pending.provider_subscription_id,
        status = pending.status,
        plan = pending.plan,
        current_period_ends_at = pending.current_period_ends_at,
        updated_at = now()
      where workspace_id = created_workspace_id;
    end if;

    member_role := 'owner';
  end if;

  workspace_id := created_workspace_id;
  return next;
end;
$$;

grant execute on function public.bootstrap_workspace(text) to authenticated;

-- Replace the broad member-write policies from the initial prototype.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'subscriptions', 'products', 'attendants', 'ad_accounts', 'transactions',
    'meta_daily_insights', 'attendant_goals', 'notification_preferences', 'integrations'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_member', table_name);
  end loop;
end $$;

drop policy if exists workspaces_update_member on public.workspaces;
create policy workspaces_update_manager on public.workspaces
  for update using (public.can_manage_workspace(id))
  with check (public.can_manage_workspace(id));

drop policy if exists workspace_members_update_owner on public.workspace_members;
create policy workspace_members_update_manager on public.workspace_members
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));
drop policy if exists workspace_members_delete_manager on public.workspace_members;
create policy workspace_members_delete_manager on public.workspace_members
  for delete using (public.can_manage_workspace(workspace_id));

create policy subscriptions_select_manager on public.subscriptions
  for select using (public.can_manage_workspace(workspace_id));

create policy products_select_member on public.products
  for select using (public.is_workspace_member(workspace_id));
create policy products_insert_manager on public.products
  for insert with check (public.can_manage_workspace(workspace_id));
create policy products_update_manager on public.products
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));
create policy products_delete_manager on public.products
  for delete using (public.can_manage_workspace(workspace_id));

create policy attendants_select_workspace on public.attendants
  for select using (
    public.can_manage_workspace(workspace_id)
    or user_id = auth.uid()
  );
create policy attendants_insert_manager on public.attendants
  for insert with check (public.can_manage_workspace(workspace_id));
create policy attendants_update_manager on public.attendants
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));
create policy attendants_delete_manager on public.attendants
  for delete using (public.can_manage_workspace(workspace_id));

create policy transactions_select_scoped on public.transactions
  for select using (
    public.can_manage_workspace(workspace_id)
    or exists (
      select 1 from public.attendants a
      where a.id = attendant_id
        and a.user_id = auth.uid()
    )
  );
create policy transactions_insert_scoped on public.transactions
  for insert with check (
    public.can_manage_workspace(workspace_id)
    or exists (
      select 1 from public.attendants a
      where a.id = attendant_id
        and a.user_id = auth.uid()
        and a.manual_sales_enabled
        and a.deleted_at is null
    )
  );
create policy transactions_update_manager on public.transactions
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));
create policy transactions_delete_manager on public.transactions
  for delete using (public.can_manage_workspace(workspace_id));

create policy attendant_goals_select_scoped on public.attendant_goals
  for select using (
    public.can_manage_workspace(workspace_id)
    or exists (
      select 1 from public.attendants a
      where a.id = attendant_id and a.user_id = auth.uid()
    )
  );
create policy attendant_goals_insert_manager on public.attendant_goals
  for insert with check (public.can_manage_workspace(workspace_id));
create policy attendant_goals_update_manager on public.attendant_goals
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));
create policy attendant_goals_delete_manager on public.attendant_goals
  for delete using (public.can_manage_workspace(workspace_id));

create policy ad_accounts_manager on public.ad_accounts
  for all using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));
create policy meta_daily_insights_select_member on public.meta_daily_insights
  for select using (public.is_workspace_member(workspace_id));

create policy notification_preferences_scoped on public.notification_preferences
  for all using (
    public.can_manage_workspace(workspace_id)
    or user_id = auth.uid()
  ) with check (
    public.can_manage_workspace(workspace_id)
    or user_id = auth.uid()
  );

create policy integrations_manager on public.integrations
  for all using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

create index if not exists transactions_workspace_status_idx
  on public.transactions (workspace_id, status, occurred_at desc);

create or replace function public.enforce_monthly_sales_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subscription_record record;
  plan_limit integer;
  used_sales bigint;
begin
  if new.status <> 'approved' then return new; end if;

  select status, plan, current_period_ends_at
    into subscription_record
  from public.subscriptions
  where workspace_id = new.workspace_id
  limit 1;

  if subscription_record.status is distinct from 'active' then
    raise exception 'subscription_inactive';
  end if;
  if subscription_record.current_period_ends_at is not null
     and subscription_record.current_period_ends_at < now() then
    raise exception 'subscription_expired';
  end if;

  plan_limit := case subscription_record.plan
    when 'start' then 300
    when 'pro' then 2000
    when 'scale' then 10000
    else 0
  end;
  if plan_limit = 0 then raise exception 'subscription_plan_invalid'; end if;

  select count(*) into used_sales
  from public.transactions
  where workspace_id = new.workspace_id
    and status = 'approved'
    and occurred_at >= date_trunc('month', new.occurred_at)
    and occurred_at < date_trunc('month', new.occurred_at) + interval '1 month';

  if used_sales >= plan_limit then raise exception 'monthly_sales_limit_reached'; end if;
  return new;
end;
$$;

drop trigger if exists transactions_plan_limit_trigger on public.transactions;
create trigger transactions_plan_limit_trigger
  before insert on public.transactions
  for each row execute function public.enforce_monthly_sales_limit();
