import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function actionValue(actions: Array<Record<string, unknown>> | undefined, accepted: string[]) {
  return (actions || []).reduce((total, action) => {
    return accepted.includes(String(action.action_type || "")) ? total + Number(action.value || 0) : total;
  }, 0);
}

Deno.serve(async (request) => {
  const expected = Deno.env.get("SYNC_SECRET") || "";
  if (!expected || request.headers.get("Authorization") !== `Bearer ${expected}`) {
    return Response.json({ ok: false, error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );
    const { data: integrations, error } = await service
      .from("integration_secrets")
      .select("workspace_id,secrets")
      .eq("provider", "meta");
    if (error) throw error;

    const since = new Date();
    since.setDate(since.getDate() - 35);
    const until = new Date();
    const date = (value: Date) => value.toISOString().slice(0, 10);
    let written = 0;
    const errors: Array<Record<string, string>> = [];

    for (const integration of integrations || []) {
      const token = integration.secrets?.access_token;
      if (!token) continue;
      const { data: accounts } = await service
        .from("ad_accounts")
        .select("id,external_id")
        .eq("workspace_id", integration.workspace_id)
        .eq("active", true);
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
            workspace_id: integration.workspace_id,
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
    }

    return Response.json({ ok: errors.length === 0, written, errors });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Falha ao sincronizar Meta Ads." }, { status: 500 });
  }
});
