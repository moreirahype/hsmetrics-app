(function () {
  "use strict";

  const config = window.HSBI_CONFIG || {};
  const supabaseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
  const publicKey = String(config.supabasePublishableKey || config.supabaseAnonKey || "");
  const sessionKey = "hsm-auth-session";
  let session = readStoredSession();
  let contextPromise = null;

  function isConfigured() {
    return Boolean(supabaseUrl && publicKey);
  }

  function readStoredSession() {
    try {
      return JSON.parse(localStorage.getItem(sessionKey) || "null");
    } catch {
      return null;
    }
  }

  function storeSession(nextSession) {
    session = nextSession || null;
    contextPromise = null;
    if (session) localStorage.setItem(sessionKey, JSON.stringify(session));
    else localStorage.removeItem(sessionKey);
  }

  function sessionExpiresSoon(value) {
    if (!value) return true;
    const expiresAt = Number(value.expires_at || 0) * 1000;
    return !expiresAt || expiresAt <= Date.now() + 60_000;
  }

  async function authRequest(path, body) {
    if (!isConfigured()) throw new Error("Supabase não configurado.");
    const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
      method: "POST",
      headers: { apikey: publicKey, "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.msg || payload.error_description || payload.message || "Falha de autenticação.");
    if (payload.access_token) {
      payload.expires_at = Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600);
      storeSession(payload);
    }
    return payload;
  }

  async function signIn(email, password) {
    return authRequest("token?grant_type=password", { email, password });
  }

  async function signUp(email, password, name) {
    return authRequest("signup", { email, password, data: { name: name || "" } });
  }

  async function requestPasswordReset(email, redirectTo) {
    return authRequest("recover", { email, redirect_to: redirectTo });
  }

  async function refreshSession() {
    if (!session?.refresh_token) {
      storeSession(null);
      return null;
    }
    try {
      return await authRequest("token?grant_type=refresh_token", { refresh_token: session.refresh_token });
    } catch {
      storeSession(null);
      return null;
    }
  }

  async function getSession() {
    if (sessionExpiresSoon(session)) await refreshSession();
    return session;
  }

  async function signOut() {
    const active = await getSession();
    if (active?.access_token) {
      await fetch(`${supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: publicKey, Authorization: `Bearer ${active.access_token}` }
      }).catch(() => {});
    }
    storeSession(null);
  }

  function queryString(params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
    });
    const serialized = query.toString();
    return serialized ? `?${serialized}` : "";
  }

  async function api(path, options = {}, retry = true) {
    const active = await getSession();
    if (!active?.access_token) throw new Error("Sessão expirada. Entre novamente.");
    const headers = Object.assign({
      apikey: publicKey,
      Authorization: `Bearer ${active.access_token}`,
      "Content-Type": "application/json"
    }, options.headers || {});
    const response = await fetch(`${supabaseUrl}${path}`, Object.assign({}, options, { headers }));
    if (response.status === 401 && retry && await refreshSession()) return api(path, options, false);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(payload?.message || payload?.hint || payload?.details || `Banco respondeu ${response.status}.`);
    return payload;
  }

  function rest(table, params, options) {
    return api(`/rest/v1/${table}${queryString(params)}`, options);
  }

  async function rpc(name, body) {
    return api(`/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body || {})
    });
  }

  async function getContext() {
    if (contextPromise) return contextPromise;
    contextPromise = (async () => {
      const active = await getSession();
      if (!active?.user?.id) throw new Error("Sessão expirada. Entre novamente.");
      let memberships = await rest("workspace_members", {
        select: "workspace_id,role",
        user_id: `eq.${active.user.id}`,
        limit: 1
      });
      if (!memberships.length) {
        const created = await rpc("bootstrap_workspace", { workspace_name: "Meu negócio" });
        memberships = created.map((item) => ({ workspace_id: item.workspace_id, role: item.member_role }));
      }
      const membership = memberships[0];
      const [workspaces, subscriptions] = await Promise.all([
        rest("workspaces", { select: "*", id: `eq.${membership.workspace_id}`, limit: 1 }),
        membership.role === "attendant"
          ? Promise.resolve([])
          : rest("subscriptions", { select: "*", workspace_id: `eq.${membership.workspace_id}`, limit: 1 })
      ]);
      return {
        user: active.user,
        workspaceId: membership.workspace_id,
        role: membership.role,
        workspace: workspaces[0] || null,
        subscription: subscriptions[0] || null
      };
    })().catch((error) => {
      contextPromise = null;
      throw error;
    });
    return contextPromise;
  }

  function loginUrl() {
    const root = new URL("../", location.href);
    root.searchParams.set("next", location.pathname + location.hash);
    return root.toString();
  }

  async function requireAuth(expectedRole) {
    if (!isConfigured()) throw new Error("Backend comercial não configurado.");
    const active = await getSession();
    if (!active?.access_token) {
      location.replace(loginUrl());
      return null;
    }
    const context = await getContext();
    if (expectedRole === "owner" && context.role === "attendant") {
      location.replace(new URL("../k9v2m7q4/", location.href));
      return null;
    }
    if (expectedRole === "owner" && config.enforceSubscription && context.subscription?.status !== "active") {
      location.replace(new URL("../billing.html", location.href));
      return null;
    }
    document.body.classList.remove("auth-pending");
    return context;
  }

  function isoDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function localParts(value) {
    const date = new Date(value);
    return {
      data: isoDate(date),
      hora: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
    };
  }

  async function getWorkspaceCollections(range) {
    const context = await getContext();
    const from = `${isoDate(range.start)}T00:00:00`;
    const to = `${isoDate(range.end)}T23:59:59.999`;
    const [transactions, products, attendants, goals] = await Promise.all([
      rest("transactions", {
        select: "*",
        workspace_id: `eq.${context.workspaceId}`,
        occurred_at: `gte.${from}`,
        and: `(occurred_at.lte.${to})`,
        order: "occurred_at.desc"
      }),
      rest("products", { select: "*", workspace_id: `eq.${context.workspaceId}`, order: "name.asc" }),
      rest("attendants", { select: "*", workspace_id: `eq.${context.workspaceId}`, order: "name.asc" }),
      rest("attendant_goals", { select: "*", workspace_id: `eq.${context.workspaceId}`, order: "created_at.desc" })
    ]);
    return { context, transactions, products, attendants, goals };
  }

  function mapTransaction(row, products, attendants) {
    const product = products.find((item) => item.id === row.product_id);
    const attendant = attendants.find((item) => item.id === row.attendant_id);
    const parts = localParts(row.occurred_at);
    return {
      id: row.id,
      timestamp: row.occurred_at,
      data: parts.data,
      hora: parts.hora,
      pagador: row.payer_name || "Sem cliente",
      telefone: row.payer_phone || "",
      moeda: "BRL",
      valor: Number(row.gross_amount_brl || 0),
      moeda_original: row.original_currency || row.currency || "BRL",
      valor_original: Number(row.original_amount || row.gross_amount_brl || 0),
      atendente: row.attendant_name || attendant?.name || "Sem atendente",
      produto: row.product_name || product?.name || "",
      origem: row.source || "",
      status: row.status || "approved",
      refunded_amount_brl: Number(row.refunded_amount_brl || 0)
    };
  }

  async function fetchTransactionsPayload(range) {
    const { context, transactions, products, attendants, goals } = await getWorkspaceCollections(range);
    const activeProducts = products.filter((item) => item.active !== false && !item.deleted_at);
    const activeAttendants = attendants.filter((item) => item.active !== false && !item.deleted_at);
    return {
      transactions: transactions.map((row) => mapTransaction(row, products, attendants)),
      costs: activeProducts.map((item) => ({
        produto: item.name,
        custo_fixo: Number(item.fixed_cost_brl || 0),
        custo_percentual: Number(item.percent_cost || 0),
        front: Boolean(item.is_front)
      })),
      attendants: activeAttendants.map((item) => ({
        id: item.id,
        user_id: item.user_id,
        slug: item.slug,
        nome: item.name,
        comissao_percentual: Number(item.commission_percent || 0),
        salario_fixo_mensal: Number(item.monthly_fixed_brl || 0),
        inicio_trabalho: item.started_on || "",
        pausas: item.pauses || "",
        lancar_vendas: Boolean(item.manual_sales_enabled)
      })),
      goals: goals.map((item) => {
        const attendant = attendants.find((entry) => entry.id === item.attendant_id);
        return {
          id: item.id,
          slug: attendant?.slug || attendant?.name || "",
          meta_titulo: item.title,
          meta_valor: Number(item.target_brl || 0),
          meta_premio: item.prize || "",
          meta_ativa: Boolean(item.active),
          meta_inicio: item.started_at
        };
      }),
      manualSaleOptions: [
        ...activeAttendants.map((item) => ({ atendente: item.name, produto: "" })),
        ...activeProducts.map((item) => ({ atendente: "", produto: item.name }))
      ],
      workspace: context.workspace
    };
  }

  async function fetchMetaPayload(range) {
    const context = await getContext();
    const [insights, accounts] = await Promise.all([
      rest("meta_daily_insights", {
        select: "*",
        workspace_id: `eq.${context.workspaceId}`,
        date: `gte.${isoDate(range.start)}`,
        and: `(date.lte.${isoDate(range.end)})`
      }),
      rest("ad_accounts", { select: "id,external_id,name", workspace_id: `eq.${context.workspaceId}` })
    ]);
    const byAccount = new Map();
    let spend = 0;
    let leads = 0;
    let conversations = 0;
    insights.forEach((row) => {
      spend += Number(row.spend_brl || 0);
      leads += Number(row.leads || 0);
      conversations += Number(row.conversations || 0);
      const key = row.ad_account_id || "unassigned";
      const current = byAccount.get(key) || { spend: 0, leads: 0, conversations: 0 };
      current.spend += Number(row.spend_brl || 0);
      current.leads += Number(row.leads || 0);
      current.conversations += Number(row.conversations || 0);
      byAccount.set(key, current);
    });
    return {
      spend,
      leads,
      conversations,
      accountBreakdown: Array.from(byAccount.entries()).map(([id, values]) => {
        const account = accounts.find((item) => item.id === id);
        return Object.assign({ id: account?.external_id || id, label: account?.name || account?.external_id || id }, values);
      })
    };
  }

  async function findOne(table, params) {
    const rows = await rest(table, Object.assign({ select: "*", limit: 1 }, params));
    return rows[0] || null;
  }

  async function write(table, method, body, params) {
    return rest(table, params, {
      method,
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body)
    });
  }

  function value(form, name, fallback = "") {
    const result = form.get(name);
    return result == null ? fallback : String(result);
  }

  function numberValue(form, name) {
    return Number(value(form, name, "0").replace(/\./g, "").replace(",", ".")) || 0;
  }

  function slugify(text) {
    return String(text || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `atendente-${Date.now()}`;
  }

  async function resolveAttendant(workspaceId, nameOrSlug) {
    if (!nameOrSlug || /^sem atendente$/i.test(nameOrSlug)) return null;
    const rows = await rest("attendants", { select: "*", workspace_id: `eq.${workspaceId}`, or: `(name.ilike.${nameOrSlug},slug.eq.${nameOrSlug})`, limit: 1 });
    return rows[0] || null;
  }

  async function resolveProduct(workspaceId, name) {
    if (!name) return null;
    const rows = await rest("products", { select: "*", workspace_id: `eq.${workspaceId}`, name: `ilike.${name}`, limit: 1 });
    return rows[0] || null;
  }

  async function submitMutation(form) {
    const context = await getContext();
    const workspaceId = context.workspaceId;
    const action = value(form, "action");
    if (action === "manualSale") {
      const attendant = await resolveAttendant(workspaceId, value(form, "atendente"));
      const product = await resolveProduct(workspaceId, value(form, "produto"));
      const originalAmount = numberValue(form, "valor");
      const originalCurrency = value(form, "moeda", "BRL").toUpperCase();
      const rate = Number(config.currencyRates?.[originalCurrency] || 1);
      return write("transactions", "POST", {
        workspace_id: workspaceId,
        product_id: product?.id || null,
        attendant_id: attendant?.id || null,
        product_name: product?.name || value(form, "produto") || null,
        attendant_name: attendant?.name || value(form, "atendente") || null,
        external_id: value(form, "transaction_id") || value(form, "mutation_id"),
        source: "manual",
        occurred_at: value(form, "timestamp") || new Date().toISOString(),
        payer_name: value(form, "pagador", "Cliente manual"),
        payer_phone: value(form, "telefone"),
        currency: "BRL",
        gross_amount_brl: originalAmount * rate,
        original_currency: originalCurrency,
        original_amount: originalAmount,
        exchange_rate_brl: rate,
        product_fixed_cost_brl: Number(product?.fixed_cost_brl || 0),
        product_percent_cost: Number(product?.percent_cost || 0),
        is_front_sale: product ? Boolean(product.is_front) : true
      });
    }
    if (action === "updateTransaction") {
      const attendant = await resolveAttendant(workspaceId, value(form, "atendente"));
      const product = await resolveProduct(workspaceId, value(form, "produto"));
      const originalAmount = numberValue(form, "valor_original");
      const originalCurrency = value(form, "moeda_original", "BRL").toUpperCase();
      const date = value(form, "data");
      const time = value(form, "hora", "00:00");
      return write("transactions", "PATCH", {
        occurred_at: date ? new Date(`${date}T${time}:00`).toISOString() : new Date().toISOString(),
        payer_name: value(form, "pagador", "Sem cliente"),
        payer_phone: value(form, "telefone"),
        attendant_id: attendant?.id || null,
        product_id: product?.id || null,
        attendant_name: attendant?.name || value(form, "atendente") || null,
        product_name: product?.name || value(form, "produto") || null,
        gross_amount_brl: numberValue(form, "valor"),
        original_currency: originalCurrency,
        original_amount: originalAmount,
        product_fixed_cost_brl: Number(product?.fixed_cost_brl || 0),
        product_percent_cost: Number(product?.percent_cost || 0),
        is_front_sale: product ? Boolean(product.is_front) : true
      }, { workspace_id: `eq.${workspaceId}`, id: `eq.${value(form, "id")}` });
    }
    if (action === "deleteTransaction") {
      return rest("transactions", { workspace_id: `eq.${workspaceId}`, id: `eq.${value(form, "id")}` }, { method: "DELETE" });
    }
    if (action === "updateProductCost") {
      const name = value(form, "produto").trim();
      const existing = await resolveProduct(workspaceId, name);
      const body = {
        workspace_id: workspaceId,
        name,
        fixed_cost_brl: numberValue(form, "custo_fixo"),
        percent_cost: numberValue(form, "custo_percentual"),
        is_front: value(form, "front").toUpperCase() === "TRUE",
        active: true,
        deleted_at: null,
        updated_at: new Date().toISOString()
      };
      return existing ? write("products", "PATCH", body, { id: `eq.${existing.id}` }) : write("products", "POST", body);
    }
    if (action === "deleteProductCost") {
      const existing = await resolveProduct(workspaceId, value(form, "produto"));
      if (!existing) return [];
      return write("products", "PATCH", { active: false, deleted_at: new Date().toISOString() }, { id: `eq.${existing.id}` });
    }
    if (action === "updateAttendant") {
      const original = value(form, "nome_original") || value(form, "slug");
      const existing = await resolveAttendant(workspaceId, original);
      const name = value(form, "nome").trim();
      const body = {
        workspace_id: workspaceId,
        name,
        slug: existing?.slug || value(form, "slug") || slugify(name),
        commission_percent: numberValue(form, "comissao_percentual"),
        monthly_fixed_brl: numberValue(form, "salario_fixo_mensal"),
        started_on: value(form, "inicio_trabalho") || null,
        pauses: value(form, "pausas"),
        manual_sales_enabled: value(form, "lancar_vendas").toUpperCase() === "TRUE",
        active: true,
        deleted_at: null,
        updated_at: new Date().toISOString()
      };
      return existing ? write("attendants", "PATCH", body, { id: `eq.${existing.id}` }) : write("attendants", "POST", body);
    }
    if (action === "deleteAttendant") {
      const existing = await resolveAttendant(workspaceId, value(form, "nome") || value(form, "slug"));
      if (!existing) return [];
      return write("attendants", "PATCH", { active: false, deleted_at: new Date().toISOString() }, { id: `eq.${existing.id}` });
    }
    if (action === "updateGoal") {
      const attendant = await resolveAttendant(workspaceId, value(form, "slug"));
      if (!attendant) throw new Error("Atendente da meta não encontrado.");
      const originalTitle = value(form, "meta_titulo_original") || value(form, "meta_titulo");
      const existing = await findOne("attendant_goals", { workspace_id: `eq.${workspaceId}`, attendant_id: `eq.${attendant.id}`, title: `eq.${originalTitle}` });
      const body = {
        workspace_id: workspaceId,
        attendant_id: attendant.id,
        title: value(form, "meta_titulo", "Meta"),
        target_brl: numberValue(form, "meta_valor"),
        prize: value(form, "meta_premio"),
        active: value(form, "meta_ativa", "TRUE").toUpperCase() === "TRUE",
        updated_at: new Date().toISOString()
      };
      return existing ? write("attendant_goals", "PATCH", body, { id: `eq.${existing.id}` }) : write("attendant_goals", "POST", body);
    }
    if (action === "deleteGoal") {
      const attendant = await resolveAttendant(workspaceId, value(form, "slug"));
      if (!attendant) return [];
      return rest("attendant_goals", { workspace_id: `eq.${workspaceId}`, attendant_id: `eq.${attendant.id}`, title: `eq.${value(form, "meta_titulo")}` }, { method: "DELETE" });
    }
    throw new Error(`Operação não suportada: ${action || "sem ação"}.`);
  }

  async function fetchAttendantPayload(range) {
    const context = await getContext();
    const attendants = await rest("attendants", { select: "*", workspace_id: `eq.${context.workspaceId}`, user_id: `eq.${context.user.id}`, limit: 1 });
    const attendant = attendants[0];
    if (!attendant) throw new Error("Seu usuário ainda não foi vinculado a um atendente.");
    const from = `${isoDate(range.start)}T00:00:00`;
    const to = `${isoDate(range.end)}T23:59:59.999`;
    const [transactions, goals] = await Promise.all([
      rest("transactions", { select: "*", workspace_id: `eq.${context.workspaceId}`, attendant_id: `eq.${attendant.id}`, occurred_at: `gte.${from}`, and: `(occurred_at.lte.${to})`, order: "occurred_at.desc" }),
      rest("attendant_goals", { select: "*", workspace_id: `eq.${context.workspaceId}`, attendant_id: `eq.${attendant.id}`, order: "created_at.desc" })
    ]);
    return {
      attendant: {
        nome: attendant.name,
        comissao_percentual: Number(attendant.commission_percent || 0),
        salario_fixo_mensal: Number(attendant.monthly_fixed_brl || 0),
        inicio_trabalho: attendant.started_on || "",
        pausas: attendant.pauses || "",
        lancar_vendas: Boolean(attendant.manual_sales_enabled)
      },
      goals: goals.map((item) => ({ slug: attendant.slug, meta_titulo: item.title, meta_valor: Number(item.target_brl || 0), meta_premio: item.prize || "", meta_ativa: Boolean(item.active), meta_inicio: item.started_at })),
      transactions: transactions.map((row) => {
        const parts = localParts(row.occurred_at);
        return { id: row.id, timestamp: row.occurred_at, data: parts.data, hora: parts.hora, pagador: row.payer_name || "Sem cliente", telefone: row.payer_phone || "", valor: Number(row.gross_amount_brl || 0), comissao_percentual: Number(attendant.commission_percent || 0) };
      })
    };
  }

  async function updateWorkspaceSettings(changes) {
    const context = await getContext();
    const rows = await write("workspaces", "PATCH", Object.assign({ updated_at: new Date().toISOString() }, changes), { id: `eq.${context.workspaceId}` });
    context.workspace = rows[0] || Object.assign({}, context.workspace, changes);
    return context.workspace;
  }

  function randomToken() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function getSalesWebhookUrl() {
    const context = await getContext();
    let integration = await findOne("integrations", {
      workspace_id: `eq.${context.workspaceId}`,
      provider: "eq.sales_webhook"
    });
    if (!integration) {
      const token = randomToken();
      const rows = await write("integrations", "POST", {
        workspace_id: context.workspaceId,
        provider: "sales_webhook",
        status: "active",
        settings: { token }
      });
      integration = rows[0];
    }
    const token = integration?.settings?.token;
    if (!token) throw new Error("Não foi possível gerar o webhook.");
    return `${supabaseUrl}/functions/v1/sales-webhook?token=${encodeURIComponent(token)}`;
  }

  async function regenerateSalesWebhookUrl() {
    const context = await getContext();
    const token = randomToken();
    const existing = await findOne("integrations", {
      workspace_id: `eq.${context.workspaceId}`,
      provider: "eq.sales_webhook"
    });
    if (existing) {
      await write("integrations", "PATCH", { status: "active", settings: { token }, updated_at: new Date().toISOString() }, { id: `eq.${existing.id}` });
    } else {
      await write("integrations", "POST", { workspace_id: context.workspaceId, provider: "sales_webhook", status: "active", settings: { token } });
    }
    return `${supabaseUrl}/functions/v1/sales-webhook?token=${encodeURIComponent(token)}`;
  }

  async function startMetaConnection() {
    const payload = await api("/functions/v1/meta-oauth-start", { method: "POST", body: JSON.stringify({}) });
    if (!payload?.url) throw new Error("A conexão com o Meta Ads ainda não foi configurada.");
    location.assign(payload.url);
  }

  async function getIntegrationStatus(provider) {
    const context = await getContext();
    return findOne("integrations", {
      workspace_id: `eq.${context.workspaceId}`,
      provider: `eq.${provider}`
    });
  }

  async function getAdAccounts() {
    const context = await getContext();
    return rest("ad_accounts", {
      select: "id,external_id,name,active",
      workspace_id: `eq.${context.workspaceId}`,
      order: "name.asc"
    });
  }

  async function setAdAccountActive(id, active) {
    const context = await getContext();
    return write("ad_accounts", "PATCH", { active: Boolean(active), updated_at: new Date().toISOString() }, {
      id: `eq.${id}`,
      workspace_id: `eq.${context.workspaceId}`
    });
  }

  async function createAttendantInvite(attendantId) {
    const rows = await rpc("create_attendant_invite", { target_attendant_id: attendantId });
    const invite = Array.isArray(rows) ? rows[0] : rows;
    if (!invite?.invite_token) throw new Error("Não foi possível gerar o acesso da equipe.");
    const url = new URL("./", location.origin + location.pathname.replace(/x7p4r9m2\/?$/, ""));
    url.searchParams.set("invite", invite.invite_token);
    return { url: url.toString(), expiresAt: invite.expires_at };
  }

  async function acceptAttendantInvite(token) {
    if (!token) return null;
    const rows = await rpc("accept_attendant_invite", { invite_token: token });
    contextPromise = null;
    return Array.isArray(rows) ? rows[0] : rows;
  }

  window.HSMData = {
    isConfigured,
    signIn,
    signUp,
    signOut,
    requestPasswordReset,
    getSession,
    getContext,
    requireAuth,
    fetchTransactionsPayload,
    fetchMetaPayload,
    fetchAttendantPayload,
    submitMutation,
    updateWorkspaceSettings,
    getSalesWebhookUrl,
    regenerateSalesWebhookUrl,
    startMetaConnection,
    getIntegrationStatus,
    getAdAccounts,
    setAdAccountActive,
    createAttendantInvite,
    acceptAttendantInvite
  };
})();
