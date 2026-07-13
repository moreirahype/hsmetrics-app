import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Sincroniza os gastos do Meta apenas do workspace do usuário autenticado.
// Usada pelo botão "Atualizar" do painel (o front não tem o SYNC_SECRET, então
// esta função valida o JWT e roda com a service role só para o negócio do dono).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function response(status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function actionValue(actions: Array<Record<string, unknown>> | undefined, accepted: string[]) {
  return (actions || []).reduce((total, action) => {
    return accepted.includes(String(action.action_type || "")) ? total + Number(action.value || 0) : total;
  }, 0);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response(405, { ok: false, error: "Metodo invalido." });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const authHeader = request.headers.get("Authorization") || "";
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false }
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return response(401, { ok: false, error: "Nao autorizado." });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const workspaceId = String(body.workspace_id || "");
    if (!workspaceId) return response(400, { ok: false, error: "workspace_id ausente." });

    const service = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false } });

    const { data: membership } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .limit(1);
    if (!membership?.length) return response(403, { ok: false, error: "Sem permissao." });

    const { data: secrets } = await service
      .from("integration_secrets")
      .select("secrets")
      .eq("workspace_id", workspaceId)
      .eq("provider", "meta")
      .limit(1);
    const token = secrets?.[0]?.secrets?.access_token;
    if (!token) return response(200, { ok: true, written: 0, skipped: "no_meta" });

    const { data: accounts } = await service
      .from("ad_accounts")
      .select("id,external_id")
      .eq("workspace_id", workspaceId)
      .eq("active", true);

    const since = new Date();
    since.setDate(since.getDate() - 35);
    const until = new Date();
    const date = (value: Date) => value.toISOString().slice(0, 10);
    let written = 0;
    const errors: Array<Record<string, string>> = [];

    for (const account of accounts || []) {
      try {
        const url = new URL(`https://graph.facebook.com/v25.0/${account.external_id}/insights`);
        url.searchParams.set("fields", "spend,actions,date_start");
        url.searchParams.set("time_increment", "1");
        url.searchParams.set("time_range", JSON.stringify({ since: date(since), until: date(until) }));
        url.searchParams.set("limit", "500");
        url.searchParams.set("access_token", token);
        const metaResponse = await fetch(url);
        const payload = await metaResponse.json();
        if (!metaResponse.ok) throw new Error(payload?.error?.message || "Falha ao consultar Meta Ads.");
        const rows = (payload.data || []).map((item: Record<string, unknown>) => ({
          workspace_id: workspaceId,
          ad_account_id: account.id,
          date: item.date_start,
          spend_brl: Number(item.spend || 0),
          leads: actionValue(item.actions as Array<Record<string, unknown>>, ["lead", "onsite_conversion.lead_grouped"]),
          conversations: actionValue(item.actions as Array<Record<string, unknown>>, [
            "onsite_conversion.messaging_conversation_started_7d",
            "omni_messaging_conversation_started_7d",
            "onsite_conversion.total_messaging_connection"
          ]),
          updated_at: new Date().toISOString()
        }));
        if (rows.length) {
          const result = await service.from("meta_daily_insights").upsert(rows, { onConflict: "workspace_id,ad_account_id,date" });
          if (result.error) throw result.error;
          written += rows.length;
        }
      } catch (accountError) {
        errors.push({ account: account.external_id, error: accountError instanceof Error ? accountError.message : "Falha desconhecida" });
      }
    }

    return response(200, { ok: errors.length === 0, written, errors });
  } catch (error) {
    console.error(error);
    return response(500, { ok: false, error: error instanceof Error ? error.message : "Falha ao sincronizar." });
  }
});
