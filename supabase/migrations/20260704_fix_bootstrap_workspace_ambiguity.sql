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
      update public.subscriptions
      set
        provider = pending.provider,
        provider_customer_id = pending.provider_customer_id,
        provider_subscription_id = pending.provider_subscription_id,
        status = pending.status,
        plan = pending.plan,
        current_period_ends_at = pending.current_period_ends_at,
        updated_at = now()
      where public.subscriptions.workspace_id = created_workspace_id;
    end if;

    member_role := 'owner';
  end if;

  bootstrap_workspace.workspace_id := created_workspace_id;
  return next;
end;
$$;

grant execute on function public.bootstrap_workspace(text) to authenticated;
