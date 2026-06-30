-- Secure, one-time links that connect an authenticated user to an attendant.

create table if not exists public.attendant_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  attendant_id uuid not null references public.attendants(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.attendant_invites enable row level security;

drop policy if exists attendant_invites_select_manager on public.attendant_invites;
create policy attendant_invites_select_manager on public.attendant_invites
  for select using (public.can_manage_workspace(workspace_id));

drop policy if exists attendant_invites_insert_manager on public.attendant_invites;
create policy attendant_invites_insert_manager on public.attendant_invites
  for insert with check (public.can_manage_workspace(workspace_id));

drop policy if exists attendant_invites_delete_manager on public.attendant_invites;
create policy attendant_invites_delete_manager on public.attendant_invites
  for delete using (public.can_manage_workspace(workspace_id));

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
begin
  select * into target_attendant
  from public.attendants
  where id = target_attendant_id
    and deleted_at is null
    and active = true;

  if target_attendant.id is null or not public.can_manage_workspace(target_attendant.workspace_id) then
    raise exception 'attendant_not_found';
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

create or replace function public.accept_attendant_invite(invite_token text)
returns table (workspace_id uuid, attendant_id uuid, member_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.attendant_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  select * into invitation
  from public.attendant_invites
  where token_hash = encode(digest(invite_token, 'sha256'), 'hex')
    and accepted_at is null
    and expires_at > now()
  for update;

  if invitation.id is null then raise exception 'invite_invalid_or_expired'; end if;

  update public.attendants
  set user_id = auth.uid(), updated_at = now()
  where id = invitation.attendant_id
    and workspace_id = invitation.workspace_id
    and deleted_at is null;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (invitation.workspace_id, auth.uid(), 'attendant')
  on conflict (workspace_id, user_id) do update set role = 'attendant';

  update public.attendant_invites
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invitation.id;

  return query select invitation.workspace_id, invitation.attendant_id, 'attendant'::text;
end;
$$;

revoke all on function public.create_attendant_invite(uuid) from public;
grant execute on function public.create_attendant_invite(uuid) to authenticated;
revoke all on function public.accept_attendant_invite(text) from public;
grant execute on function public.accept_attendant_invite(text) to authenticated;
