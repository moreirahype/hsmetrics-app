import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Desconecta o Meta Ads de um workspace: revoga o token no próprio Meta e
// remove token, contas de anúncio e dados sincronizados. Chamada autenticada.

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

    // Só um dono/admin do workspace pode desconectar.
    const { data: membership } = await service
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .limit(1);
    if (!membership?.length) return response(403, { ok: false, error: "Sem permissao para desconectar." });

    // Revoga o token no Meta (remove o acesso do app na conta do usuário).
    const { data: secrets } = await service
      .from("integration_secrets")
      .select("secrets")
      .eq("workspace_id", workspaceId)
      .eq("provider", "meta")
      .limit(1);
    const token = secrets?.[0]?.secrets?.access_token;
    if (token) {
      try {
        await fetch(`https://graph.facebook.com/v25.0/me/permissions?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
      } catch (revokeError) {
        console.warn("Falha ao revogar token no Meta (seguindo com a limpeza local)", revokeError);
      }
    }

    // Remove contas de anúncio (cascateia os insights), o token e desativa a integração.
    await service.from("ad_accounts").delete().eq("workspace_id", workspaceId).eq("provider", "meta");
    await service.from("integration_secrets").delete().eq("workspace_id", workspaceId).eq("provider", "meta");
    await service.from("integrations").update({
      status: "disabled",
      settings: {},
      updated_at: new Date().toISOString()
    }).eq("workspace_id", workspaceId).eq("provider", "meta");

    return response(200, { ok: true });
  } catch (error) {
    console.error(error);
    return response(500, { ok: false, error: error instanceof Error ? error.message : "Falha ao desconectar." });
  }
});
