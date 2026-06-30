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

function planFrom(payload: Record<string, any>) {
  const productId = String(first(payload, ["product.id", "product_id", "data.product.id", "data.product_id", "order.product.id", "subscription.product.id"]) || "");
  const offerId = String(first(payload, ["offer.id", "offer_id", "data.offer.id", "data.offer_id"]) || "");
  const mapping = new Map([
    [Deno.env.get("CAKTO_START_PRODUCT_ID") || "", "start"],
    [Deno.env.get("CAKTO_PRO_PRODUCT_ID") || "", "pro"],
    [Deno.env.get("CAKTO_SCALE_PRODUCT_ID") || "", "scale"],
    [Deno.env.get("CAKTO_START_OFFER_ID") || "", "start"],
    [Deno.env.get("CAKTO_PRO_OFFER_ID") || "", "pro"],
    [Deno.env.get("CAKTO_SCALE_OFFER_ID") || "", "scale"]
  ]);
  return mapping.get(productId) || mapping.get(offerId) || "";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Metodo invalido." }, { status: 405 });
  const suppliedSecret = new URL(request.url).searchParams.get("secret") || request.headers.get("x-webhook-secret") || "";
  if (!suppliedSecret || suppliedSecret !== Deno.env.get("CAKTO_WEBHOOK_SECRET")) {
    return Response.json({ ok: false, error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const payload = await request.json() as Record<string, any>;
    const email = String(first(payload, ["customer.email", "buyer.email", "email", "data.customer.email", "data.buyer.email"]) || "").trim().toLowerCase();
    const plan = planFrom(payload);
    if (!email || !plan) return Response.json({ ok: false, error: "Cliente ou plano nao identificado." }, { status: 400 });

    const service = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );
    const status = normalizeStatus(payload);
    const subscriptionId = String(first(payload, ["subscription.id", "subscription_id", "data.subscription.id", "data.subscription_id", "order.subscription.id"]) || "");
    const customerId = String(first(payload, ["customer.id", "customer_id", "buyer.id", "data.customer.id"]) || email);
    const periodEnd = first(payload, ["subscription.current_period_end", "subscription.next_payment", "data.subscription.current_period_end", "data.subscription.next_payment", "next_payment_at"]) || null;

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
