-- HS Metrics - schema inicial Supabase
-- Rode este arquivo no Supabase em SQL Editor > New query.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  metric_base text not null default 'leads' check (metric_base in ('leads', 'conversations')),
  meta_tax_rate numeric(8,6) not null default 0.1383,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'attendant')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'cakto',
  provider_customer_id text,
  provider_subscription_id text,
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  plan text,
  current_period_ends_at timestamptz,
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  external_ref text,
  fixed_cost_brl numeric(14,2) not null default 0,
  percent_cost numeric(8,4) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  slug text not null,
  commission_percent numeric(8,4) not null default 0,
  monthly_fixed_brl numeric(14,2) not null default 0,
  manual_sales_enabled boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null default 'meta',
  external_id text not null,
  name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  attendant_id uuid references public.attendants(id) on delete set null,
  external_id text,
  source text not null default 'manual',
  occurred_at timestamptz not null default now(),
  payer_name text,
  payer_phone text,
  currency text not null default 'BRL',
  gross_amount_brl numeric(14,2) not null default 0,
  original_currency text not null default 'BRL',
  original_amount numeric(14,2) not null default 0,
  exchange_rate_brl numeric(14,6) not null default 1,
  product_fixed_cost_brl numeric(14,2) not null default 0,
  product_percent_cost numeric(8,4) not null default 0,
  product_cost_brl numeric(14,2) generated always as (
    round(product_fixed_cost_brl + gross_amount_brl * product_percent_cost / 100, 2)
  ) stored,
  is_front_sale boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  unique (workspace_id, external_id)
);

create table if not exists public.meta_daily_insights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_account_id uuid references public.ad_accounts(id) on delete cascade,
  date date not null,
  spend_brl numeric(14,2) not null default 0,
  leads integer not null default 0,
  conversations integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, ad_account_id, date)
);

create table if not exists public.attendant_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attendant_id uuid not null references public.attendants(id) on delete cascade,
  title text not null default 'Meta',
  target_brl numeric(14,2) not null,
  prize text,
  active boolean not null default true,
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  audience text not null default 'owner' check (audience in ('owner', 'attendant')),
  sale_notifications_enabled boolean not null default true,
  report_notifications_enabled boolean not null default true,
  report_times text[] not null default array['08:00','12:00','18:00','23:00'],
  report_style text not null default 'detailed' check (report_style in ('profit_status', 'detailed', 'creative')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, audience)
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null,
  status text not null default 'pending' check (status in ('pending', 'active', 'error', 'disabled')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.subscriptions enable row level security;
alter table public.products enable row level security;
alter table public.attendants enable row level security;
alter table public.ad_accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.meta_daily_insights enable row level security;
alter table public.attendant_goals enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.integrations enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check (id = auth.uid());

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces for select using (public.is_workspace_member(id));
drop policy if exists "workspaces_insert_owner" on public.workspaces;
create policy "workspaces_insert_owner" on public.workspaces for insert with check (owner_id = auth.uid());
drop policy if exists "workspaces_update_member" on public.workspaces;
create policy "workspaces_update_member" on public.workspaces for update using (public.is_workspace_member(id));

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member" on public.workspace_members for select using (public.is_workspace_member(workspace_id));
drop policy if exists "workspace_members_insert_owner" on public.workspace_members;
create policy "workspace_members_insert_owner" on public.workspace_members for insert with check (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);
drop policy if exists "workspace_members_update_owner" on public.workspace_members;
create policy "workspace_members_update_owner" on public.workspace_members for update using (
  exists (select 1 from public.workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'subscriptions',
    'products',
    'attendants',
    'ad_accounts',
    'transactions',
    'meta_daily_insights',
    'attendant_goals',
    'notification_preferences',
    'integrations'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_select_member', table_name);
    execute format('create policy %I on public.%I for select using (public.is_workspace_member(workspace_id))', table_name || '_select_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_insert_member', table_name);
    execute format('create policy %I on public.%I for insert with check (public.is_workspace_member(workspace_id))', table_name || '_insert_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_update_member', table_name);
    execute format('create policy %I on public.%I for update using (public.is_workspace_member(workspace_id))', table_name || '_update_member', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_delete_member', table_name);
    execute format('create policy %I on public.%I for delete using (public.is_workspace_member(workspace_id))', table_name || '_delete_member', table_name);
  end loop;
end $$;

create index if not exists transactions_workspace_occurred_at_idx on public.transactions(workspace_id, occurred_at desc);
create index if not exists transactions_workspace_payer_idx on public.transactions(workspace_id, payer_phone, payer_name);
create index if not exists meta_daily_workspace_date_idx on public.meta_daily_insights(workspace_id, date desc);
create index if not exists products_workspace_active_idx on public.products(workspace_id, active);
create index if not exists attendants_workspace_active_idx on public.attendants(workspace_id, active);
