import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function normalizeStatus(payload: Record<string, any>) {
  const event = String(payload.webhook_event_type || "").toLowerCase();
  const orderStatus = String(payload.order_status || "").toLowerCase();
  const subscriptionStatus = String(payload.Subscription?.status || "").toLowerCase();
  if (/refund|chargeback/.test(event) || /refund|chargeback/.test(orderStatus)) return "canceled";
  if (/cancel/.test(event) || /cancel/.test(subscriptionStatus)) return "canceled";
  if (/expired/.test(event) || /expired/.test(subscriptionStatus)) return "expired";
  if (orderStatus === "paid" || /approved|renewed/.test(event) || subscriptionStatus === "active") return "active";
  if (/late|past_due|overdue/.test(subscriptionStatus)) return "past_due";
  return "pending";
}

function planFrom(payload: Record<string, any>) {
  const productId = String(payload.Product?.product_id || "");
  const mapping = new Map([
    [Deno.env.get("KIWIFY_START_PRODUCT_ID") || "", "start"],
    [Deno.env.get("KIWIFY_PRO_PRODUCT_ID") || "", "pro"],
    [Deno.env.get("KIWIFY_SCALE_PRODUCT_ID") || "", "scale"]
  ]);
  return mapping.get(productId) || "";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ ok: false, error: "Metodo invalido." }, { status: 405 });
  const secret = new URL(request.url).searchParams.get("secret") || request.headers.get("x-webhook-secret") || "";
  if (!secret || secret !== Deno.env.get("KIWIFY_WEBHOOK_SECRET")) {
    return Response.json({ ok: false, error: "Nao autorizado." }, { status: 401 });
  }

  try {
    const payload = await request.json() as Record<string, any>;
    const email = String(payload.Customer?.email || "").trim().toLowerCase();
    const plan = planFrom(payload);
    if (!email || !plan) return Response.json({ ok: false, error: "Cliente ou plano nao identificado." }, { status: 400 });

    const service = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false } }
    );
    const status = normalizeStatus(payload);
    const subscriptionId = String(payload.subscription_id || payload.Subscription?.subscription_id || "");
    const customerId = String(payload.Customer?.id || payload.Customer?.email || "");
    const periodEnd = payload.Subscription?.customer_access?.access_until || payload.Subscription?.next_payment || null;

    const entitlement = {
      email,
      provider: "kiwify",
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
          provider: "kiwify",
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

    return Response.json({ ok: true, status, plan });
  } catch (error) {
    console.error(error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Falha ao atualizar assinatura." }, { status: 500 });
  }
});
