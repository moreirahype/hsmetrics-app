-- HS Metrics: exclusão de negócios (workspaces) pelo dono.
-- Regras: só o dono exclui; o negócio principal (mais antigo, que carrega a
-- assinatura) nunca pode ser excluído. A exclusão cascateia vendas, produtos,
-- atendentes, metas e integrações daquele negócio.

create or replace function public.delete_workspace(target_workspace_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  root_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;

  if not exists (
    select 1 from public.workspaces w
    where w.id = target_workspace_id and w.owner_id = auth.uid()
  ) then
    raise exception 'not_owner';
  end if;

  -- Negócio principal = o mais antigo do dono; guarda a assinatura, não pode sair.
  select w.id into root_id
  from public.workspaces w
  where w.owner_id = auth.uid()
  order by w.created_at asc
  limit 1;

  if target_workspace_id = root_id then
    raise exception 'cannot_delete_main_workspace';
  end if;

  delete from public.workspaces where id = target_workspace_id;
end;
$$;

revoke all on function public.delete_workspace(uuid) from public;
grant execute on function public.delete_workspace(uuid) to authenticated;
