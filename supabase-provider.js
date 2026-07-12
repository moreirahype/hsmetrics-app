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

  function consumeAuthRedirect() {
    if (!isConfigured() || !location.hash || !location.hash.includes("access_token=")) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) return null;
    const expiresIn = Number(params.get("expires_in") || 3600);
    storeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get("token_type") || "bearer",
      expires_in: expiresIn,
      expires_at: Math.floor(Date.now() / 1000) + expiresIn
    });
    history.replaceState(null, document.title, location.pathname + location.search);
    return params.get("type") || "redirect";
  }

  async function updatePassword(password) {
    const active = await getSession();
    if (!active?.access_token) throw new Error("Sessão expirada. Solicite um novo link.");
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: "PUT",
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${active.access_token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.msg || payload.error_description || payload.message || "Não foi possível salvar a senha.");
    storeSession(Object.assign({}, active, { user: payload }));
    return payload;
  }

  async function fetchCurrentUser(active) {
    if (!active?.access_token) return null;
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publicKey,
        Authorization: `Bearer ${active.access_token}`
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.msg || payload.error_description || payload.message || "Sessão expirada. Entre novamente.");
    storeSession(Object.assign({}, active, { user: payload }));
    return payload;
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
    if (session?.access_token && !session.user?.id) await fetchCurrentUser(session);
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
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { message: text }; }
    if (!response.ok) throw new Error(payload?.error || payload?.message || payload?.hint || payload?.details || `Banco respondeu ${response.status}.`);
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

  const activeWorkspaceKey = "hsm-active-workspace";

  async function getContext() {
    if (contextPromise) return contextPromise;
    contextPromise = (async () => {
      const active = await getSession();
      if (!active?.user?.id) throw new Error("Sessão expirada. Entre novamente.");
      let memberships = await rest("workspace_members", {
        select: "workspace_id,role,created_at",
        user_id: `eq.${active.user.id}`,
        order: "created_at.asc"
      });
      if (!memberships.length) {
        const created = await rpc("bootstrap_workspace", { workspace_name: "Meu negócio" });
        memberships = created.map((item) => ({ workspace_id: item.workspace_id, role: item.member_role }));
      }
      const preferredId = localStorage.getItem(activeWorkspaceKey) || "";
      const membership = memberships.find((item) => item.workspace_id === preferredId) || memberships[0];
      const workspaceIds = memberships.map((item) => item.workspace_id);
      const workspaces = await rest("workspaces", {
        select: "*",
        id: `in.(${workspaceIds.join(",")})`,
        order: "created_at.asc"
      });
      // A assinatura vale para todos os negócios do dono: fica no workspace mais antigo dele.
      let subscription = null;
      if (membership.role !== "attendant") {
        const owned = workspaces.filter((item) => item.owner_id === active.user.id);
        const rootWorkspace = owned[0] || workspaces.find((item) => item.id === membership.workspace_id);
        if (rootWorkspace) {
          const subscriptions = await rest("subscriptions", {
            select: "*",
            workspace_id: `eq.${rootWorkspace.id}`,
            limit: 1
          });
          subscription = subscriptions[0] || null;
        }
      }
      return {
        user: active.user,
        workspaceId: membership.workspace_id,
        role: membership.role,
        workspace: workspaces.find((item) => item.id === membership.workspace_id) || null,
        workspaces,
        memberships,
        subscription
      };
    })().catch((error) => {
      contextPromise = null;
      throw error;
    });
    return contextPromise;
  }

  function setActiveWorkspace(workspaceId) {
    if (workspaceId) localStorage.setItem(activeWorkspaceKey, String(workspaceId));
    else localStorage.removeItem(activeWorkspaceKey);
    contextPromise = null;
  }

  async function createWorkspace(name) {
    const rows = await rpc("create_workspace", { workspace_name: String(name || "").trim() || "Novo negócio" });
    contextPromise = null;
    const created = Array.isArray(rows) ? rows[0] : rows;
    return created?.workspace_id || created;
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
      location.replace(new URL("../equipe/", location.href));
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

  function rangeBounds(range) {
    // Envia limites com fuso explícito: sem isso, vendas do fim do dia (após ~21h no Brasil)
    // caíam fora do filtro porque o Postgres interpretava o horário como UTC.
    const start = new Date(range.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(range.end);
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }

  async function getWorkspaceCollections(range) {
    const context = await getContext();
    const { from, to } = rangeBounds(range);
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
        if (id === "unassigned") return Object.assign({ id: "manual", label: "Gasto manual" }, values);
        const account = accounts.find((item) => item.id === id);
        return Object.assign({ id: account?.external_id || id, label: account?.name || account?.external_id || id }, values);
      })
    };
  }

  async function saveManualAdSpend(dateIso, amountBrl) {
    const context = await getContext();
    const existing = await findOne("meta_daily_insights", {
      workspace_id: `eq.${context.workspaceId}`,
      date: `eq.${dateIso}`,
      ad_account_id: "is.null"
    });
    const body = {
      workspace_id: context.workspaceId,
      ad_account_id: null,
      date: dateIso,
      spend_brl: Number(amountBrl) || 0,
      updated_at: new Date().toISOString()
    };
    return existing
      ? write("meta_daily_insights", "PATCH", body, { id: `eq.${existing.id}` })
      : write("meta_daily_insights", "POST", body);
  }

  async function getManualAdSpend(range) {
    const context = await getContext();
    return rest("meta_daily_insights", {
      select: "id,date,spend_brl",
      workspace_id: `eq.${context.workspaceId}`,
      ad_account_id: "is.null",
      date: `gte.${isoDate(range.start)}`,
      and: `(date.lte.${isoDate(range.end)})`,
      order: "date.desc"
    });
  }

  async function deleteManualAdSpend(dateIso) {
    const context = await getContext();
    return rest("meta_daily_insights", {
      workspace_id: `eq.${context.workspaceId}`,
      date: `eq.${dateIso}`,
      ad_account_id: "is.null"
    }, { method: "DELETE" });
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
      const inserted = await write("transactions", "POST", {
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
      const insertedId = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;
      if (insertedId) {
        api("/functions/v1/notify-sale", {
          method: "POST",
          body: JSON.stringify({ transaction_id: insertedId })
        }).catch(() => {});
      }
      return inserted;
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
    const { from, to } = rangeBounds(range);
    const [transactions, goals] = await Promise.all([
      rest("transactions", { select: "*", workspace_id: `eq.${context.workspaceId}`, attendant_id: `eq.${attendant.id}`, occurred_at: `gte.${from}`, and: `(occurred_at.lte.${to})`, order: "occurred_at.desc" }),
      rest("attendant_goals", { select: "*", workspace_id: `eq.${context.workspaceId}`, attendant_id: `eq.${attendant.id}`, order: "created_at.desc" })
    ]);
    return {
      attendant: {
        id: attendant.id,
        slug: attendant.slug,
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

  function webhookUrlFor(token) {
    return `${supabaseUrl}/functions/v1/sales-webhook?token=${encodeURIComponent(token)}`;
  }

  function normalizeWebhookTokens(settings) {
    const tokens = Array.isArray(settings?.tokens) ? settings.tokens : [];
    const list = tokens
      .filter((item) => item && item.token)
      .map((item, index) => ({
        token: String(item.token),
        label: String(item.label || `Webhook ${index + 1}`),
        created_at: item.created_at || null
      }));
    if (!list.length && settings?.token) {
      list.push({ token: String(settings.token), label: "Webhook 1", created_at: null });
    }
    return list;
  }

  async function getSalesWebhookIntegration() {
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
        settings: { token, tokens: [{ token, label: "Webhook 1", created_at: new Date().toISOString() }] }
      });
      integration = rows[0];
    }
    return integration;
  }

  async function saveWebhookTokens(integration, tokens) {
    const settings = Object.assign({}, integration.settings || {}, {
      tokens,
      token: tokens[0]?.token || null
    });
    const rows = await write("integrations", "PATCH", {
      status: "active",
      settings,
      updated_at: new Date().toISOString()
    }, { id: `eq.${integration.id}` });
    return rows[0] || Object.assign({}, integration, { settings });
  }

  async function getSalesWebhooks() {
    const integration = await getSalesWebhookIntegration();
    let tokens = normalizeWebhookTokens(integration.settings);
    if (!Array.isArray(integration.settings?.tokens) && tokens.length) {
      await saveWebhookTokens(integration, tokens);
    }
    return tokens.map((item) => Object.assign({ url: webhookUrlFor(item.token) }, item));
  }

  async function addSalesWebhook(label) {
    const integration = await getSalesWebhookIntegration();
    const tokens = normalizeWebhookTokens(integration.settings);
    tokens.push({
      token: randomToken(),
      label: String(label || "").trim() || `Webhook ${tokens.length + 1}`,
      created_at: new Date().toISOString()
    });
    await saveWebhookTokens(integration, tokens);
    return tokens.map((item) => Object.assign({ url: webhookUrlFor(item.token) }, item));
  }

  async function removeSalesWebhook(token) {
    const integration = await getSalesWebhookIntegration();
    const tokens = normalizeWebhookTokens(integration.settings).filter((item) => item.token !== token);
    await saveWebhookTokens(integration, tokens);
    return tokens.map((item) => Object.assign({ url: webhookUrlFor(item.token) }, item));
  }

  async function regenerateSalesWebhook(token) {
    const integration = await getSalesWebhookIntegration();
    const tokens = normalizeWebhookTokens(integration.settings).map((item) =>
      item.token === token
        ? Object.assign({}, item, { token: randomToken(), created_at: new Date().toISOString() })
        : item
    );
    await saveWebhookTokens(integration, tokens);
    return tokens.map((item) => Object.assign({ url: webhookUrlFor(item.token) }, item));
  }

  // Compatibilidade com chamadas antigas.
  async function getSalesWebhookUrl() {
    const list = await getSalesWebhooks();
    if (!list.length) throw new Error("Não foi possível gerar o webhook.");
    return list[0].url;
  }

  async function regenerateSalesWebhookUrl() {
    const list = await getSalesWebhooks();
    const updated = await regenerateSalesWebhook(list[0]?.token);
    return updated[0]?.url;
  }

  async function saveNotificationPreferences(audience, preferences) {
    const context = await getContext();
    const body = {
      workspace_id: context.workspaceId,
      user_id: context.user.id,
      audience: audience === "attendant" ? "attendant" : "owner",
      sale_notifications_enabled: preferences.salesEnabled !== false,
      report_notifications_enabled: Boolean(preferences.times && preferences.times.length),
      report_times: Array.isArray(preferences.times) ? preferences.times : [],
      report_style: ["profit_status", "detailed", "creative"].includes(preferences.reportStyle) ? preferences.reportStyle : "detailed",
      updated_at: new Date().toISOString()
    };
    const existing = await findOne("notification_preferences", {
      workspace_id: `eq.${context.workspaceId}`,
      user_id: `eq.${context.user.id}`,
      audience: `eq.${body.audience}`
    });
    if (existing) return write("notification_preferences", "PATCH", body, { id: `eq.${existing.id}` });
    return write("notification_preferences", "POST", body);
  }

  async function startMetaConnection() {
    const payload = await api("/functions/v1/meta-oauth-start", { method: "POST", body: JSON.stringify({}) });
    if (!payload?.url) throw new Error("A conexão com o Meta Ads ainda não foi configurada.");
    location.assign(payload.url);
  }

  async function disconnectMeta() {
    const context = await getContext();
    return api("/functions/v1/meta-disconnect", {
      method: "POST",
      body: JSON.stringify({ workspace_id: context.workspaceId })
    });
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
    const url = new URL("./", location.origin + location.pathname.replace(/painel\/?$/, ""));
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
    consumeAuthRedirect,
    updatePassword,
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
    getSalesWebhooks,
    addSalesWebhook,
    removeSalesWebhook,
    regenerateSalesWebhook,
    saveManualAdSpend,
    getManualAdSpend,
    deleteManualAdSpend,
    saveNotificationPreferences,
    setActiveWorkspace,
    createWorkspace,
    startMetaConnection,
    disconnectMeta,
    getIntegrationStatus,
    getAdAccounts,
    setAdAccountActive,
    createAttendantInvite,
    acceptAttendantInvite
  };
})();
