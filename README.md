# HS Metrics App

PWA multiempresa do HS Metrics. O frontend usa Supabase Auth, Postgres com RLS e Edge Functions; não depende de Google Sheets ou Apps Script.

## Estrutura

- `/`: login e criação de conta.
- `/painel/`: painel do dono, protegido por autenticação.
- `/equipe/`: painel do atendente, protegido por autenticação e função.
- `supabase/schema.sql`: schema inicial.
- `supabase/migrations/20260629_commercial_foundation.sql`: segurança multiempresa, assinatura, limites e campos comerciais.
- `supabase/migrations/20260629_attendant_invites.sql`: convites e acesso do app da equipe.
- `supabase/migrations/20260704_*.sql`: correções de bootstrap e convites de compra.
- `supabase/migrations/20260705_plan_limits_and_workspaces.sql`: limites por plano no servidor (vendas, equipe, contas de anúncio, negócios) e criação de negócios extras.
- `supabase/functions/sales-webhook`: entrada genérica de vendas (aceita múltiplos tokens por workspace) + push de venda.
- `supabase/functions/notify-sale`: push de venda para lançamentos manuais.
- `supabase/functions/push-dispatch`: notificações de relatório nos horários configurados (Pro/Scale).
- `supabase/functions/meta-oauth-*`: conexão com Meta Ads v25.0 (respeita o limite de contas do plano).
- `supabase/functions/meta-insights-sync`: sincronização de gastos, leads e conversas.
- `supabase/functions/cakto-subscription`: controle de acesso pelos eventos de assinatura da Cakto.

## Implantação do banco

1. Rode `supabase/schema.sql` no SQL Editor do Supabase.
2. Rode as migrations de `supabase/migrations` em ordem cronológica (incluindo `20260705_plan_limits_and_workspaces.sql`).
3. Faça deploy das funções em `supabase/functions` (incluindo `notify-sale` e `push-dispatch`).
4. Configure os segredos das funções: `META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URL`, `APP_URL`, `SYNC_SECRET`, `CAKTO_WEBHOOK_SECRET`, `PUSH_API_URL` (URL do deploy do hsmetrics-push na Vercel) e `PUSH_API_SECRET` (mesmo valor do env da Vercel).
5. Programe `meta-insights-sync` a cada 15 minutos com o header `Authorization: Bearer <SYNC_SECRET>`.
6. Programe `push-dispatch` de hora em hora (minuto 0) com o mesmo header — é ela que envia as notificações de relatório dos planos Pro/Scale:

```sql
select cron.schedule('hsmetrics-push-dispatch', '0 * * * *', $$
  select net.http_post(
    url := 'https://szhpfircnpazmbhiuypc.supabase.co/functions/v1/push-dispatch',
    headers := jsonb_build_object('Authorization', 'Bearer ' || 'SEU_SYNC_SECRET', 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
$$);
```

## Notificações push

O `config.js` aponta para o backend `hsmetrics-push` na Vercel (`pushApiUrl`) com a chave pública VAPID. Confirme:

1. A URL do deploy na Vercel (ajuste `pushApiUrl` se o domínio for outro).
2. Na Vercel: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `PUSH_API_SECRET`, `ALLOWED_ORIGINS=https://app.hsmetrics.com.br` e as variáveis do Upstash Redis.
3. No Supabase (segredos das funções): `PUSH_API_URL` e `PUSH_API_SECRET`.

As audiências agora são por workspace/atendente (`owner-<workspace_id>` e `att-<attendant_id>`), então cada cliente recebe apenas as próprias notificações.

## Assinaturas Cakto

O produto pode ter as três ofertas (Start, Pro e Scale). Cadastre um único webhook para o produto:

`https://szhpfircnpazmbhiuypc.supabase.co/functions/v1/cakto-subscription?secret=SEU_SEGREDO`

O segredo na URL deve ser exatamente o mesmo valor cadastrado em `CAKTO_WEBHOOK_SECRET` no Supabase. O campo **Chave secreta do webhook** da Cakto pode permanecer preenchido, mas a autenticação do HS Metrics usa o segredo aleatório da URL.

Selecione os eventos de compra aprovada, renovação/recorrência, cancelamento, reembolso e chargeback disponíveis no painel. O backend identifica o plano pelo checkout usado:

- Start: `https://pay.cakto.com.br/h4r62s7_952771`
- Pro: `https://pay.cakto.com.br/oixhyin`
- Scale: `https://pay.cakto.com.br/tqkptgd`

Os IDs de oferta (`CAKTO_*_OFFER_ID`) continuam aceitos como alternativa, mas não são necessários para esses três checkouts.

## Publicação

O app pode ser hospedado no GitHub Pages. Ative `enforceSubscription` em `config.js` somente depois que os três checkouts e o webhook da Cakto estiverem configurados e testados.

Nunca coloque a chave `service_role`, o segredo do Meta ou o segredo da Cakto no frontend.
