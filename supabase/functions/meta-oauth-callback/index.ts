import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function redirect(appUrl: string, status: string, detail = "") {
  const target = new URL("./painel/#integrations", appUrl.endsWith("/") ? appUrl : `${appUrl}/`);
  target.searchParams.set("meta", status);
  if (detail) target.searchParams.set("detail", detail);
  return Response.redirect(target.toString(), 302);
}

Deno.serve(async (request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const appUrl = Deno.env.get("APP_URL") || "https://app.hsmetrics.com.br/";
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state") || "";
  const code = requestUrl.searchParams.get("code") || "";
  if (!state || !code) return redirect(appUrl, "error", "Resposta incompleta do Meta.");

  try {
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });
    const { data: states, error: stateError } = await service
      .from("oauth_states")
      .select("*")
      .eq("state", state)
      .eq("provider", "meta")
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (stateError) throw stateError;
    const storedState = states?.[0];
    if (!storedState) return redirect(appUrl, "error", "Conexao expirada. Tente novamente.");

    const redirectUri = Deno.env.get("META_REDIRECT_URL") || `${supabaseUrl}/functions/v1/meta-oauth-callback`;
    const tokenUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", Deno.env.get("META_APP_ID") || "");
    tokenUrl.searchParams.set("client_secret", Deno.env.get("META_APP_SECRET") || "");
    tokenUrl.searchParams.set("redirect_uri", redirectUri);
    tokenUrl.searchParams.set("code", code);
    const tokenResponse = await fetch(tokenUrl);
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.access_token) throw new Error(tokenPayload?.error?.message || "Meta nao retornou um token valido.");

    // O token do code é de curta duração (~1-2h). Troca por um de longa duração
    // (~60 dias) para que a sincronização diária de gastos continue funcionando.
    let accessToken = tokenPayload.access_token as string;
    try {
      const exchangeUrl = new URL("https://graph.facebook.com/v25.0/oauth/access_token");
      exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
      exchangeUrl.searchParams.set("client_id", Deno.env.get("META_APP_ID") || "");
      exchangeUrl.searchParams.set("client_secret", Deno.env.get("META_APP_SECRET") || "");
      exchangeUrl.searchParams.set("fb_exchange_token", accessToken);
      const exchangeResponse = await fetch(exchangeUrl);
      const exchangePayload = await exchangeResponse.json();
      if (exchangeResponse.ok && exchangePayload.access_token) {
        accessToken = exchangePayload.access_token;
      } else {
        console.warn("Falha ao obter token de longa duracao, usando o curto", exchangePayload?.error?.message);
      }
    } catch (exchangeError) {
      console.warn("Erro ao trocar por token de longa duracao", exchangeError);
    }

    const accountsUrl = new URL("https://graph.facebook.com/v25.0/me/adaccounts");
    accountsUrl.searchParams.set("fields", "id,name,account_status");
    accountsUrl.searchParams.set("limit", "200");
    accountsUrl.searchParams.set("access_token", accessToken);
    const accountsResponse = await fetch(accountsUrl);
    const accountsPayload = await accountsResponse.json();
    if (!accountsResponse.ok) throw new Error(accountsPayload?.error?.message || "Nao foi possivel listar as contas de anuncio.");

    const { error: secretError } = await service.from("integration_secrets").upsert({
      workspace_id: storedState.workspace_id,
      provider: "meta",
      secrets: { access_token: accessToken },
      updated_at: new Date().toISOString()
    }, { onConflict: "workspace_id,provider" });
    if (secretError) throw secretError;

    // Respeita o limite de contas ativas do plano (Start 1, Pro 3, Scale 10).
    const { data: limitRows } = await service.rpc("owner_subscription", { target_workspace_id: storedState.workspace_id });
    const subscription = Array.isArray(limitRows) ? limitRows[0] : limitRows;
    const planLimits: Record<string, number> = { start: 1, pro: 3, scale: 10 };
    const accountLimit = planLimits[String(subscription?.plan || "start")] || 1;
    const { count: alreadyActive } = await service
      .from("ad_accounts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", storedState.workspace_id)
      .eq("active", true);
    let activeBudget = Math.max(0, accountLimit - Number(alreadyActive || 0));

    const accounts = (accountsPayload.data || []).map((account: Record<string, unknown>) => {
      const wantsActive = Number(account.account_status || 0) === 1;
      const active = wantsActive && activeBudget > 0;
      if (active) activeBudget -= 1;
      return {
        workspace_id: storedState.workspace_id,
        provider: "meta",
        external_id: String(account.id || ""),
        name: String(account.name || account.id || "Conta Meta Ads"),
        active
      };
    }).filter((account: Record<string, unknown>) => account.external_id);
    if (accounts.length) {
      const { error: accountsError } = await service.from("ad_accounts").upsert(accounts, { onConflict: "workspace_id,provider,external_id" });
      if (accountsError) throw accountsError;
    }

    const { error: integrationError } = await service.from("integrations").upsert({
      workspace_id: storedState.workspace_id,
      provider: "meta",
      status: "active",
      settings: { connected_at: new Date().toISOString(), account_count: accounts.length },
      updated_at: new Date().toISOString()
    }, { onConflict: "workspace_id,provider" });
    if (integrationError) throw integrationError;
    await service.from("oauth_states").update({ used_at: new Date().toISOString() }).eq("state", state);

    // Sincroniza os gastos na hora, para não esperar o cron de 15 min: assim o
    // dashboard já mostra os dados assim que o usuário volta ao app.
    try {
      const syncSecret = Deno.env.get("SYNC_SECRET") || "";
      if (syncSecret) {
        await fetch(`${supabaseUrl}/functions/v1/meta-insights-sync`, {
          method: "POST",
          headers: { Authorization: `Bearer ${syncSecret}`, "Content-Type": "application/json" },
          body: "{}"
        });
      }
    } catch (syncError) {
      console.warn("Falha na sincronizacao inicial do Meta", syncError);
    }

    return redirect(appUrl, "connected");
  } catch (error) {
    console.error(error);
    return redirect(appUrl, "error", error instanceof Error ? error.message : "Falha na conexao com o Meta.");
  }
});
