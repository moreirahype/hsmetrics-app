import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

function firstValue(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const direct = payload[key];
    if (direct !== undefined && direct !== null && direct !== "") return direct;
    const nested = key.split(".").reduce<unknown>((value, part) => {
      return value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
    }, payload);
    if (nested !== undefined && nested !== null && nested !== "") return nested;
  }
  return "";
}

function moneyValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let text = String(value || "").trim().replace(/[^0-9,.-]/g, "");
  if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusFrom(payload: Record<string, unknown>) {
  const event = String(firstValue(payload, ["status", "event", "type", "evento", "data.status"]) || "").toLowerCase();
  if (/chargeback|dispute|contest/.test(event)) return "chargeback";
  if (/refund|refunded|reembolso|estorn/.test(event)) return "refunded";
  return "approved";
}

async function exchangeRate(currency: string, payload: Record<string, unknown>) {
  if (currency === "BRL") return 1;
  const provided = moneyValue(firstValue(payload, ["cotacao_brl", "exchange_rate_brl", "exchange_rate"]));
  if (provided > 0) return provided;
  const response = await fetch(`https://api.frankfurter.app/latest?amount=1&from=${encodeURIComponent(currency)}&to=BRL`);
  if (!response.ok) throw new Error(`Nao foi possivel converter ${currency} para BRL.`);
  const body = await response.json();
  const rate = Number(body?.rates?.BRL || 0);
  if (!rate) throw new Error(`Cotacao de ${currency} indisponivel.`);
  return rate;
}

