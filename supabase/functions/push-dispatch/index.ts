import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Notificações de relatório (planos Pro e Scale).
// Agende de hora em hora (minuto 0) com o header Authorization: Bearer <SYNC_SECRET>:
//   select cron.schedule('hsmetrics-push-dispatch', '0 * * * *', $$
//     select net.http_post(
//       url := 'https://<PROJETO>.supabase.co/functions/v1/push-dispatch',
//       headers := '{"Authorization": "Bearer <SYNC_SECRET>", "Content-Type": "application/json"}'::jsonb,
//       body := '{}'::jsonb
//     );
//   $$);
// Para cada workspace com horário marcado (report_times) igual à hora atual em
// America/Sao_Paulo, calcula o resumo do dia e envia via backend de push.

const REPORT_PLANS = new Set(["pro", "scale"]);

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDecimal(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function saoPauloNow() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour === "24" ? "00" : parts.hour}:00`
  };
}

function buildVariants(revenue: number, spend: number, tax: number, profit: number, sales: number) {
  const totalSpend = spend + tax;
  const cpa = sales > 0 ? totalSpend / sales : null;
  const roi = totalSpend > 0 ? revenue / totalSpend : null;
  const detailedBody = `Seu investimento está em ${formatBrl(totalSpend)}, com faturamento em ${formatBrl(revenue)}, com um CPA de ${cpa == null ? "N/A" : formatBrl(cpa)} e um ROI de ${roi == null ? "0,00" : formatDecimal(roi)}.`;
  const hasProfit = profit >= 0;
  return {
    profit_status: hasProfit
      ? { title: "Parabéns!", body: `O dia está finalizando e você lucrou ${formatBrl(profit)}!` }
      : { title: "Não desanime.", body: `O dia está finalizando com ${formatBrl(Math.abs(profit))} de prejuízo. Ajuste a rota e siga em frente.` },
    detailed: { title: "Resumo das Campanhas!", body: detailedBody },
    creative: hasProfit
      ? { title: "Hora do resumo lucrativo 🤑", body: `Você já lucrou ${formatBrl(profit)} hoje. Bora escalar com consciência!` }
      : { title: "Respira, ajusta e continua.", body: `O resultado está em ${formatBrl(Math.abs(profit))} de prejuízo agora. Um dia não define a operação.` }
  };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Metodo invalido." }, { status: 405 });
  const secret = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || secret !== Deno.env.get("SYNC_SECRET")) {
    return Response.json({ ok: false, error: "Nao autorizado." }, { status: 401 });
  }

  const pushApiUrl = (Deno.env.get("PUSH_API_URL") || "").replace(/\/$/, "");
  const pushSecret = Deno.env.get("PUSH_API_SECRET") || "";
  if (!pushApiUrl || !pushSecret) return Response.json({ ok: true, skipped: "push_not_configured" });

  try {
    const service = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );
    const now = saoPauloNow();
    const appUrl = (Deno.env.get("APP_URL") || "https://app.hsmetrics.com.br/").replace(/\/$/, "");

    const { data: prefs, error: prefsError } = await service
      .from("notification_preferences")
      .select("workspace_id,report_times,report_style,report_notifications_enabled")
      .eq("audience", "owner")
      .eq("report_notifications_enabled", true)
      .contains("report_times", [now.time]);
    if (prefsError) throw prefsError;
    if (!prefs?.length) return Response.json({ ok: true, time: now.time, dispatched: 0 });

    let dispatched = 0;
    for (const pref of prefs) {
      const workspaceId = pref.workspace_id;

      // Notificações de relatório valem para Pro e Scale.
      const { data: rootRows } = await service.rpc("owner_root_workspace_id", { target_workspace_id: workspaceId });
      const rootId = typeof rootRows === "string" ? rootRows : rootRows?.[0]?.owner_root_workspace_id || rootRows;
      const { data: subscriptions } = await service
        .from("subscriptions")
        .select("plan,status")
        .eq("workspace_id", rootId || workspaceId)
        .limit(1);
      const subscription = subscriptions?.[0];
      if (!subscription || subscription.status !== "active" || !REPORT_PLANS.has(String(subscription.plan || ""))) continue;

      const { data: workspaceRows } = await service
        .from("workspaces")
        .select("meta_tax_rate")
        .eq("id", workspaceId)
        .limit(1);
      const taxRate = Number(workspaceRows?.[0]?.meta_tax_rate ?? 0.1383);

      const dayStart = `${now.date}T00:00:00-03:00`;
      const dayEnd = `${now.date}T23:59:59.999-03:00`;
      const [{ data: sales }, { data: insights }] = await Promise.all([
        service
          .from("transactions")
          .select("gross_amount_brl,product_cost_brl")
          .eq("workspace_id", workspaceId)
          .eq("status", "approved")
          .gte("occurred_at", dayStart)
          .lte("occurred_at", dayEnd),
        service
          .from("meta_daily_insights")
          .select("spend_brl")
          .eq("workspace_id", workspaceId)
          .eq("date", now.date)
      ]);

      const revenue = (sales || []).reduce((total, row) => total + Number(row.gross_amount_brl || 0), 0);
      const productCosts = (sales || []).reduce((total, row) => total + Number(row.product_cost_brl || 0), 0);
      const spend = (insights || []).reduce((total, row) => total + Number(row.spend_brl || 0), 0);
      const tax = spend * taxRate;
      const profit = revenue - spend - tax - productCosts;
      const variants = buildVariants(revenue, spend, tax, profit, (sales || []).length);

      const sent = await fetch(`${pushApiUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pushSecret}` },
        body: JSON.stringify({
          audience: `owner-${workspaceId}`,
          kind: "report",
          time: now.time,
          title: variants.detailed.title,
          body: variants.detailed.body,
          variants,
          url: `${appUrl}/painel/#dashboard`,
          tag: `hsbi-report-${now.date}-${now.time}`
        })
      });
      if (sent.ok) dispatched += 1;
    }

    return Response.json({ ok: true, time: now.time, dispatched });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Falha no envio de relatorios." }, { status: 500 });
  }
});
