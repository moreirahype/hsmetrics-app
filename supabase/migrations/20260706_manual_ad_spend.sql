-- HS Metrics: lançamento manual de gasto com anúncios.
-- Permite usar lucro/ROI/CPA/imposto sem depender da conexão automática com o Meta Ads.
-- As linhas manuais ficam em meta_daily_insights com ad_account_id nulo.

-- Managers podem inserir/editar/apagar linhas do próprio workspace.
drop policy if exists meta_daily_insights_insert_manager on public.meta_daily_insights;
create policy meta_daily_insights_insert_manager on public.meta_daily_insights
  for insert with check (public.can_manage_workspace(workspace_id));

drop policy if exists meta_daily_insights_update_manager on public.meta_daily_insights;
create policy meta_daily_insights_update_manager on public.meta_daily_insights
  for update using (public.can_manage_workspace(workspace_id))
  with check (public.can_manage_workspace(workspace_id));

drop policy if exists meta_daily_insights_delete_manager on public.meta_daily_insights;
create policy meta_daily_insights_delete_manager on public.meta_daily_insights
  for delete using (public.can_manage_workspace(workspace_id));

-- Garante no máximo uma linha de gasto manual por dia (o unique existente não cobre ad_account_id nulo).
create unique index if not exists meta_daily_manual_unique
  on public.meta_daily_insights (workspace_id, date)
  where ad_account_id is null;