function formatBrl(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Envia o push de "Venda realizada!" para o dono do workspace e para o atendente vinculado.
async function sendSalePush(
  supabase: ReturnType<typeof createClient>,
  workspaceId: string,
  attendantId: string | null,
  grossBrl: number,
  attendantName: string
) {
  const pushApiUrl = (Deno.env.get("PUSH_API_URL") || "").replace(/\/$/, "");
  const pushSecret = Deno.env.get("PUSH_API_SECRET") || "";
  if (!pushApiUrl || !pushSecret) return;
  const appUrl = Deno.env.get("APP_URL") || "https://app.hsmetrics.com.br/";

  const { data: prefs } = await supabase
    .from("notification_preferences")
    .select("audience,sale_notifications_enabled,show_attendant")
    .eq("workspace_id", workspaceId);
  const ownerPref = (prefs || []).find((item) => item.audience === "owner");
  const targets: Array<{ audience: string; body: string; url: string }> = [];
  if (!ownerPref || ownerPref.sale_notifications_enabled !== false) {
    const showAttendant = !ownerPref || ownerPref.show_attendant !== false;
    targets.push({
      audience: `owner-${workspaceId}`,
      body: showAttendant && attendantName && !/^sem atendente$/i.test(attendantName)
        ? `Valor: ${formatBrl(grossBrl)} • ${attendantName}`
        : `Valor: ${formatBrl(grossBrl)}`,
      url: `${appUrl.replace(/\/$/, "")}/painel/#transactions`
    });
  }
  if (attendantId) {
    targets.push({
      audience: `att-${attendantId}`,
      body: `Valor: ${formatBrl(grossBrl)}`,
      url: `${appUrl.replace(/\/$/, "")}/equipe/#transactions`
    });
  }
  await Promise.all(targets.map((target) =>
    fetch(`${pushApiUrl}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pushSecret}` },
      body: JSON.stringify({
        audience: target.audience,
        kind: "sale",
        title: "Venda realizada!",
        body: target.body,
        url: target.url,
        tag: `hsbi-sale-${Date.now()}`
      })
    })
  ));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return response(405, { ok: false, error: "Metodo invalido." });

  try {
    const token = new URL(request.url).searchParams.get("token") || request.headers.get("x-webhook-token") || "";
    if (!token) return response(401, { ok: false, error: "Token ausente." });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );

    // Procura o token na lista de webhooks (planos Pro/Scale) e cai no formato antigo de token único.
    let { data: integrations, error: integrationError } = await supabase
      .from("integrations")
      .select("workspace_id,settings,status")
      .eq("provider", "sales_webhook")
      .eq("status", "active")
      .contains("settings", { tokens: [{ token }] })
      .limit(1);
    if (integrationError) throw integrationError;
    if (!integrations?.length) {
      const legacy = await supabase
        .from("integrations")
        .select("workspace_id,settings,status")
        .eq("provider", "sales_webhook")
        .eq("status", "active")
        .contains("settings", { token })
        .limit(1);
      if (legacy.error) throw legacy.error;
      integrations = legacy.data;
    }
    const integration = integrations?.[0];
    if (!integration) return response(401, { ok: false, error: "Webhook invalido ou desativado." });

    const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
    const workspaceId = integration.workspace_id;
    const status = statusFrom(payload);
    const originalCurrency = String(firstValue(payload, ["moeda", "currency", "data.currency"]) || "BRL").toUpperCase();
    if (!new Set(["BRL", "USD", "EUR", "GBP", "CHF"]).has(originalCurrency)) {
      return response(400, { ok: false, error: `Moeda nao suportada: ${originalCurrency}.` });
    }
    const originalAmount = moneyValue(firstValue(payload, ["valor", "value", "amount", "event_value", "data.amount", "sale.amount"]));
    if (originalAmount <= 0 && status === "approved") return response(400, { ok: false, error: "Valor da venda ausente ou invalido." });
    const rate = await exchangeRate(originalCurrency, payload);
    const grossBrl = Math.round(originalAmount * rate * 100) / 100;
    const externalId = String(firstValue(payload, ["transaction_id", "id", "sale_id", "order_id", "data.id"]) || crypto.randomUUID());
    const payerName = String(firstValue(payload, ["pagador", "cliente", "payer", "customer.name", "contactName", "contact.name"]) || "Sem cliente");
    const payerPhone = String(firstValue(payload, ["telefone", "phone", "customer.phone", "contact.phone"]) || "");
    const attendantName = String(firstValue(payload, ["atendente", "attendant", "seller", "vendedor"]) || "Sem atendente");
    const productName = String(firstValue(payload, ["produto", "product", "product_name", "offer.name", "data.product.name"]) || "");
    const source = String(firstValue(payload, ["origem", "source", "platform", "provider"]) || "webhook");
    const occurredAt = String(firstValue(payload, ["timestamp", "created_at", "date", "data.created_at"]) || new Date().toISOString());

    let product = null;
    if (productName) {
      const { data: existing } = await supabase.from("products").select("*").eq("workspace_id", workspaceId).ilike("name", productName).limit(1);
      product = existing?.[0] || null;
      if (!product) {
        const inserted = await supabase.from("products").insert({ workspace_id: workspaceId, name: productName, active: true }).select("*").single();
        if (inserted.error) throw inserted.error;
        product = inserted.data;
      }
    }

    let attendant = null;
    if (attendantName && !/^sem atendente$/i.test(attendantName)) {
      const { data: existing } = await supabase.from("attendants").select("*").eq("workspace_id", workspaceId).ilike("name", attendantName).limit(1);
      attendant = existing?.[0] || null;
    }

    const transaction = {
      workspace_id: workspaceId,
      product_id: product?.id || null,
      attendant_id: attendant?.id || null,
      product_name: productName || null,
      attendant_name: attendantName || null,
      external_id: externalId,
      source,
      occurred_at: new Date(occurredAt).toISOString(),
      payer_name: payerName,
      payer_phone: payerPhone,
      currency: "BRL",
      gross_amount_brl: grossBrl,
      original_currency: originalCurrency,
      original_amount: originalAmount,
      exchange_rate_brl: rate,
      product_fixed_cost_brl: Number(product?.fixed_cost_brl || 0),
      product_percent_cost: Number(product?.percent_cost || 0),
      is_front_sale: product ? Boolean(product.is_front) : true,
      status,
      refunded_amount_brl: status === "refunded" ? grossBrl : 0
    };

    const { data, error } = await supabase
      .from("transactions")
      .upsert(transaction, { onConflict: "workspace_id,external_id" })
      .select("id")
      .single();
    if (error) throw error;

    if (status === "approved") {
      await sendSalePush(supabase, workspaceId, attendant?.id || null, grossBrl, attendantName).catch((pushError) => {
        console.error("sale push failed", pushError);
      });
    }

    return response(200, { ok: true, id: data.id, duplicate_safe: true });
  } catch (error) {
    console.error(error);
    return response(500, { ok: false, error: error instanceof Error ? error.message : "Falha ao registrar venda." });
  }
});
