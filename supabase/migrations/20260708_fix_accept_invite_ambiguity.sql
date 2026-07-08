-- HS Metrics: corrige "column reference workspace_id is ambiguous" ao aceitar
-- o convite de atendente. O RETURNS TABLE cria colunas de saída chamadas
-- workspace_id/attendant_id que colidiam com as colunas das tabelas usadas no
-- corpo. A correção qualifica todas as referências com alias de tabela.

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

  select ai.* into invitation
  from public.attendant_invites ai
  where ai.token_hash = encode(digest(invite_token, 'sha256'), 'hex')
    and ai.accepted_at is null
    and ai.expires_at > now()
  for update;

  if invitation.id is null then raise exception 'invite_invalid_or_expired'; end if;

  update public.attendants as a
  set user_id = auth.uid(), updated_at = now()
  where a.id = invitation.attendant_id
    and a.workspace_id = invitation.workspace_id
    and a.deleted_at is null;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (invitation.workspace_id, auth.uid(), 'attendant')
  on conflict on constraint workspace_members_pkey do update set role = 'attendant';

  update public.attendant_invites as ai
  set accepted_by = auth.uid(), accepted_at = now()
  where ai.id = invitation.id;

  return query select invitation.workspace_id, invitation.attendant_id, 'attendant'::text;
end;
$$;

revoke all on function public.accept_attendant_invite(text) from public;
grant execute on function public.accept_attendant_invite(text) to authenticated;
