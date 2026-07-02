import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function first(payload: Record<string, any>, paths: string[]) {
  for (const path of paths) {
    const value = path.split(".").reduce<any>((current, key) => current?.[key], payload);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function eventName(payload: Record<string, any>) {
  const value = first(payload, ["event", "type", "webhook_event_type", "event.custom_id", "data.event", "data.type"]);
  return String(value || "").toLowerCase();
}

function normalizeStatus(payload: Record<string, any>) {
  const event = eventName(payload);
  const status = String(first(payload, ["status", "subscription.status", "data.status", "data.subscription.status"]) || "").toLowerCase();
  if (/subscription_canceled|refund|chargeback|chargedback|cancel/.test(`${event} ${status}`)) return "canceled";
  if (/subscription_renewal_refused|past_due|overdue|retrying/.test(`${event} ${status}`)) return "past_due";
  if (/expired/.test(`${event} ${status}`)) return "expired";
  if (/subscription_created|subscription_renewed|purchase_approved|active|paid|approved/.test(`${event} ${status}`)) return "active";
  return "pending";
}

const VALID_PLANS = new Set(["start", "pro", "scale"]);
const CHECKOUT_PLAN = new Map([
  ["h4r62s7", "start"],
  ["oixhyin", "pro"],
  ["tqkptgd", "scale"]
]);

function checkoutCode(payload: Record<string, any>) {
  const raw = String(first(payload, [
    "checkoutUrl",
    "checkout_url",
    "checkout.url",
    "data.checkoutUrl",
    "data.checkout_url",
    "data.checkout.url",
    "order.checkoutUrl",
    "order.checkout_url",
    "order.checkout.url",
    "subscription.checkoutUrl",
    "subscription.checkout_url"
  ]) || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).pathname.split("/").filter(Boolean).pop()?.split("_")[0].toLowerCase() || "";
  } catch {
    return raw.split("/").filter(Boolean).pop()?.split("_")[0].toLowerCase() || "";
  }
}

function planFromAmount(payload: Record<string, any>) {
  const raw = first(payload, [
    "baseAmount",
    "base_amount",
    "amount",
    "price",
    "data.baseAmount",
    "data.base_amount",
    "data.amount",
    "order.baseAmount",
    "order.base_amount",
    "order.amount",
    "offer.price",
    "data.offer.price"
  ]);
  const amount = Number(String(raw ?? "").replace(",", "."));
  if (Math.abs(amount - 49) < 0.01) return "start";
  if (Math.abs(amount - 97) < 0.01) return "pro";
  if (Math.abs(amount - 197) < 0.01) return "scale";
  return "";
}

function planFrom(payload: Record<string, any>, requestedPlan = "") {
  const normalizedRequestedPlan = String(requestedPlan || "").trim().toLowerCase();
  if (VALID_PLANS.has(normalizedRequestedPlan)) return normalizedRequestedPlan;

  const planByCheckout = CHECKOUT_PLAN.get(checkoutCode(payload));
  if (planByCheckout) return planByCheckout;

  const planByAmount = planFromAmount(payload);
  if (planByAmount) return planByAmount;

  const productId = String(first(payload, ["product.id", "product_id", "data.product.id", "data.product_id", "order.product.id", "subscription.product.id"]) || "");
  const offerId = String(first(payload, ["offer.id", "offer.short_id", "offer_id", "data.offer.id", "data.offer.short_id", "data.offer_id", "order.offer.id", "order.offer_id"]) || "");
  const mapping = new Map<string, string>();
  [
    [Deno.env.get("CAKTO_START_PRODUCT_ID"), "start"],
    [Deno.env.get("CAKTO_PRO_PRODUCT_ID"), "pro"],
    [Deno.env.get("CAKTO_SCALE_PRODUCT_ID"), "scale"],
    [Deno.env.get("CAKTO_START_OFFER_ID"), "start"],
    [Deno.env.get("CAKTO_PRO_OFFER_ID"), "pro"],
    [Deno.env.get("CAKTO_SCALE_OFFER_ID"), "scale"]
  ].forEach(([id, plan]) => {
    if (id) mapping.set(String(id), String(plan));
  });
  CHECKOUT_PLAN.forEach((plan, code) => mapping.set(code, plan));
  return mapping.get(productId) || mapping.get(offerId) || "";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Metodo invalido." }, { status: 405 });
  const requestUrl = new URL(request.url);
  const suppliedSecret = requestUrl.searchParams.get("secret") || request.headers.get("x-webhook-secret") || "";
  if (!suppliedSecret || suppliedSecret !== Deno.env.get("CAKTO_WEBHOOK_SECRET")) {
    return Response.json({ ok: false, error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const payload = await request.json() as Record<string, any>;
    const email = String(first(payload, ["customer.email", "buyer.email", "email", "data.customer.email", "data.buyer.email"]) || "").trim().toLowerCase();
    const service = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );
    const status = normalizeStatus(payload);
    const subscriptionId = String(first(payload, ["subscription.id", "subscription_id", "data.subscription.id", "data.subscription_id", "order.subscription.id"]) || "");
    const customerId = String(first(payload, ["customer.id", "customer_id", "buyer.id", "data.customer.id"]) || email);
    const periodEnd = first(payload, ["subscription.current_period_end", "subscription.next_payment", "data.subscription.current_period_end", "data.subscription.next_payment", "next_payment_at"]) || null;
    let plan = planFrom(payload, requestUrl.searchParams.get("plan") || "");

    if (!plan && email) {
      const { data: pending } = await service.from("pending_entitlements").select("plan").ilike("email", email).limit(1);
      plan = pending?.[0]?.plan || "";
    }
    if (!plan && subscriptionId) {
      const { data: existing } = await service.from("subscriptions").select("plan").eq("provider_subscription_id", subscriptionId).limit(1);
      plan = existing?.[0]?.plan || "";
    }
    if (!email || !plan) return Response.json({ ok: false, error: "Cliente ou plano nao identificado." }, { status: 400 });

    const entitlement = {
      email,
      provider: "cakto",
      provider_customer_id: customerId || null,
      provider_subscription_id: subscriptionId || null,
      status,
      plan,
      current_period_ends_at: periodEnd,
      payload,
      updated_at: new Date().toISOString()
    };
    const pendingResult = await service.from("pending_entitlements").upsert(entitlement, { onConflict: "email" });
    if (pendingResult.error) throw pendingResult.error;

    const { data: profiles, error: profileError } = await service.from("profiles").select("id").ilike("email", email).limit(1);
    if (profileError) throw profileError;
    const userId = profiles?.[0]?.id;
    if (userId) {
      const { data: workspaces, error: workspaceError } = await service.from("workspaces").select("id").eq("owner_id", userId).limit(1);
      if (workspaceError) throw workspaceError;
      const workspaceId = workspaces?.[0]?.id;
      if (workspaceId) {
        const subscriptionResult = await service.from("subscriptions").upsert({
          workspace_id: workspaceId,
          provider: "cakto",
          provider_customer_id: customerId || null,
          provider_subscription_id: subscriptionId || null,
          status,
          plan,
          current_period_ends_at: periodEnd,
          updated_at: new Date().toISOString()
        }, { onConflict: "workspace_id" });
        if (subscriptionResult.error) throw subscriptionResult.error;
      }
    }

    return Response.json({ ok: true, status, plan, event: eventName(payload) });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Falha ao atualizar assinatura." }, { status: 500 });
  }
});
