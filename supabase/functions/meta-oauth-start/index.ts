import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Metodo invalido." }, { status: 405, headers: corsHeaders });

  try {
    const authorization = request.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false }
    });
    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return Response.json({ error: "Sessao invalida." }, { status: 401, headers: corsHeaders });

    const { data: memberships, error: membershipError } = await service
      .from("workspace_members")
      .select("workspace_id,role")
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .limit(1);
    if (membershipError) throw membershipError;
    const membership = memberships?.[0];
    if (!membership) return Response.json({ error: "Sem permissao para conectar o Meta Ads." }, { status: 403, headers: corsHeaders });

    const appId = Deno.env.get("META_APP_ID") || "";
    if (!appId) return Response.json({ error: "META_APP_ID nao configurado." }, { status: 503, headers: corsHeaders });
    const redirectUri = Deno.env.get("META_REDIRECT_URL") || `${supabaseUrl}/functions/v1/meta-oauth-callback`;
    const state = crypto.randomUUID();
    const { error: stateError } = await service.from("oauth_states").insert({
      state,
      workspace_id: membership.workspace_id,
      provider: "meta",
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    if (stateError) throw stateError;

    const url = new URL("https://www.facebook.com/v25.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    // Somente ads_read: leitura de gasto/leads/conversas das contas do usuário.
    // Mantém o App Review simples (business_management exigiria verificação de negócio).
    url.searchParams.set("scope", "ads_read");
    return Response.json({ url: url.toString() }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao iniciar conexao." }, { status: 500, headers: corsHeaders });
  }
});
