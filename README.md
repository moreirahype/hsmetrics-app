# HS Metrics App

PWA multiempresa do HS Metrics. O frontend usa Supabase Auth, Postgres com RLS e Edge Functions; não depende de Google Sheets ou Apps Script.

## Estrutura

- `/`: login e criação de conta.
- `/x7p4r9m2/`: painel do dono, protegido por autenticação.
- `/k9v2m7q4/`: painel do atendente, protegido por autenticação e função.
- `supabase/schema.sql`: schema inicial.
- `supabase/migrations/20260629_commercial_foundation.sql`: segurança multiempresa, assinatura, limites e campos comerciais.
- `supabase/migrations/20260629_attendant_invites.sql`: convites e acesso do app da equipe.
- `supabase/functions/sales-webhook`: entrada genérica de vendas.
- `supabase/functions/meta-oauth-*`: conexão com Meta Ads v25.0.
- `supabase/functions/meta-insights-sync`: sincronização de gastos, leads e conversas.
- `supabase/functions/cakto-subscription`: controle de acesso pelos eventos de assinatura da Cakto.

## Implantação do banco

1. Rode `supabase/schema.sql` no SQL Editor do Supabase.
2. Rode `supabase/migrations/20260629_commercial_foundation.sql`.
3. Rode `supabase/migrations/20260629_attendant_invites.sql`.
4. Faça deploy das funções em `supabase/functions`.
5. Configure os segredos das funções: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URL`, `APP_URL`, `SYNC_SECRET`, `CAKTO_WEBHOOK_SECRET`, `CAKTO_START_PRODUCT_ID`, `CAKTO_PRO_PRODUCT_ID` e `CAKTO_SCALE_PRODUCT_ID`.
6. Programe `meta-insights-sync` a cada 15 minutos com o header `Authorization: Bearer <SYNC_SECRET>`.

## Publicação

O app pode ser hospedado no GitHub Pages. Ative `enforceSubscription` em `config.js` somente depois que os três checkouts e o webhook da Cakto estiverem configurados e testados.

Nunca coloque a chave `service_role`, o segredo do Meta ou o segredo da Cakto no frontend.
