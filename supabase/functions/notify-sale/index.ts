import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Dispara o push de "Venda realizada!" para vendas registradas manualmente no app.
// Chamada autenticada (JWT do usuário); valida que o usuário pertence ao workspace da venda.

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

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response(405, { ok: false, error: "Metodo invalido." });

  try {
    const pushApiUrl = (Deno.env.get("PUSH_API_URL") || "").replace(/\/$/, "");
    const pushSecret = Deno.env.get("PUSH_API_SECRET") || "";
    if (!pushApiUrl || !pushSecret) return response(200, { ok: true, skipped: "push_not_configured" });

    const authHeader = request.headers.get("Authorization") || "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } }
    );
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return response(401, { ok: false, error: "Nao autorizado." });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const transactionId = String(body.transaction_id || "");
    if (!transactionId) return response(400, { ok: false, error: "transaction_id ausente." });

    const service = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );

    const { data: transactions, error: transactionError } = await service
      .from("transactions")
      .select("id,workspace_id,attendant_id,attendant_name,gross_amount_brl,status")
      .eq("id", transactionId)
      .limit(1);
    if (transactionError) throw transactionError;
    const transaction = transactions?.[0];
    if (!transaction || transaction.status !== "approved") return response(404, { ok: false, error: "Venda nao encontrada." });

    const { data: membership } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", transaction.workspace_id)
      .eq("user_id", userData.user.id)
      .limit(1);
    if (!membership?.length) return response(403, { ok: false, error: "Sem acesso ao workspace." });

    const appUrl = (Deno.env.get("APP_URL") || "https://app.hsmetrics.com.br/").replace(/\/$/, "");
    const { data: prefs } = await service
      .from("notification_preferences")
      .select("audience,sale_notifications_enabled,show_attendant")
      .eq("workspace_id", transaction.workspace_id);
    const ownerPref = (prefs || []).find((item) => item.audience === "owner");

    const targets: Array<{ audience: string; body: string; url: string }> = [];
    if (!ownerPref || ownerPref.sale_notifications_enabled !== false) {
      const showAttendant = !ownerPref || ownerPref.show_attendant !== false;
      const attendantName = String(transaction.attendant_name || "");
      targets.push({
        audience: `owner-${transaction.workspace_id}`,
        body: showAttendant && attendantName && !/^sem atendente$/i.test(attendantName)
          ? `Valor: ${formatBrl(Number(transaction.gross_amount_brl || 0))} • ${attendantName}`
          : `Valor: ${formatBrl(Number(transaction.gross_amount_brl || 0))}`,
        url: `${appUrl}/x7p4r9m2/#transactions`
      });
    }
    if (transaction.attendant_id) {
      targets.push({
        audience: `att-${transaction.attendant_id}`,
        body: `Valor: ${formatBrl(Number(transaction.gross_amount_brl || 0))}`,
        url: `${appUrl}/k9v2m7q4/#transactions`
      });
    }

    const results = await Promise.all(targets.map((target) =>
      fetch(`${pushApiUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pushSecret}` },
        body: JSON.stringify({
          audience: target.audience,
          kind: "sale",
          title: "Venda realizada!",
          body: target.body,
          url: target.url,
          tag: `hsbi-sale-${transaction.id}`
        })
      }).then((res) => res.ok)
    ));

    return response(200, { ok: true, delivered_targets: results.filter(Boolean).length });
  } catch (error) {
    console.error(error);
    return response(500, { ok: false, error: error instanceof Error ? error.message : "Falha ao notificar venda." });
  }
});
