-- HS Metrics: corrige "function gen_random_bytes(integer) does not exist".
-- No Supabase o pgcrypto fica no schema "extensions"; as funções de convite
-- usavam search_path = public e não encontravam gen_random_bytes/digest.
-- A correção inclui "extensions" no search_path das funções afetadas.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.create_attendant_invite(target_attendant_id uuid)
returns table (invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
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

create or replace function public.accept_attendant_invite(invite_token text)
returns table (workspace_id uuid, attendant_id uuid, member_role text)
language plpgsql
security definer
set search_path = public, extensions
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

revoke all on function public.accept_attendant_invite(text) from public;
grant execute on function public.accept_attendant_invite(text) to authenticated;
