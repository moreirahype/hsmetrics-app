(function () {
  "use strict";

  const config = Object.assign(
    { apiUrl: "", metaTaxRate: 0.1383, rowsPerPage: 10, autoRefreshMinutes: 15, retentionDays: 730, currencyRates: { BRL: 1 } },
    window.HSBI_CONFIG || {}
  );

  const standardPeriods = ["today", "yesterday", "last7", "month", "lastMonth"];

  const state = {
    page: "dashboard",
    period: "today",
    appliedPeriod: "today",
    customRange: null,
    transactions: [],
    costs: [],
    attendantConfigs: [],
    goalConfigs: [],
    metaByPeriod: {},
    customMeta: null,
    meta: { spend: 0, leads: 0 },
    filteredTransactions: [],
    dashboardTransactions: [],
    manualSaleOptions: [],
    transactionDrafts: {},
    settingsDrafts: {},
    loadedTransactionRange: null,
    filters: { attendant: "all", product: "all", account: "all" },
    leadMetricSource: loadLeadMetricSource(),
    frontProducts: loadStringList("hsbi-front-products"),
    manualSalePermissions: loadStringList("hsbi-manual-sale-attendants"),
    attendantCostOptions: loadAttendantCostOptions(),
    refundMetricOptions: loadRefundMetricOptions(),
    metrics: {},
    pageIndex: 1,
    lastUpdated: null,
    notifications: loadNotificationPrefs(),
    animateDashboard: false
  };

  const els = {
    pages: document.querySelectorAll(".page"),
    navItems: document.querySelectorAll(".nav-item, .bottom-item"),
    periodButtons: document.querySelectorAll(".period-button"),
    mobilePeriodSelect: document.getElementById("mobilePeriodSelect"),
    customFields: document.getElementById("customFields"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    refreshButton: document.getElementById("refreshButton"),
    discardDraftsButton: document.getElementById("discardDraftsButton"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    syncStatus: document.getElementById("syncStatus"),
    desktopSyncStatus: document.getElementById("desktopSyncStatus"),
    transactionSearch: document.getElementById("transactionSearch"),
    manualSaleForm: document.getElementById("manualSaleForm"),
    manualSaleValue: document.getElementById("manualSaleValue"),
    manualSaleCurrency: document.getElementById("manualSaleCurrency"),
    manualSalePayer: document.getElementById("manualSalePayer"),
    manualSalePhone: document.getElementById("manualSalePhone"),
    manualSaleAttendant: document.getElementById("manualSaleAttendant"),
    manualSaleProduct: document.getElementById("manualSaleProduct"),
    manualSaleDate: document.getElementById("manualSaleDate"),
    manualSaleTime: document.getElementById("manualSaleTime"),
    manualSaleSubmit: document.getElementById("manualSaleSubmit"),
    dashboardAttendantFilter: document.getElementById("dashboardAttendantFilter"),
    dashboardProductFilter: document.getElementById("dashboardProductFilter"),
    dashboardAccountFilter: document.getElementById("dashboardAccountFilter"),
    transactionEditor: document.getElementById("transactionEditor"),
    transactionEditForm: document.getElementById("transactionEditForm"),
    transactionEditId: document.getElementById("transactionEditId"),
    transactionEditDateLabel: document.getElementById("transactionEditDateLabel"),
    transactionEditDate: document.getElementById("transactionEditDate"),
    transactionEditTimeLabel: document.getElementById("transactionEditTimeLabel"),
    transactionEditTime: document.getElementById("transactionEditTime"),
    transactionEditPayer: document.getElementById("transactionEditPayer"),
    transactionEditPhone: document.getElementById("transactionEditPhone"),
    transactionEditAttendant: document.getElementById("transactionEditAttendant"),
    transactionEditProduct: document.getElementById("transactionEditProduct"),
    transactionEditCurrency: document.getElementById("transactionEditCurrency"),
    transactionEditValue: document.getElementById("transactionEditValue"),
    transactionEditSubmit: document.getElementById("transactionEditSubmit"),
    transactionDeleteSubmit: document.getElementById("transactionDeleteSubmit"),
    transactionEditCancel: document.getElementById("transactionEditCancel"),
    transactionEditCancelBottom: document.getElementById("transactionEditCancelBottom"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageInfo: document.getElementById("pageInfo"),
    hourlyChart: document.getElementById("hourlySalesChart"),
    hourlyTooltip: document.getElementById("hourlySalesChartTooltip"),
    dailyChart: document.getElementById("dailySalesChart"),
    dailyTooltip: document.getElementById("dailySalesChartTooltip"),
    legacyChart: document.getElementById("salesChart"),
    legacyTooltip: document.getElementById("chartTooltip"),
    notificationList: document.getElementById("notificationList"),
    saleNotificationList: document.getElementById("saleNotificationList"),
    reportStyleOptions: document.getElementById("reportStyleOptions"),
    reportPreviewTitle: document.getElementById("reportPreviewTitle"),
    leadMetricOptions: document.getElementById("leadMetricOptions"),
    attendantCostOptions: document.getElementById("attendantCostOptions"),
    refundMetricOptions: document.getElementById("refundMetricOptions"),
    goalsSearch: document.getElementById("goalsSearch"),
    attendantsSearch: document.getElementById("attendantsSearch"),
    productsSearch: document.getElementById("productsSearch"),
    frontProductsList: document.getElementById("frontProductsList"),
    addGoalForm: document.getElementById("addGoalForm"),
    addGoalAttendant: document.getElementById("addGoalAttendant"),
    addGoalTitle: document.getElementById("addGoalTitle"),
    addGoalValue: document.getElementById("addGoalValue"),
    addGoalPrize: document.getElementById("addGoalPrize"),
    addAttendantForm: document.getElementById("addAttendantForm"),
    addAttendantName: document.getElementById("addAttendantName"),
    addProductForm: document.getElementById("addProductForm"),
    addProductName: document.getElementById("addProductName"),
    manualSaleAttendantsList: document.getElementById("manualSaleAttendantsList"),
    enableAllNotifications: document.getElementById("enableAllNotifications"),
    testNotification: document.getElementById("testNotification")
  };

  const metricIds = {
    revenue: "metricRevenue",
    ads: "metricAds",
    tax: "metricTax",
    profit: "metricProfit",
    margin: "metricMargin",
    roas: "metricRoas",
    sales: "metricSales",
    cpa: "metricCpa",
    averageTicket: ["metricAverageTicket", "metricArpu"],
    leads: "metricLeads",
    cpl: "metricCpl",
    conversionRate: "metricConversionRate",
    refundedSales: "metricRefundedSales",
    refundRate: "metricRefundRate",
    chargebackRate: "metricChargebackRate"
  };

  const notificationTimes = ["08:00", "12:00", "18:00", "23:00"];
  const productChartColors = ["#9fe870", "#22c55e", "#38bdf8", "#f97316", "#f59e0b", "#e879f9", "#a78bfa", "#f43f5e", "#14b8a6"];
  let notificationToastTimer = null;
  const metricAnimationFrames = new Map();

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    applySidebarPreference();
    setDefaultDates();
    bindEvents();
    setPage(location.hash.replace("#", "") || "dashboard");
    renderNotifications();
    render();
    registerServiceWorker();
    refreshData();
    window.setInterval(() => refreshData(), config.autoRefreshMinutes * 60 * 1000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && (isSaleNotificationsEnabled() || notificationTimes.some((time) => state.notifications[time]))) {
      window.setTimeout(() => syncOwnerPush().catch(console.error), 1000);
    }
  }

  function bindEvents() {
    els.navItems.forEach((button) => {
      button.addEventListener("click", () => setPage(button.dataset.page));
    });
    document.querySelectorAll(".settings-shortcut").forEach((button) => {
      button.addEventListener("click", () => setPage(button.dataset.page));
    });

    els.periodButtons.forEach((button) => {
      button.addEventListener("click", () => setPeriod(button.dataset.period));
    });
    if (els.mobilePeriodSelect) {
      els.mobilePeriodSelect.addEventListener("change", () => setPeriod(els.mobilePeriodSelect.value));
    }

    [els.startDate, els.endDate].forEach((input) => {
      input.addEventListener("change", () => {
        state.pageIndex = 1;
        updateDateDisplays();
        render();
      });
    });

    els.refreshButton.addEventListener("click", () => {
      if (hasAnyDrafts()) {
        savePendingDrafts();
      } else {
        refreshData({ applySelection: true, buttonLoading: true });
      }
    });
    if (els.discardDraftsButton) {
      els.discardDraftsButton.addEventListener("click", discardDrafts);
    }
    if (els.sidebarToggle) {
      els.sidebarToggle.addEventListener("click", toggleSidebar);
    }
    els.transactionSearch.addEventListener("input", () => {
      state.pageIndex = 1;
      renderTransactions();
    });

    [els.dashboardAttendantFilter, els.dashboardProductFilter, els.dashboardAccountFilter].filter(Boolean).forEach((select) => {
      select.addEventListener("change", () => {
        state.filters.attendant = els.dashboardAttendantFilter ? els.dashboardAttendantFilter.value : "all";
        state.filters.product = els.dashboardProductFilter ? els.dashboardProductFilter.value : "all";
        state.filters.account = els.dashboardAccountFilter ? els.dashboardAccountFilter.value : "all";
        state.pageIndex = 1;
        if (state.page === "dashboard") state.animateDashboard = true;
        render();
      });
    });

    if (els.manualSaleForm) {
      els.manualSaleForm.addEventListener("submit", submitManualSale);
      if (els.manualSaleCurrency) {
        els.manualSaleCurrency.addEventListener("change", () => updateCurrencyPlaceholder(els.manualSaleValue, els.manualSaleCurrency.value));
        updateCurrencyPlaceholder(els.manualSaleValue, els.manualSaleCurrency.value);
      }
      if (els.manualSalePhone) {
        els.manualSalePhone.addEventListener("input", () => {
          els.manualSalePhone.value = formatPhone(els.manualSalePhone.value);
        });
      }
    }
    if (els.leadMetricOptions) {
      els.leadMetricOptions.addEventListener("click", (event) => {
        const button = event.target.closest("[data-lead-source]");
        if (!button || button.dataset.leadSource === state.leadMetricSource) return;
        state.leadMetricSource = button.dataset.leadSource === "leads" ? "leads" : "conversations";
        localStorage.setItem("hsbi-lead-metric-source", state.leadMetricSource);
        state.animateDashboard = state.page === "dashboard";
        render();
      });
    }
    if (els.attendantCostOptions) {
      els.attendantCostOptions.addEventListener("change", (event) => {
        const input = event.target.closest("[data-attendant-cost]");
        if (!input) return;
        state.attendantCostOptions[input.dataset.attendantCost] = input.checked;
        saveAttendantCostOptions();
        state.animateDashboard = state.page === "dashboard";
        render();
      });
    }
    if (els.refundMetricOptions) {
      els.refundMetricOptions.addEventListener("change", (event) => {
        const input = event.target.closest("[data-refund-metric]");
        if (!input) return;
        state.refundMetricOptions[input.dataset.refundMetric] = input.checked;
        saveRefundMetricOptions();
        showNotificationSavedToast("Alteração salva");
        render();
      });
    }
    [els.goalsSearch, els.attendantsSearch, els.productsSearch].filter(Boolean).forEach((input) => {
      input.addEventListener("input", renderSettingsPages);
    });
    if (els.addGoalForm) els.addGoalForm.addEventListener("submit", addGoalFromForm);
    if (els.addAttendantForm) els.addAttendantForm.addEventListener("submit", addAttendantFromForm);
    if (els.addProductForm) els.addProductForm.addEventListener("submit", addProductFromForm);

    if (els.transactionEditForm) {
      els.transactionEditForm.addEventListener("submit", submitTransactionEdit);
      if (els.transactionEditCurrency) {
        els.transactionEditCurrency.addEventListener("change", () => updateCurrencyPlaceholder(els.transactionEditValue, els.transactionEditCurrency.value));
      }
      if (els.transactionEditPhone) {
        els.transactionEditPhone.addEventListener("input", () => {
          els.transactionEditPhone.value = formatPhone(els.transactionEditPhone.value);
        });
      }
      [els.transactionEditDate, els.transactionEditTime].filter(Boolean).forEach((input) => {
        input.addEventListener("input", updateTransactionEditorDateTimeDisplays);
        input.addEventListener("change", updateTransactionEditorDateTimeDisplays);
      });
      [els.transactionEditCancel, els.transactionEditCancelBottom].filter(Boolean).forEach((button) => {
        button.addEventListener("click", closeTransactionEditor);
      });
      if (els.transactionDeleteSubmit) {
        els.transactionDeleteSubmit.addEventListener("click", deleteCurrentTransaction);
      }
      els.transactionEditor.addEventListener("click", (event) => {
        if (event.target === els.transactionEditor) closeTransactionEditor();
      });
    }

    els.prevPage.addEventListener("click", () => {
      state.pageIndex = Math.max(1, state.pageIndex - 1);
      renderTransactions();
    });

    els.nextPage.addEventListener("click", () => {
      const totalPages = getTotalPages();
      state.pageIndex = Math.min(totalPages, state.pageIndex + 1);
      renderTransactions();
    });

    els.enableAllNotifications.addEventListener("click", async () => {
      const shouldEnable = !areAllNotificationsEnabled();
      const previous = Object.assign({}, state.notifications);
      state.notifications.salesEnabled = shouldEnable;
      notificationTimes.forEach((time) => {
        state.notifications[time] = shouldEnable;
      });
      saveNotificationPrefs();
      renderNotifications();
      try {
        await syncOwnerPush();
      } catch (error) {
        state.notifications = previous;
        saveNotificationPrefs();
        renderNotifications();
        alert(error.message);
      }
    });

    els.testNotification.addEventListener("click", async () => {
      try {
        await syncOwnerPush(true);
        const pushClient = await ensurePushClient();
        const preview = buildReportPreview();
        await pushClient.test("owner", {
          title: preview.title,
          body: preview.body,
          url: `${location.origin}${location.pathname}#notifications`
        });
      } catch (error) {
        alert(error.message);
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".chart-point") || event.target.closest(".product-donut")) return;
      if (event.target.closest(".custom-select")) return;
      closeCustomSelects();
      hideTooltips();
    });

    window.addEventListener("resize", debounce(() => {
      if (state.metrics) renderSalesChart();
    }, 120));

    window.addEventListener("hashchange", () => {
      const page = location.hash.replace("#", "");
      if (page) setPage(page);
    });
  }

  function setPeriod(period) {
    if (!period || state.period === period) return;
    state.period = period;
    state.pageIndex = 1;
    if (state.period !== "custom") state.appliedPeriod = state.period;
    if (state.page === "dashboard" && state.period !== "custom") state.animateDashboard = true;
    render();
  }

  function applySidebarPreference() {
    const isCollapsed = localStorage.getItem("hsbi-sidebar-collapsed") === "true";
    document.body.classList.toggle("sidebar-collapsed", isCollapsed);
    updateSidebarToggle(isCollapsed);
  }

  function toggleSidebar() {
    const isCollapsed = !document.body.classList.contains("sidebar-collapsed");
    document.body.classList.toggle("sidebar-collapsed", isCollapsed);
    localStorage.setItem("hsbi-sidebar-collapsed", String(isCollapsed));
    updateSidebarToggle(isCollapsed);
    requestAnimationFrame(renderSalesChart);
  }

  function updateSidebarToggle(isCollapsed) {
    if (!els.sidebarToggle) return;
    els.sidebarToggle.setAttribute("aria-expanded", String(!isCollapsed));
    els.sidebarToggle.setAttribute("aria-label", isCollapsed ? "Expandir barra lateral" : "Recolher barra lateral");
    els.sidebarToggle.title = isCollapsed ? "Expandir barra lateral" : "Recolher barra lateral";
  }

  async function refreshData(options = {}) {
    if (options.applySelection) {
      state.pageIndex = 1;
      state.appliedPeriod = state.period;
      if (state.period === "custom") state.customRange = readCustomInputRange();
    }
    setSyncText("Atualizando");
    els.refreshButton.disabled = true;
    setRefreshButtonLoading(Boolean(options.buttonLoading));
    try {
      const range = getPreloadRange();
      const payload = await fetchTransactionsPayload(range);
      const metaEntries = await Promise.all(
        standardPeriods.map(async (period) => [period, await fetchMetaPayload(getDateRange(period))])
      );
      state.transactions = payload.transactions.map(normalizeTransaction);
      state.costs = normalizeCosts(payload.costs);
      state.attendantConfigs = normalizeAttendantConfigs(payload.attendants);
      state.goalConfigs = normalizeGoalConfigs(payload.goals);
      state.manualSaleOptions = normalizeManualSaleOptions(payload.manualSaleOptions);
      state.loadedTransactionRange = range;
      state.metaByPeriod = Object.fromEntries(metaEntries);
      if (state.appliedPeriod === "custom") await loadCustomPeriodData();
      state.lastUpdated = new Date();
      state.animateDashboard = state.page === "dashboard";
      render();
      setSyncText(`Atualizado ${formatTime(state.lastUpdated)}`);
    } catch (error) {
      console.error(error);
      const fallback = buildEmptyPayload();
      state.transactions = fallback.transactions.map(normalizeTransaction);
      state.costs = normalizeCosts(fallback.costs);
      state.manualSaleOptions = normalizeManualSaleOptions(fallback.manualSaleOptions);
      state.attendantConfigs = normalizeAttendantConfigs(fallback.attendants);
      state.goalConfigs = normalizeGoalConfigs(fallback.goals);
      state.loadedTransactionRange = getPreloadRange();
      state.metaByPeriod = Object.fromEntries(standardPeriods.map((period) => [period, fallback.meta]));
      state.customMeta = null;
      state.lastUpdated = new Date();
      state.animateDashboard = state.page === "dashboard";
      render();
      setSyncText("Sem dados");
    } finally {
      els.refreshButton.disabled = false;
      setRefreshButtonLoading(false);
    }
  }

  async function fetchTransactionsPayload(range) {
    if (!config.apiUrl) return buildEmptyPayload();
    const url = new URL(config.apiUrl);
    url.searchParams.set("action", "data");
    url.searchParams.set("from", toIsoDate(range.start));
    url.searchParams.set("to", toIsoDate(range.end));
    try {
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error(`API respondeu ${response.status}`);
      return response.json();
    } catch (error) {
      return fetchJsonp(url);
    }
  }

  async function fetchMetaPayload(range) {
    if (!config.apiUrl) return buildEmptyPayload().meta;
    const url = new URL(config.apiUrl);
    url.searchParams.set("action", "meta");
    url.searchParams.set("from", toIsoDate(range.start));
    url.searchParams.set("to", toIsoDate(range.end));
    let lastPayload = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url.toString(), { cache: "no-store" });
        if (!response.ok) throw new Error(`API respondeu ${response.status}`);
        lastPayload = await response.json();
      } catch (error) {
        try {
          lastPayload = await fetchJsonp(url);
        } catch (jsonpError) {
          lastPayload = { spend: 0, leads: 0, errors: [{ error: jsonpError.message || String(jsonpError) }] };
        }
      }
      if (!Array.isArray(lastPayload.errors) || !lastPayload.errors.length) return lastPayload;
      await delay(350 * (attempt + 1));
    }
    return lastPayload || buildEmptyPayload().meta;
  }

  async function loadCustomPeriodData() {
    if (state.appliedPeriod !== "custom") return;
    const range = state.customRange || readCustomInputRange();
    try {
      let payload = null;
      if (!isRangeLoaded(range)) {
        payload = await fetchTransactionsPayload(range);
        mergeTransactions(payload.transactions.map(normalizeTransaction));
        if (payload.costs) state.costs = normalizeCosts(payload.costs);
      }
      state.customMeta = payload && payload.meta ? payload.meta : await fetchMetaPayload(range);
    } catch (error) {
      console.error(error);
      state.customMeta = { spend: 0, leads: 0 };
    }
  }

  async function submitManualSale(event) {
    event.preventDefault();
    if (!config.apiUrl) {
      alert("Configure a URL da API antes de adicionar vendas.");
      return;
    }
    const value = parseMoneyValue(els.manualSaleValue.value);
    if (!value || value <= 0) {
      alert("Informe um valor de venda válido.");
      els.manualSaleValue.focus();
      return;
    }
    const now = new Date();
    const manualDate = els.manualSaleDate ? els.manualSaleDate.value : "";
    const manualTime = els.manualSaleTime ? els.manualSaleTime.value : "";
    const saleTimestamp = manualDate
      ? parseLocalDateTime(manualDate, manualTime || formatTime(now))
      : now;
    const currency = normalizeCurrency(els.manualSaleCurrency ? els.manualSaleCurrency.value : "BRL");
    const payload = new FormData();
    payload.set("origem", "Manual");
    payload.set("action", "manualSale");
    payload.set("moeda", currency);
    payload.set("valor", String(value).replace(".", ","));
    payload.set("pagador", els.manualSalePayer.value.trim() || "Cliente manual");
    payload.set("telefone", els.manualSalePhone ? els.manualSalePhone.value.trim() : "");
    payload.set("atendente", els.manualSaleAttendant.value || "Sem atendente");
    payload.set("produto", els.manualSaleProduct ? els.manualSaleProduct.value || "" : "");
    payload.set("timestamp", saleTimestamp.toISOString());
    payload.set("transaction_id", `manual-${saleTimestamp.getTime()}-${Math.random().toString(36).slice(2, 8)}`);
    payload.set("mutation_id", createMutationId("manual"));

    setManualSaleLoading(true);
    try {
      await submitMutation(payload);
      els.manualSaleForm.reset();
      if (els.manualSaleCurrency) updateCurrencyPlaceholder(els.manualSaleValue, els.manualSaleCurrency.value);
      await refreshData({ applySelection: true });
    } catch (error) {
      console.error(error);
      if (error && error.message) {
        alert(error.message);
        return;
      }
      alert("Não foi possível adicionar a venda agora.");
    } finally {
      setManualSaleLoading(false);
    }
  }

  async function addGoalFromForm(event) {
    event.preventDefault();
    const attendant = (els.addGoalAttendant.value || "").trim();
    const title = (els.addGoalTitle.value || "").trim();
    if (!attendant || !title) {
      alert("Informe atendente e título da meta.");
      return;
    }
    const payload = new FormData();
    payload.set("action", "updateGoal");
    payload.set("slug", attendant);
    payload.set("meta_titulo", title);
    payload.set("meta_valor", els.addGoalValue.value || "0");
    payload.set("meta_premio", els.addGoalPrize.value || "");
    payload.set("meta_ativa", "TRUE");
    payload.set("mutation_id", createMutationId("goal"));
    await submitMutation(payload);
    els.addGoalForm.reset();
    showNotificationSavedToast("Meta adicionada");
    await refreshData({ applySelection: true });
  }

  async function addAttendantFromForm(event) {
    event.preventDefault();
    const name = (els.addAttendantName.value || "").trim();
    if (!name) {
      alert("Informe o nome do atendente.");
      return;
    }
    const payload = new FormData();
    payload.set("action", "updateAttendant");
    payload.set("nome", name);
    payload.set("comissao_percentual", "0");
    payload.set("salario_fixo_mensal", "0");
    payload.set("mutation_id", createMutationId("attendant"));
    await submitMutation(payload);
    els.addAttendantForm.reset();
    showNotificationSavedToast("Atendente adicionado");
    await refreshData({ applySelection: true });
  }

  async function addProductFromForm(event) {
    event.preventDefault();
    const product = (els.addProductName.value || "").trim();
    if (!product) {
      alert("Selecione um produto vendido.");
      return;
    }
    const payload = new FormData();
    payload.set("action", "updateProductCost");
    payload.set("produto", product);
    payload.set("custo_fixo", "0");
    payload.set("custo_percentual", "0");
    payload.set("front", "FALSE");
    payload.set("mutation_id", createMutationId("product-cost"));
    await submitMutation(payload);
    els.addProductForm.reset();
    showNotificationSavedToast("Produto adicionado");
    await refreshData({ applySelection: true });
  }

  async function submitTransactionEdit(event) {
    event.preventDefault();
    if (!config.apiUrl) {
      alert("Configure a URL da API antes de editar transações.");
      return;
    }
    const id = els.transactionEditId.value;
    const transaction = getTransactionById(id);
    if (!transaction) {
      alert("Transação não encontrada.");
      closeTransactionEditor();
      return;
    }
    const value = parseMoneyValue(els.transactionEditValue.value);
    if (!value || value <= 0) {
      alert("Informe um valor válido.");
      els.transactionEditValue.focus();
      return;
    }
    const currency = normalizeCurrency(els.transactionEditCurrency.value || transaction.moedaOriginal || "BRL");
    const brlValue = currency === "BRL" ? value : convertToBrl(value, currency);
    state.transactionDrafts[id] = {
      data: els.transactionEditDate.value,
      hora: els.transactionEditTime.value,
      pagador: els.transactionEditPayer.value.trim() || "Sem cliente",
      telefone: els.transactionEditPhone ? els.transactionEditPhone.value.trim() : transaction.telefone || "",
      atendente: els.transactionEditAttendant.value.trim() || "Sem atendente",
      produto: els.transactionEditProduct ? els.transactionEditProduct.value || "" : transaction.produto || "",
      moedaOriginal: currency,
      valorOriginal: value,
      moeda: "BRL",
      valor: brlValue
    };
    closeTransactionEditor();
    showNotificationSavedToast("Rascunho salvo");
    render();
    return;
    const payload = new FormData();
    payload.set("action", "updateTransaction");
    payload.set("id", id);
    payload.set("data", els.transactionEditDate.value);
    payload.set("hora", els.transactionEditTime.value);
    payload.set("pagador", els.transactionEditPayer.value.trim() || "Sem cliente");
    payload.set("telefone", els.transactionEditPhone ? els.transactionEditPhone.value.trim() : transaction.telefone || "");
    payload.set("atendente", els.transactionEditAttendant.value.trim() || "Sem atendente");
    payload.set("produto", els.transactionEditProduct ? els.transactionEditProduct.value || "" : transaction.produto || "");
    payload.set("moeda_original", currency);
    payload.set("valor_original", String(value).replace(".", ","));
    payload.set("moeda", "BRL");
    payload.set("valor", String(currency === "BRL" ? value : convertToBrl(value, currency)).replace(".", ","));
    payload.set("mutation_id", createMutationId("edit"));

    setTransactionEditLoading(true);
    try {
      await submitMutation(payload);
      closeTransactionEditor();
      await refreshData({ applySelection: true });
    } catch (error) {
      console.error(error);
      if (error && error.message) {
        alert(error.message);
        return;
      }
      alert("Não foi possível salvar a edição agora.");
    } finally {
      setTransactionEditLoading(false);
    }
  }

  async function submitMutation(payload) {
    const mutationId = payload.get("mutation_id");
    if (!mutationId) throw new Error("Operacao sem identificador de confirmacao.");
    try {
      await fetch(config.apiUrl, { method: "POST", mode: "no-cors", body: payload });
    } catch (error) {
      throw new Error("Falha de rede ao enviar a operacao. Confira sua conexao e tente novamente.");
    }
    await delay(900);
    return { ok: true, mutation_id: mutationId };
  }

  async function savePendingTransactionDrafts() {
    if (!config.apiUrl || !hasTransactionDrafts()) return;
    els.refreshButton.disabled = true;
    setRefreshButtonLoading(true);
    try {
      for (const [id, draft] of Object.entries(state.transactionDrafts)) {
        const payload = new FormData();
        payload.set("action", "updateTransaction");
        payload.set("id", id);
        payload.set("data", draft.data || "");
        payload.set("hora", draft.hora || "");
        payload.set("pagador", draft.pagador || "Sem cliente");
        payload.set("telefone", draft.telefone || "");
        payload.set("atendente", draft.atendente || "Sem atendente");
        payload.set("produto", draft.produto || "");
        payload.set("moeda_original", draft.moedaOriginal || "BRL");
        payload.set("valor_original", String(draft.valorOriginal || 0).replace(".", ","));
        payload.set("moeda", "BRL");
        payload.set("valor", String(draft.valor || 0).replace(".", ","));
        payload.set("mutation_id", createMutationId("edit"));
        await submitMutation(payload);
      }
      state.transactionDrafts = {};
      showNotificationSavedToast("Alterações salvas");
      await refreshData({ applySelection: true });
    } catch (error) {
      console.error(error);
      alert(error && error.message ? error.message : "Não foi possível salvar as alterações agora.");
    } finally {
      els.refreshButton.disabled = false;
      setRefreshButtonLoading(false);
      updateRefreshButtonState();
    }
  }

  async function savePendingSettingsDrafts() {
    if (!config.apiUrl || !hasSettingsDrafts()) return;
    els.refreshButton.disabled = true;
    setRefreshButtonLoading(true);
    try {
      const drafts = Object.values(state.settingsDrafts);
      for (const draft of drafts) {
        const row = findSettingsDraftRow(draft.key);
        const button = row ? row.querySelector(`[data-settings-${draft.action === "delete" ? "delete" : "edit"}]`) : null;
        if (!button) continue;
        if (draft.action === "delete") {
          await deleteSettingsRowFromButton(button, { confirm: false, refresh: false });
        } else if (button.dataset.settingsEdit === "product") {
          await editProductCostFromButton(button, { refresh: false });
        } else if (button.dataset.settingsEdit === "goal") {
          await editGoalFromButton(button, { refresh: false });
        } else {
          await editAttendantFromButton(button, { refresh: false });
        }
      }
      state.settingsDrafts = {};
      showNotificationSavedToast("Alterações salvas");
      await refreshData({ applySelection: true });
    } catch (error) {
      console.error(error);
      alert(error && error.message ? error.message : "Não foi possível salvar as alterações agora.");
    } finally {
      els.refreshButton.disabled = false;
      setRefreshButtonLoading(false);
      updateRefreshButtonState();
    }
  }

  function findSettingsDraftRow(key) {
    return Array.from(document.querySelectorAll(".settings-table-row")).find((row) => row.dataset.settingsDraftKey === key);
  }

  function createMutationId(prefix) {
    const random =
      window.crypto && typeof window.crypto.randomUUID === "function"
        ? window.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
  }

  function openTransactionEditor(id) {
    const transaction = getTransactionById(id);
    if (!transaction || !els.transactionEditor) return;
    els.transactionEditId.value = transaction.id;
    els.transactionEditDate.value = transaction.data || toIsoDate(transaction.timestamp);
    els.transactionEditTime.value = normalizeTimeValue(transaction.hora || formatTime(transaction.timestamp));
    updateTransactionEditorDateTimeDisplays();
    els.transactionEditPayer.value = transaction.pagador || "";
    if (els.transactionEditPhone) els.transactionEditPhone.value = formatPhone(transaction.telefone || "");
    renderTransactionEditAttendantOptions(transaction.atendente || "Sem atendente");
    renderTransactionEditProductOptions(transaction.produto || "");
    els.transactionEditCurrency.value = transaction.moedaOriginal || "BRL";
    els.transactionEditValue.value = decimal(transaction.valorOriginal || transaction.valor || 0);
    updateCurrencyPlaceholder(els.transactionEditValue, els.transactionEditCurrency.value);
    refreshCustomSelects();
    if (typeof els.transactionEditor.showModal === "function") {
      els.transactionEditor.showModal();
    } else {
      els.transactionEditor.setAttribute("open", "");
    }
    setTimeout(() => els.transactionEditValue.focus(), 60);
  }

  async function deleteCurrentTransaction() {
    if (!config.apiUrl) {
      alert("Configure a URL da API antes de apagar transações.");
      return;
    }
    const id = els.transactionEditId.value;
    const transaction = getTransactionById(id);
    if (!transaction) {
      alert("Transação não encontrada.");
      closeTransactionEditor();
      return;
    }
    const label = `${transaction.pagador || "Sem cliente"} - ${money(transaction.valor || 0)}`;
    if (!window.confirm(`Apagar esta transação?\n\n${label}`)) return;
    const payload = new FormData();
    payload.set("action", "deleteTransaction");
    payload.set("id", id);
    payload.set("mutation_id", createMutationId("delete"));

    setTransactionDeleteLoading(true);
    try {
      await submitMutation(payload);
      delete state.transactionDrafts[id];
      closeTransactionEditor();
      await refreshData({ applySelection: true });
    } catch (error) {
      console.error(error);
      if (error && error.message) {
        alert(error.message);
        return;
      }
      alert("Não foi possível apagar a transação agora.");
    } finally {
      setTransactionDeleteLoading(false);
    }
  }

  function closeTransactionEditor() {
    if (!els.transactionEditor) return;
    if (typeof els.transactionEditor.close === "function") {
      els.transactionEditor.close();
    } else {
      els.transactionEditor.removeAttribute("open");
    }
  }

  function setTransactionEditLoading(isLoading) {
    if (!els.transactionEditSubmit) return;
    els.transactionEditSubmit.disabled = isLoading;
    if (els.transactionDeleteSubmit) els.transactionDeleteSubmit.disabled = isLoading;
    els.transactionEditSubmit.textContent = isLoading ? "Salvando..." : "Salvar";
  }

  function setTransactionDeleteLoading(isLoading) {
    if (!els.transactionDeleteSubmit) return;
    els.transactionDeleteSubmit.disabled = isLoading;
    if (els.transactionEditSubmit) els.transactionEditSubmit.disabled = isLoading;
    els.transactionDeleteSubmit.textContent = isLoading ? "Apagando..." : "Apagar";
  }

  function setManualSaleLoading(isLoading) {
    if (!els.manualSaleSubmit) return;
    els.manualSaleSubmit.disabled = isLoading;
    els.manualSaleSubmit.textContent = isLoading ? "Adicionando..." : "Adicionar venda";
  }

  function isRangeLoaded(range) {
    if (!state.loadedTransactionRange) return false;
    return startOfDay(range.start) >= startOfDay(state.loadedTransactionRange.start) &&
      endOfDay(range.end) <= endOfDay(state.loadedTransactionRange.end);
  }

  function mergeTransactions(transactions) {
    const map = new Map(state.transactions.map((item) => [item.id, item]));
    transactions.forEach((item) => map.set(item.id, item));
    state.transactions = Array.from(map.values());
  }

  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = `hsbiJsonp${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Tempo esgotado ao buscar dados"));
      }, 15000);

      function cleanup() {
        window.clearTimeout(timeout);
        script.remove();
        delete window[callback];
      }

      window[callback] = (payload) => {
        cleanup();
        resolve(payload);
      };

      url.searchParams.set("callback", callback);
      script.onerror = () => {
        cleanup();
        reject(new Error("Falha ao carregar dados"));
      };
      script.src = url.toString();
      document.head.append(script);
    });
  }

  function buildEmptyPayload() {
    return { transactions: [], manualSaleOptions: [], costs: [], attendants: [], goals: [], meta: { spend: 0, leads: 0, conversations: 0 } };
  }

  function updateTransactionEditorDateTimeDisplays() {
    if (els.transactionEditDateLabel && els.transactionEditDate) {
      els.transactionEditDateLabel.dataset.display = formatDateInputValue(els.transactionEditDate.value);
    }
    if (els.transactionEditTimeLabel && els.transactionEditTime) {
      els.transactionEditTimeLabel.dataset.display = normalizeTimeValue(els.transactionEditTime.value) || "--:--";
    }
  }

  function normalizeCosts(costs) {
    const map = new Map();
    (Array.isArray(costs) ? costs : []).forEach((item) => {
      const product = String(item.produto || item.product || "").trim();
      if (!product) return;
      map.set(normalizeFilterValue(product), {
        product,
        fixed: parseMoneyValue(item.custo_fixo || item.fixed || 0),
        percent: parseMoneyValue(item.custo_percentual || item.percent || 0),
        front: parseBoolean(item.front || item.produto_front || item.is_front)
      });
    });
    return map;
  }

  function normalizeAttendantConfigs(attendants) {
    return (Array.isArray(attendants) ? attendants : [])
      .map((item) => ({
        slug: String(item.slug || "").trim(),
        name: String(item.nome || item.name || "").trim(),
        commission: parseMoneyValue(item.comissao_percentual || item.commission || 0),
        salary: parseMoneyValue(item.salario_fixo_mensal || item.salary || 0),
        start: String(item.inicio_trabalho || item.start || "").trim(),
        pauses: String(item.pausas || item.pauses || "").trim()
      }))
      .filter((item) => item.name || item.slug);
  }

  function normalizeGoalConfigs(goals) {
    return (Array.isArray(goals) ? goals : [])
      .map((item) => ({
        slug: String(item.slug || "").trim(),
        title: String(item.meta_titulo || item.title || "Meta").trim(),
        value: parseMoneyValue(item.meta_valor || item.value || 0),
        prize: String(item.meta_premio || item.prize || "").trim(),
        active: item.meta_ativa !== false && String(item.meta_ativa || "true").toLowerCase() !== "false"
      }))
      .filter((item) => item.slug || item.title);
  }

  function normalizeManualSaleOptions(options) {
    const rows = Array.isArray(options) ? options : [];
    const normalized = rows.map((option) => {
      if (option && typeof option === "object") {
        return {
          attendant: String(option.atendente || option.attendant || option.nome || option.name || "").trim(),
          product: String(option.produto || option.product || "").trim()
        };
      }
      return { attendant: String(option || "").trim(), product: "" };
    });
    if (!normalized.some((option) => option.attendant === "Sem atendente")) {
      normalized.unshift({ attendant: "Sem atendente", product: "" });
    }
    return normalized;
  }

  function normalizeTransaction(item) {
    const displayDate = normalizeDateValue(item.data);
    const displayTime = normalizeTimeValue(item.hora);
    const timestamp = parseLocalDateTime(displayDate, displayTime) || parseDate(item.timestamp || item.dataHora || "");
    const originalCurrency = normalizeCurrency(item.moeda_original || item.originalCurrency || item.moeda || item.currency || "BRL");
    const originalValue = parseMoneyValue(item.valor_original || item.originalValue || item.valor || item.value || 0);
    const displayCurrency = normalizeCurrency(item.moeda || item.currency || "BRL");
    const baseValue = parseMoneyValue(item.valor_brl || item.value_brl || item.valor || item.value || 0);
    const convertedValue = displayCurrency === "BRL" ? baseValue : convertToBrl(baseValue, displayCurrency);
    return {
      id: item.id || `${timestamp.getTime()}-${item.pagador || ""}-${item.valor || ""}`,
      timestamp,
      data: displayDate || toIsoDate(timestamp),
      hora: displayTime || formatTime(timestamp),
      pagador: item.pagador || item.payer || "Sem cliente",
      telefone: item.telefone || item.phone || "",
      moeda: "BRL",
      moedaOriginal: originalCurrency,
      valorOriginal: originalValue,
      valor: convertedValue,
      atendente: item.atendente || item.attendant || "Sem atendente",
      origem: item.origem || item.source || "",
      produto: item.produto || item.product || item.productName || item.product_name || ""
    };
  }

  function normalizeCurrency(value) {
    return String(value || "BRL").trim().toUpperCase();
  }

  function convertToBrl(value, currency) {
    const normalizedCurrency = normalizeCurrency(currency);
    const rate = Number((config.currencyRates || {})[normalizedCurrency] || 0);
    return rate > 0 ? value * rate : value;
  }

  function parseMoneyValue(value) {
    if (typeof value === "number") return value;
    const text = String(value || "0").trim().replace(/[^\d,.-]/g, "");
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    let normalized = text;
    if (lastComma > -1 && lastDot > -1) {
      normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
    } else if (lastComma > -1) {
      normalized = text.replace(/\./g, "").replace(",", ".");
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseBoolean(value) {
    const text = String(value || "").trim().toLowerCase();
    return ["true", "sim", "yes", "1", "ativo", "ativa"].includes(text);
  }

  function render() {
    renderPeriodControls();
    updateRefreshButtonState();
    renderManualSaleOptions();
    state.filteredTransactions = getFilteredTransactions();
    renderDashboardFilters();
    state.dashboardTransactions = getDashboardTransactions();
    state.meta = getMetaForCurrentPeriod();
    state.metrics = computeMetrics(state.dashboardTransactions);
    renderMetrics();
    renderSalesChart();
    if (state.page === "dashboard" && state.animateDashboard) {
      state.animateDashboard = false;
    }
    renderAttendants();
    renderProducts();
    renderAddProductOptions();
    renderSettingsPages();
    renderTransactions();
    renderNotificationSummary();
    refreshCustomSelects();
  }

  function hasTransactionDrafts() {
    return Boolean(state.transactionDrafts && Object.keys(state.transactionDrafts).length);
  }

  function hasSettingsDrafts() {
    return Boolean(state.settingsDrafts && Object.keys(state.settingsDrafts).length);
  }

  function hasAnyDrafts() {
    return hasTransactionDrafts() || hasSettingsDrafts();
  }

  async function savePendingDrafts() {
    if (hasTransactionDrafts()) await savePendingTransactionDrafts();
    if (hasSettingsDrafts()) await savePendingSettingsDrafts();
  }

  function discardDrafts() {
    if (!hasAnyDrafts()) return;
    state.transactionDrafts = {};
    state.settingsDrafts = {};
    showNotificationSavedToast("Rascunhos descartados");
    render();
    updateRefreshButtonState();
  }

  function getTransactionById(id) {
    return applyTransactionDrafts(state.transactions).find((item) => item.id === id);
  }

  function applyTransactionDrafts(transactions) {
    if (!hasTransactionDrafts()) return transactions;
    return transactions.map((item) => {
      const draft = state.transactionDrafts[item.id];
      return draft ? Object.assign({}, item, draft, { isDraft: true }) : item;
    });
  }

  function updateRefreshButtonState() {
    if (!els.refreshButton) return;
    const hasDrafts = hasAnyDrafts();
    els.refreshButton.classList.toggle("has-drafts", hasDrafts);
    if (!els.refreshButton.classList.contains("is-loading")) {
      els.refreshButton.textContent = hasDrafts ? "Salvar" : "Atualizar";
    }
    if (els.discardDraftsButton) {
      els.discardDraftsButton.hidden = !hasDrafts;
    }
  }

  function refreshCustomSelects() {
    document.querySelectorAll("select").forEach(enhanceSelect);
  }

  function enhanceSelect(select) {
    if (!select || select.dataset.nativeOnly === "true") return;
    let custom = select.nextElementSibling;
    if (!custom || !custom.classList || !custom.classList.contains("custom-select")) {
      custom = document.createElement("div");
      custom.className = "custom-select";
      custom.innerHTML = `
        <button class="custom-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span></span>
          <i aria-hidden="true"></i>
        </button>
        <div class="custom-select-menu" role="listbox"></div>
      `;
      select.insertAdjacentElement("afterend", custom);
      select.classList.add("native-hidden-select");
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      custom.querySelector("button").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (select.disabled) return;
        const isOpen = custom.classList.contains("is-open");
        closeCustomSelects(custom);
        custom.classList.toggle("is-open", !isOpen);
        custom.querySelector("button").setAttribute("aria-expanded", String(!isOpen));
      });
    }
    custom.classList.toggle("is-disabled", select.disabled);
    custom.dataset.value = select.value;
    const buttonText = custom.querySelector(".custom-select-button span");
    const selectedOption = select.options[select.selectedIndex] || select.options[0];
    buttonText.textContent = selectedOption ? selectedOption.textContent : "";
    const menu = custom.querySelector(".custom-select-menu");
    const optionSignature = Array.from(select.options).map((option) => `${option.value}:${option.textContent}:${option.selected}`).join("|");
    if (menu.dataset.signature === optionSignature) return;
    menu.dataset.signature = optionSignature;
    menu.innerHTML = Array.from(select.options).map((option) => `
      <button class="custom-select-option ${option.selected ? "is-selected" : ""}" type="button" role="option" aria-selected="${option.selected ? "true" : "false"}" data-value="${escapeHtml(option.value)}">
        ${escapeHtml(option.textContent)}
      </button>
    `).join("");
    menu.querySelectorAll(".custom-select-option").forEach((optionButton) => {
      optionButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        select.value = optionButton.dataset.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        closeCustomSelects();
        enhanceSelect(select);
      });
    });
  }

  function closeCustomSelects(except) {
    document.querySelectorAll(".custom-select.is-open").forEach((custom) => {
      if (custom === except) return;
      custom.classList.remove("is-open");
      const button = custom.querySelector(".custom-select-button");
      if (button) button.setAttribute("aria-expanded", "false");
    });
  }

  function renderPeriodControls() {
    els.periodButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.period === state.period);
    });
    if (els.mobilePeriodSelect) els.mobilePeriodSelect.value = state.period;
    els.customFields.classList.toggle("is-visible", state.period === "custom");
    const hourlyPeriod = document.getElementById("hourlySalesChartPeriod") || document.getElementById("salesChartPeriod");
    const dailyPeriod = document.getElementById("dailySalesChartPeriod");
    if (hourlyPeriod) hourlyPeriod.textContent = getPeriodName(state.appliedPeriod);
    if (dailyPeriod) dailyPeriod.textContent = getPeriodName(getDailyChartPeriod());
    document.getElementById("attendantsPeriod").textContent = getPeriodName(state.appliedPeriod);
    const productsPeriod = document.getElementById("productsPeriod");
    if (productsPeriod) productsPeriod.textContent = getPeriodName(state.appliedPeriod);
    updateDateDisplays();
  }

  function renderManualSaleOptions() {
    if (!els.manualSaleAttendant) return;
    const current = els.manualSaleAttendant.value || "Sem atendente";
    const attendants = uniqueManualOptionValues("attendant", "Sem atendente");
    els.manualSaleAttendant.innerHTML = attendants
      .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
      .join("");
    els.manualSaleAttendant.value = attendants.includes(current) ? current : attendants[0];
    renderManualSaleProducts();
  }

  function renderManualSaleProducts() {
    if (!els.manualSaleProduct) return;
    const current = els.manualSaleProduct.value || "";
    const products = uniqueManualOptionValues("product", "Sem produto");
    els.manualSaleProduct.innerHTML = products
      .map((option) => `<option value="${escapeHtml(option === "Sem produto" ? "" : option)}">${escapeHtml(option)}</option>`)
      .join("");
    const values = products.map((option) => option === "Sem produto" ? "" : option);
    els.manualSaleProduct.value = values.includes(current) ? current : values[0];
  }

  function uniqueManualOptionValues(field, fallback) {
    const unique = new Set([fallback]);
    normalizeManualSaleOptions(state.manualSaleOptions).forEach((option) => {
      const value = String(option[field] || "").trim();
      if (value) unique.add(value);
    });
    return Array.from(unique);
  }

  function getAttendantSelectOptions(extraValue) {
    const unique = new Set(uniqueManualOptionValues("attendant", "Sem atendente"));
    state.transactions.forEach((item) => {
      const value = String(item.atendente || "").trim();
      if (value) unique.add(value);
    });
    const extra = String(extraValue || "").trim();
    if (extra) unique.add(extra);
    return Array.from(unique);
  }

  function renderTransactionEditAttendantOptions(currentValue) {
    if (!els.transactionEditAttendant) return;
    const options = getAttendantSelectOptions(currentValue);
    els.transactionEditAttendant.innerHTML = options
      .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
      .join("");
    els.transactionEditAttendant.value = options.includes(currentValue) ? currentValue : options[0];
  }

  function getProductSelectOptions(extraValue) {
    const unique = new Set(uniqueManualOptionValues("product", "Sem produto"));
    state.transactions.forEach((item) => {
      const value = String(item.produto || "").trim();
      if (value) unique.add(value);
    });
    const extra = String(extraValue || "").trim();
    if (extra) unique.add(extra);
    return Array.from(unique);
  }

  function renderTransactionEditProductOptions(currentValue) {
    if (!els.transactionEditProduct) return;
    const labelValue = currentValue || "Sem produto";
    const options = getProductSelectOptions(labelValue);
    els.transactionEditProduct.innerHTML = options
      .map((option) => `<option value="${escapeHtml(option === "Sem produto" ? "" : option)}">${escapeHtml(option)}</option>`)
      .join("");
    els.transactionEditProduct.value = currentValue || "";
  }

  function updateCurrencyPlaceholder(input, currency) {
    if (!input) return;
    input.placeholder = `${currencySymbol(currency)} 0,00`;
  }

  function currencySymbol(currency) {
    const symbols = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£", CHF: "CHF" };
    return symbols[normalizeCurrency(currency)] || normalizeCurrency(currency);
  }

  function renderDashboardFilters() {
    const meta = getRawMetaForCurrentPeriod();
    setFilterOptions(
      els.dashboardAttendantFilter,
      [{ value: "all", label: "Todos" }].concat(getUniqueTransactionValues("atendente", "Sem atendente")),
      state.filters.attendant
    );
    setFilterOptions(
      els.dashboardProductFilter,
      [{ value: "all", label: "Todos" }].concat(getUniqueTransactionValues("produto", "Sem produto")),
      state.filters.product
    );
    setFilterOptions(
      els.dashboardAccountFilter,
      [{ value: "all", label: "Todas" }].concat(getAccountFilterOptions(meta)),
      state.filters.account
    );
  }

  function setFilterOptions(select, options, currentValue) {
    if (!select) return;
    const values = new Set(options.map((option) => option.value));
    const nextValue = values.has(currentValue) ? currentValue : "all";
    if (nextValue !== currentValue) {
      if (select === els.dashboardAttendantFilter) state.filters.attendant = nextValue;
      if (select === els.dashboardProductFilter) state.filters.product = nextValue;
      if (select === els.dashboardAccountFilter) state.filters.account = nextValue;
    }
    const html = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
    if (select.innerHTML !== html) select.innerHTML = html;
    select.value = nextValue;
  }

  function getUniqueTransactionValues(field, fallback) {
    const map = new Map();
    state.filteredTransactions.forEach((item) => {
      const label = String(item[field] || fallback).trim() || fallback;
      const key = normalizeFilterValue(label);
      if (!map.has(key)) map.set(key, { value: key, label });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  function getAccountFilterOptions(meta) {
    const map = new Map();
    (meta && Array.isArray(meta.accountBreakdown) ? meta.accountBreakdown : []).forEach((account) => {
      const id = String(account.id || account.account || "").trim();
      if (!id || (Number(account.spend || 0) <= 0 && Number(account.leads || 0) <= 0 && Number(account.conversations || 0) <= 0)) return;
      map.set(id, { value: id, label: account.label || account.name || id });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }

  function updateDateDisplays() {
    [els.startDate, els.endDate].forEach((input) => {
      const label = input.closest("label");
      if (label) label.dataset.display = formatDateInputValue(input.value);
    });
  }

  function setPage(page) {
    if (!["dashboard", "attendants", "products", "transactions", "goals", "settings-attendants", "settings-products", "integrations", "notifications", "settings"].includes(page)) return;
    if (state.page === page) return;
    state.page = page;
    els.pages.forEach((section) => section.classList.toggle("is-active", section.dataset.page === page));
    els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    document.body.dataset.currentPage = page;
    if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
    if (page === "dashboard" && Object.keys(state.metrics || {}).length) {
      state.animateDashboard = true;
      renderMetrics();
      requestAnimationFrame(() => {
        renderSalesChart();
        state.animateDashboard = false;
      });
    }
  }

  function getFilteredTransactions() {
    const range = getDateRange();
    return applyTransactionDrafts(state.transactions)
      .filter((item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function getDashboardTransactions() {
    return state.filteredTransactions.filter(matchesDashboardFilters);
  }

  function matchesDashboardFilters(item) {
    return (state.filters.attendant === "all" || normalizeFilterValue(item.atendente || "Sem atendente") === state.filters.attendant)
      && (state.filters.product === "all" || normalizeFilterValue(item.produto || "Sem produto") === state.filters.product);
  }

  function computeMetrics(transactions) {
    const revenue = sum(transactions.map((item) => item.valor));
    const sales = transactions.length;
    const ads = Number(state.meta.spend || 0);
    const tax = ads * Number(config.metaTaxRate || 0);
    const totalSpend = ads + tax;
    const productCosts = sum(transactions.map(getTransactionProductCost));
    const attendantCosts = getAttendantCosts(transactions);
    const profit = revenue - totalSpend - productCosts - attendantCosts;
    const leads = getLeadBase(state.meta);
    const conversionSales = countFrontConversionSales(transactions, state.transactions);
    return {
      revenue,
      ads,
      tax,
      totalSpend,
      attendantCosts,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      roas: totalSpend > 0 ? revenue / totalSpend : null,
      sales,
      cpa: sales > 0 ? totalSpend / sales : null,
      averageTicket: sales > 0 ? revenue / sales : null,
      leads,
      cpl: leads > 0 ? totalSpend / leads : null,
      conversionSales,
      conversionRate: leads > 0 ? conversionSales / leads : null
    };
  }

  function countFrontConversionSales(periodTransactions, allTransactions) {
    const periodIds = new Set(periodTransactions.map((item) => item.id));
    const seenBuyers = new Set();
    const sheetFrontProducts = Array.from(state.costs.values()).filter((item) => item.front).map((item) => normalizeFilterValue(item.product));
    const frontProducts = new Set(sheetFrontProducts.length ? sheetFrontProducts : state.frontProducts || []);
    return (allTransactions || [])
      .filter((item) => !isGalleryTransaction(item))
      .filter((item) => !frontProducts.size || frontProducts.has(normalizeFilterValue(item.produto || "Sem produto")))
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .reduce((total, item) => {
        const buyerKey = getBuyerKey(item);
        if (!buyerKey) return total;
        const isFirstPurchase = !seenBuyers.has(buyerKey);
        seenBuyers.add(buyerKey);
        return isFirstPurchase && periodIds.has(item.id) ? total + 1 : total;
      }, 0);
  }

  function isGalleryTransaction(item) {
    const source = normalizeSearchText(item.origem);
    const product = normalizeSearchText(item.produto);
    return source.includes("gallery") ||
      source.includes("galeria") ||
      product.includes("gallery") ||
      product.includes("galeria");
  }

  function getBuyerKey(item) {
    const phone = String(item.telefone || "").replace(/\D/g, "");
    if (phone) return `phone:${phone}`;
    const payer = normalizeSearchText(item.pagador).replace(/\s+/g, " ").trim();
    return payer && payer !== "sem pagador" && payer !== "sem cliente" ? `payer:${payer}` : "";
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function normalizeFilterValue(value) {
    return normalizeSearchText(value).replace(/\s+/g, " ").trim() || "sem valor";
  }

  function getLeadBase(meta) {
    const source = meta || {};
    const candidates = state.leadMetricSource === "leads" ? [
      source.leads
    ] : [
      source.conversations,
      source.conversas,
      source.messaging_conversations,
      source.messaging_conversation_started,
      source.messaging_conversation_started_7d,
      source.onsite_conversion_messaging_conversation_started_7d,
      source["onsite_conversion.messaging_conversation_started_7d"],
      source.omni_messaging_conversation_started_7d,
      source["omni_messaging_conversation_started_7d"]
    ];
    const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) > 0);
    return value == null ? 0 : Number(value);
  }

  function renderAddProductOptions() {
    if (!els.addProductName) return;
    const current = els.addProductName.value;
    const options = getProductSelectOptions("").filter((name) => name && name !== "Sem produto");
    els.addProductName.innerHTML = `<option value="">Selecione um produto vendido</option>` + options
      .map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`)
      .join("");
    if (options.includes(current)) els.addProductName.value = current;
  }

  function renderMetrics() {
    const animate = state.page === "dashboard" && state.animateDashboard && canAnimateDashboard();
    const leadLabel = document.getElementById("metricLeadLabel");
    const cplLabel = document.getElementById("metricCplLabel");
    if (leadLabel) leadLabel.textContent = state.leadMetricSource === "leads" ? "Leads" : "Conversas";
    if (cplLabel) cplLabel.textContent = state.leadMetricSource === "leads" ? "Custo por Lead" : "Custo por conversa";
    setMetric("revenue", state.metrics.revenue, null, { animate, formatter: money });
    setMetric("ads", state.metrics.ads, null, { animate, formatter: money });
    setMetric("tax", state.metrics.tax, null, { animate, formatter: money });
    setMetric("profit", state.metrics.profit, signedTone(state.metrics.profit), { animate, formatter: money });
    setMetric("margin", state.metrics.margin, signedTone(state.metrics.margin), { animate, formatter: percent, fallback: "N/A" });
    setMetric("roas", state.metrics.roas, roasTone(state.metrics.roas), { animate, formatter: decimal, fallback: "N/A" });
    setMetric("sales", state.metrics.sales, null, { animate, formatter: integer });
    setMetric("cpa", state.metrics.cpa, null, { animate, formatter: money, fallback: "N/A" });
    setMetric("averageTicket", state.metrics.averageTicket, null, { animate, formatter: money, fallback: "N/A" });
    setMetric("leads", state.metrics.leads, null, { animate, formatter: integer });
    setMetric("cpl", state.metrics.cpl, null, { animate, formatter: money, fallback: "N/A" });
    setMetric("conversionRate", state.metrics.conversionRate, null, { animate, formatter: percent, fallback: "N/A" });
    renderRefundMetricCards(animate);
  }

  function renderRefundMetricCards(animate) {
    const enabled = Boolean(state.refundMetricOptions && state.refundMetricOptions.enabled);
    document.querySelectorAll(".optional-refund-metric").forEach((card) => {
      card.hidden = !enabled;
    });
    if (!enabled) return;
    setMetric("refundedSales", state.metrics.refundedSales || 0, null, { animate, formatter: money });
    setMetric("refundRate", state.metrics.refundRate || 0, null, { animate, formatter: percent });
    setMetric("chargebackRate", state.metrics.chargebackRate || 0, null, { animate, formatter: percent });
  }

  function setMetric(key, value, tone, options = {}) {
    const ids = Array.isArray(metricIds[key]) ? metricIds[key] : [metricIds[key]];
    const el = ids.map((id) => document.getElementById(id)).find(Boolean);
    if (!el) return;
    const numberValue = Number(value);
    const hasNumber = value != null && value !== "" && Number.isFinite(numberValue);
    const displayValue = hasNumber
      ? (options.formatter ? options.formatter(numberValue) : String(value))
      : (options.fallback || "N/A");
    if (options.animate && hasNumber && options.formatter) {
      animateMetricValue(el, numberValue, options.formatter, displayValue);
    } else {
      const frame = metricAnimationFrames.get(el);
      if (frame) window.cancelAnimationFrame(frame);
      metricAnimationFrames.delete(el);
      el.textContent = displayValue;
    }
    el.classList.toggle("is-positive", tone === "positive");
    el.classList.toggle("is-negative", tone === "negative");
    el.classList.toggle("is-alert", tone === "negative");
  }

  function animateMetricValue(el, target, formatter, finalText) {
    const previousFrame = metricAnimationFrames.get(el);
    if (previousFrame) window.cancelAnimationFrame(previousFrame);

    const duration = 820;
    const startedAt = performance.now();
    const change = target;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = progress >= 1 ? finalText : formatter(change * eased);
      if (progress < 1) {
        metricAnimationFrames.set(el, window.requestAnimationFrame(tick));
      } else {
        metricAnimationFrames.delete(el);
      }
    };

    el.textContent = formatter(0);
    metricAnimationFrames.set(el, window.requestAnimationFrame(tick));
  }

  function canAnimateDashboard() {
    return !window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function signedTone(value) {
    if (value == null || Number.isNaN(Number(value)) || Number(value) === 0) return null;
    return Number(value) > 0 ? "positive" : "negative";
  }

  function roasTone(value) {
    if (value == null || Number.isNaN(Number(value))) return null;
    return Number(value) >= 1 ? "positive" : "negative";
  }

  function renderSalesChart() {
    const animateCharts = state.page === "dashboard" && state.animateDashboard && canAnimateDashboard();
    if (els.hourlyChart && els.dailyChart) {
      renderSingleSalesChart(
        els.hourlyChart,
        els.hourlyTooltip,
        buildHourlySeries(),
        "hourlySalesAreaGradient",
        "bar",
        animateCharts
      );
      renderSingleSalesChart(
        els.dailyChart,
        els.dailyTooltip,
        buildDailySeries(),
        "dailySalesAreaGradient",
        "line",
        animateCharts
      );
      return;
    }
    if (els.legacyChart) {
      const legacyTitle = document.getElementById("salesChartTitle");
      if (legacyTitle) legacyTitle.textContent = "Vendas por horário";
      renderSingleSalesChart(els.legacyChart, els.legacyTooltip, buildHourlySeries(), "legacySalesAreaGradient", "bar", animateCharts);
    }
  }

  function renderSingleSalesChart(chart, tooltip, grouped, gradientId, mode, animateChart = false) {
    if (!chart || !tooltip || !grouped.length) return;
    chart.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const chartBox = chart.parentElement.getBoundingClientRect();
    const highestSales = Math.max(0, ...grouped.map((point) => point.sales));
    const maxSales = Math.max(1, Math.ceil(highestSales * 1.2));
    const left = 34;
    const right = 10;
    const top = 12;
    const bottom = 32;
    const canvasWidth = 980;
    const canvasHeight = Math.max(300, Math.round(canvasWidth * (chartBox.height / Math.max(chartBox.width, 1))));
    chart.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    const width = canvasWidth - left - right;
    const height = canvasHeight - top - bottom;
    const step = grouped.length > 1
      ? mode === "bar" ? width / grouped.length : width / (grouped.length - 1)
      : 0;
    const points = grouped.map((point, index) => {
      const x = grouped.length > 1
        ? mode === "bar" ? left + step * (index + 0.5) : left + index * step
        : left + width / 2;
      const y = top + height - (point.sales / maxSales) * height;
      return Object.assign({ x, y }, point);
    });
    const path = makeLinearPath(points);
    const areaPath = `${path} L ${points[points.length - 1].x},${top + height} L ${points[0].x},${top + height} Z`;
    const barWidth = Math.max(7, Math.min(28, step * 0.58));
    const gridYTop = top;
    const gridYMid = top + height / 2;
    const gridYBottom = top + height;
    chart.innerHTML = `
      <defs>
        <linearGradient id="${gradientId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#9fe870" stop-opacity="0.16"></stop>
          <stop offset="100%" stop-color="#9fe870" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="4" class="chart-plot-bg"></rect>
      <line x1="${left}" y1="${gridYTop}" x2="${canvasWidth - right}" y2="${gridYTop}" class="grid-line"></line>
      <line x1="${left}" y1="${gridYMid}" x2="${canvasWidth - right}" y2="${gridYMid}" class="grid-line is-soft"></line>
      <line x1="${left}" y1="${gridYBottom}" x2="${canvasWidth - right}" y2="${gridYBottom}" class="axis-line"></line>
      <text x="${left - 18}" y="${gridYTop + 5}" class="axis-text">${maxSales}</text>
      <text x="${left - 18}" y="${gridYMid + 5}" class="axis-text">${Math.round(maxSales / 2)}</text>
      <text x="${left - 18}" y="${gridYBottom + 5}" class="axis-text">0</text>
      ${mode === "line" ? `<path d="${areaPath}" class="sales-area"></path><path d="${path}" class="sales-line" pathLength="1"></path>` : ""}
      ${points
        .map(
          (point) => `
            <g class="chart-point" data-index="${point.index}" style="--bar-delay:${Math.min(point.index * 8, 180)}ms">
              ${mode === "bar"
                ? `<rect class="sales-bar-hit" x="${point.x - Math.max(barWidth, 18) / 2}" y="${top}" width="${Math.max(barWidth, 18)}" height="${height}" rx="4"></rect>
                   <rect class="sales-bar" x="${point.x - barWidth / 2}" y="${point.y}" width="${barWidth}" height="${Math.max(2, top + height - point.y)}" rx="${Math.min(6, barWidth / 3)}"></rect>`
                : `<circle class="point-hit" cx="${point.x}" cy="${point.y}" r="13"></circle>
                   <circle class="point-dot" cx="${point.x}" cy="${point.y}" r="${point.sales || point.revenue ? 4.8 : 3.8}"></circle>`}
              <text x="${point.x}" y="${canvasHeight - 12}" class="x-label">${shouldShowAxisLabel(point.index, grouped.length) ? point.label : ""}</text>
            </g>`
        )
        .join("")}
    `;

    const chartAnimationCss = animateChart ? `
      .sales-bar{animation:chartBarIn 680ms cubic-bezier(.2,.78,.2,1) both;animation-delay:var(--bar-delay,0ms);transform-box:fill-box;transform-origin:center bottom}
      .sales-line{stroke-dasharray:1;stroke-dashoffset:1;animation:chartLineTraceIn 820ms cubic-bezier(.2,.78,.2,1) both}
      .sales-area{animation:chartAreaIn 820ms ease both 140ms;transform-box:fill-box;transform-origin:center}
      .point-dot{animation:chartDotIn 620ms ease both;transform-box:fill-box;transform-origin:center}
      @keyframes chartBarIn{0%{opacity:0;transform:scaleY(.04)}72%{opacity:.82;transform:scaleY(1.015)}100%{opacity:.82;transform:scaleY(1)}}
      @keyframes chartLineTraceIn{to{stroke-dashoffset:0}}
      @keyframes chartAreaIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
      @keyframes chartDotIn{from{opacity:0;transform:scale(.72)}to{opacity:1;transform:scale(1)}}
    ` : "";
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .chart-plot-bg{fill:rgba(255,255,255,.012)}
      .grid-line,.axis-line{stroke:rgba(159,232,112,.18);stroke-width:1}
      .grid-line.is-soft{stroke:rgba(159,232,112,.1)}
      .sales-area{fill:url(#${gradientId})}
      .sales-line{fill:none;stroke:#9fe870;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:miter;filter:drop-shadow(0 0 3px rgba(159,232,112,.16))}
      .chart-point,.chart-point *{pointer-events:all;cursor:pointer;outline:none}
      .point-hit{fill:transparent;stroke:transparent}
      .point-dot{fill:#1b241a;stroke:#9fe870;stroke-width:2.5}
      .chart-point:hover .point-dot,.chart-point:focus .point-dot{fill:#9fe870;stroke:#071009;stroke-width:2.2}
      .sales-bar-hit{fill:transparent;stroke:transparent}
      .sales-bar{fill:#a8f078;opacity:.82;filter:drop-shadow(0 0 3px rgba(168,240,120,.14));transition:opacity 120ms ease,fill 120ms ease}
      .chart-point:hover .sales-bar,.chart-point:focus .sales-bar{opacity:1;fill:#bcff8c}
      .axis-text,.x-label{fill:#b8c0b4;font-size:var(--text-xs)}
      .axis-text{text-anchor:end}
      .x-label{text-anchor:middle}
      ${chartAnimationCss}
    `;
    chart.prepend(style);

    chart.querySelectorAll(".chart-point").forEach((node) => {
      const point = points[Number(node.dataset.index)];
      node.addEventListener("mouseenter", (event) => showTooltip(event, point, chart, tooltip));
      node.addEventListener("mousemove", (event) => showTooltip(event, point, chart, tooltip));
      node.addEventListener("pointerdown", (event) => showTooltip(event, point, chart, tooltip));
      node.addEventListener("mouseleave", () => hideTooltip(tooltip));
    });
  }

  function shouldShowAxisLabel(index, total) {
    if (window.innerWidth <= 720) return total <= 12 || index % 2 === 0;
    return total <= 16 || index % 2 === 0;
  }

  function makeLinearPath(points) {
    if (points.length < 2) return points.map((point) => `M${point.x},${point.y}`).join(" ");
    return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  }

  function buildHourlySeries() {
    const labels = buildHourLabels();
    const series = labels.map((label, index) => {
      const sales = state.dashboardTransactions.filter((item) => {
        return item.timestamp.getHours() === index;
      });
      return {
        index,
        key: label.key,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.valor)),
        productCost: sum(sales.map(getTransactionProductCost))
      };
    });
    return series;
  }

  function buildDailySeries() {
    const period = getDailyChartPeriod();
    const range = getDateRange(period);
    const series = buildDayLabels(range.start, range.end).map((label, index) => {
      const sales = state.transactions.filter((item) => {
        return item.timestamp >= startOfDay(range.start)
          && item.timestamp <= endOfDay(range.end)
          && matchesDashboardFilters(item)
          && toIsoDate(item.timestamp) === label.key;
      });
      return {
        index,
        key: label.key,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.valor)),
        productCost: sum(sales.map(getTransactionProductCost)),
        attendantCost: getAttendantCostsForDate(sales, label.key)
      };
    });
    return addProfitToSeries(series, period);
  }

  function addProfitToSeries(series, period) {
    const totalRevenue = sum(series.map((point) => point.revenue));
    const fallbackSpend = getTotalSpendForPeriod(period);
    return series.map((point) => Object.assign({}, point, {
      profit: getProfitForDate(period, point.key, point.revenue, totalRevenue, fallbackSpend, point.productCost, point.attendantCost)
    }));
  }

  function getDailyChartPeriod() {
    return state.appliedPeriod === "today" || state.appliedPeriod === "yesterday" ? "month" : state.appliedPeriod;
  }

  function showTooltip(event, point, chart, tooltip) {
    const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    const wrap = chart.parentElement.getBoundingClientRect();
    const viewBox = event.currentTarget.ownerSVGElement.viewBox.baseVal;
    const pointX = ((point.x / viewBox.width) * rect.width) + rect.left - wrap.left;
    const pointY = ((point.y / viewBox.height) * rect.height) + rect.top - wrap.top;
    const x = event.clientX ? event.clientX - wrap.left : pointX;
    const y = event.clientY ? event.clientY - wrap.top : pointY;
    hideTooltips(tooltip);
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(72, Math.min(wrap.width - 72, x))}px`;
    tooltip.style.top = `${Math.max(52, y - 8)}px`;
    const profitLine = point.profit != null && Number.isFinite(Number(point.profit))
      ? `<span class="tooltip-line"><b>Lucro:</b> ${money(point.profit)}</span>`
      : "";
    tooltip.innerHTML = `
      <strong>${point.fullLabel}</strong>
      <span class="tooltip-line"><b>Vendas:</b> ${integer(point.sales)}</span>
      <span class="tooltip-line"><b>Faturamento:</b> ${money(point.revenue)}</span>
      ${profitLine}
    `;
  }

  function hideTooltip(tooltip) {
    tooltip.hidden = true;
  }

  function hideTooltips(except) {
    [els.hourlyTooltip, els.dailyTooltip, els.legacyTooltip].filter(Boolean).forEach((tooltip) => {
      if (tooltip !== except) hideTooltip(tooltip);
    });
    document.querySelectorAll(".product-donut-tooltip").forEach((tooltip) => {
      if (tooltip !== except) hideTooltip(tooltip);
    });
  }

  function renderAttendants() {
    const rows = getAttendantRows();
    const tbody = document.getElementById("attendantsBody");
    const empty = document.getElementById("attendantsEmpty");
    const totalSales = sum(rows.map((row) => row.sales));
    const totalRevenue = sum(rows.map((row) => row.revenue));
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td>${integer(row.sales)}</td>
        <td>${money(row.revenue)}</td>
        <td>${row.sales ? money(row.revenue / row.sales) : "N/A"}</td>
      `;
      tbody.append(tr);
    });
    if (rows.length) {
      const totalRow = document.createElement("tr");
      totalRow.className = "attendants-total-row";
      totalRow.innerHTML = `
        <td>Total</td>
        <td>${integer(totalSales)}</td>
        <td>${money(totalRevenue)}</td>
        <td>${totalSales ? money(totalRevenue / totalSales) : "N/A"}</td>
      `;
      tbody.append(totalRow);
    }
    empty.classList.toggle("is-visible", rows.length === 0);
    renderAttendantChart(rows);
  }

  function getAttendantRows() {
    const range = getDateRange();
    const transactions = state.transactions.filter(
      (item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end)
    );
    const map = new Map();
    transactions.forEach((item) => {
      const name = item.atendente || "Sem atendente";
      const row = map.get(name) || { name, sales: 0, revenue: 0 };
      row.sales += 1;
      row.revenue += item.valor;
      map.set(name, row);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }

  function renderAttendantChart(rows) {
    const chart = document.getElementById("attendantsChart");
    const max = Math.max(1, ...rows.map((row) => row.revenue));
    const totalRevenue = sum(rows.map((row) => row.revenue));
    chart.innerHTML = rows
      .map(
        (row, index) => {
          const revenueShare = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
          return `
          <div class="bar-row" style="--row-delay:${Math.min(index * 55, 420)}ms">
            <strong>${escapeHtml(row.name)}</strong>
            <div class="bar-track"><div class="bar-fill" style="--bar-width:${Math.max(4, (row.revenue / max) * 100)}%"></div></div>
            <span>${money(row.revenue)} · ${integer(row.sales)} vendas</span>
          </div>`;
        }
      )
      .join("");
    chart.querySelectorAll(".bar-row").forEach((node, index) => {
      const row = rows[index];
      const revenueShare = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
      node.querySelector("span").textContent = `${percent(revenueShare)} da receita · ${money(row.revenue)} · ${integer(row.sales)} vendas`;
    });
  }

  function renderProducts() {
    const rows = getProductRows();
    const tbody = document.getElementById("productsBody");
    const empty = document.getElementById("productsEmpty");
    if (!tbody || !empty) return;
    const totalRevenue = sum(rows.map((row) => row.revenue));
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const share = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td>${integer(row.sales)}</td>
        <td>${money(row.revenue)}</td>
        <td>${row.sales ? money(row.revenue / row.sales) : "N/A"}</td>
        <td>${percent(share)}</td>
      `;
      tbody.append(tr);
    });
    if (rows.length) {
      const totalSales = sum(rows.map((row) => row.sales));
      const totalRow = document.createElement("tr");
      totalRow.className = "products-total-row";
      totalRow.innerHTML = `
        <td>Total</td>
        <td>${integer(totalSales)}</td>
        <td>${money(totalRevenue)}</td>
        <td>${totalSales ? money(totalRevenue / totalSales) : "N/A"}</td>
        <td>100,0%</td>
      `;
      tbody.append(totalRow);
    }
    empty.classList.toggle("is-visible", rows.length === 0);
    renderProductsDonut(rows);
  }

  function getProductRows() {
    const map = new Map();
    state.filteredTransactions.forEach((item) => {
      const name = String(item.produto || "Sem produto").trim() || "Sem produto";
      const key = normalizeFilterValue(name);
      const row = map.get(key) || { name, sales: 0, revenue: 0 };
      row.sales += 1;
      row.revenue += item.valor;
      map.set(key, row);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }

  function renderProductsDonut(rows) {
    const donut = document.getElementById("productsDonut");
    const legend = document.getElementById("productsLegend");
    if (!donut || !legend) return;
    const totalRevenue = sum(rows.map((row) => row.revenue));
    if (!rows.length || totalRevenue <= 0) {
      donut.style.setProperty("--donut-gradient", "conic-gradient(rgba(159,232,112,.18) 0 100%)");
      donut.innerHTML = `<div class="product-donut-empty"></div>`;
      legend.innerHTML = `<div class="product-legend-item"><i style="--slice-color:rgba(159,232,112,.28)"></i><strong>Sem produtos</strong><span>0%</span></div>`;
      restartElementAnimation(donut, "is-animating");
      return;
    }
    let cursor = 0;
    const segments = rows.map((row, index) => {
      const start = cursor;
      const size = (row.revenue / totalRevenue) * 100;
      cursor += size;
      const color = productChartColors[index % productChartColors.length];
      return {
        row,
        color,
        start,
        end: cursor,
        share: row.revenue / totalRevenue
      };
    });
    donut.innerHTML = `
      <svg class="product-donut-svg" viewBox="0 0 100 100" role="img" aria-label="Receita por produto">
        ${segments.map((segment, index) => `
          <path
            class="product-slice"
            d="${describeDonutSlice(50, 50, 44, 23, segment.start * 3.6, segment.end * 3.6)}"
            fill="${segment.color}"
            data-index="${index}"
            aria-label="${escapeHtml(segment.row.name)}: ${integer(segment.row.sales)} vendas, ${money(segment.row.revenue)}"
          ></path>
        `).join("")}
      </svg>
      <div class="chart-tooltip product-donut-tooltip" hidden></div>
    `;
    restartElementAnimation(donut, "is-animating");
    const tooltip = donut.querySelector(".product-donut-tooltip");
    donut.querySelectorAll(".product-slice").forEach((slice) => {
      const segment = segments[Number(slice.dataset.index)];
      const show = (event) => showProductTooltip(event, segment, donut, tooltip);
      slice.addEventListener("mouseenter", show);
      slice.addEventListener("mousemove", show);
      slice.addEventListener("pointerdown", (event) => {
        if (isFinePointer()) return;
        event.preventDefault();
        event.stopPropagation();
        show(event);
      });
      slice.addEventListener("mouseleave", () => hideTooltip(tooltip));
    });
    legend.innerHTML = rows.slice(0, 7).map((row, index) => {
      const share = row.revenue / totalRevenue;
      const color = productChartColors[index % productChartColors.length];
      return `
        <div class="product-legend-item" style="--row-delay:${Math.min(index * 55, 420)}ms">
          <i style="--slice-color:${color}"></i>
          <strong>${escapeHtml(row.name)}</strong>
          <span>${percent(share)}</span>
        </div>`;
    }).join("");
  }

  function showProductTooltip(event, segment, donut, tooltip) {
    if (!segment || !tooltip) return;
    const rect = donut.getBoundingClientRect();
    const x = event.clientX ? event.clientX - rect.left : rect.width / 2;
    const y = event.clientY ? event.clientY - rect.top : rect.height / 2;
    hideTooltips(tooltip);
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(78, Math.min(rect.width - 78, x))}px`;
    tooltip.style.top = `${Math.max(54, Math.min(rect.height - 20, y - 8))}px`;
    tooltip.innerHTML = `
      <strong>${escapeHtml(segment.row.name)}</strong>
      <span class="tooltip-line"><b>Vendas:</b> ${integer(segment.row.sales)}</span>
      <span class="tooltip-line"><b>Faturamento:</b> ${money(segment.row.revenue)}</span>
      <span class="tooltip-line"><b>Participação:</b> ${percent(segment.share)}</span>
    `;
  }

  function isFinePointer() {
    return window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  }

  function describeDonutSlice(cx, cy, outerRadius, innerRadius, startAngle, endAngle) {
    const safeEnd = Math.min(endAngle, startAngle + 359.99);
    const outerStart = polarToCartesian(cx, cy, outerRadius, safeEnd);
    const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
    const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
    const innerEnd = polarToCartesian(cx, cy, innerRadius, safeEnd);
    const largeArcFlag = safeEnd - startAngle <= 180 ? "0" : "1";
    return [
      "M", outerStart.x, outerStart.y,
      "A", outerRadius, outerRadius, 0, largeArcFlag, 0, outerEnd.x, outerEnd.y,
      "L", innerStart.x, innerStart.y,
      "A", innerRadius, innerRadius, 0, largeArcFlag, 1, innerEnd.x, innerEnd.y,
      "Z"
    ].join(" ");
  }

  function polarToCartesian(cx, cy, radius, angle) {
    const radians = (angle - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(radians),
      y: cy + radius * Math.sin(radians)
    };
  }

  function renderSettingsPages() {
    renderGoalSettings();
    renderLeadMetricOptions();
    renderAttendantCostOptions();
    renderRefundMetricOptions();
    renderFrontProductsSettings();
    renderManualSalePermissionSettings();
    bindSettingsMirrorEditButtons();
    bindSettingsDraftEvents();
  }

  function renderAttendantCostOptions() {
    if (!els.attendantCostOptions) return;
    els.attendantCostOptions.querySelectorAll("[data-attendant-cost]").forEach((input) => {
      input.checked = Boolean(state.attendantCostOptions && state.attendantCostOptions[input.dataset.attendantCost]);
    });
  }

  function renderRefundMetricOptions() {
    if (!els.refundMetricOptions) return;
    els.refundMetricOptions.querySelectorAll("[data-refund-metric]").forEach((input) => {
      input.checked = Boolean(state.refundMetricOptions && state.refundMetricOptions[input.dataset.refundMetric]);
    });
  }

  function renderGoalSettings() {
    const list = document.getElementById("goalsSettingsList");
    if (!list) return;
    const query = normalizeSearchText(els.goalsSearch ? els.goalsSearch.value : "");
    const goals = (state.goalConfigs || []).filter((goal) => {
      const haystack = normalizeSearchText(`${goal.slug || ""} ${goal.title || ""} ${goal.prize || ""}`);
      return !query || haystack.includes(query);
    });
    if (!goals.length) {
      list.innerHTML = `<p class="settings-empty">Nenhuma meta cadastrada ainda.</p>`;
      return;
    }
    list.innerHTML = goals.map((goal) => `
      <div class="settings-table-row settings-goal-row" data-settings-draft-key="goal:${escapeHtml(`${goal.slug || ""}:${goal.title || ""}`)}">
        <input data-goal-field="slug" value="${escapeHtml(goal.slug || "")}" aria-label="Atendente" readonly>
        <input data-goal-field="title" value="${escapeHtml(goal.title)}" aria-label="Meta" readonly>
        <input data-goal-field="value" value="${escapeHtml(decimal(goal.value || 0))}" inputmode="decimal" aria-label="Valor" readonly>
        <input data-goal-field="prize" value="${escapeHtml(goal.prize || "")}" aria-label="Prêmio" readonly>
        <select data-goal-field="active" aria-label="Status" disabled>
          <option value="TRUE" ${goal.active ? "selected" : ""}>Ativa</option>
          <option value="FALSE" ${!goal.active ? "selected" : ""}>Inativa</option>
        </select>
        <div class="settings-row-actions">
          <button class="settings-row-edit-button" type="button" aria-label="Editar meta ${escapeHtml(goal.title)}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm15.71-10.04a1 1 0 0 0 0-1.41L18.2 4.29a1 1 0 0 0-1.41 0l-1.02 1.02 2.75 2.75 1.19-1.19Z"></path></svg>
          </button>
          <button class="settings-save-button" type="button" data-settings-edit="goal" data-slug="${escapeHtml(goal.slug || "")}" data-title="${escapeHtml(goal.title)}" data-value="${escapeHtml(String(goal.value || 0))}" data-prize="${escapeHtml(goal.prize || "")}" data-active="${goal.active ? "true" : "false"}">Salvar</button>
          <button class="settings-delete-button" type="button" data-settings-delete="goal" data-slug="${escapeHtml(goal.slug || "")}" data-title="${escapeHtml(goal.title)}" aria-label="Excluir meta ${escapeHtml(goal.title)}">Apagar</button>
        </div>
      </div>
    `).join("");
    bindSettingsMirrorEditButtons();
  }

  function renderLeadMetricOptions() {
    if (!els.leadMetricOptions) return;
    els.leadMetricOptions.querySelectorAll("[data-lead-source]").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.leadSource === state.leadMetricSource);
      button.setAttribute("aria-pressed", button.dataset.leadSource === state.leadMetricSource ? "true" : "false");
    });
  }

  function renderFrontProductsSettings() {
    if (!els.frontProductsList) return;
    const query = normalizeSearchText(els.productsSearch ? els.productsSearch.value : "");
    const products = getConfigProductRows().filter((product) => !query || normalizeSearchText(product.name).includes(query));
    if (!products.length) {
      els.frontProductsList.innerHTML = `<p class="settings-empty">Nenhum produto cadastrado ainda.</p>`;
      return;
    }
    els.frontProductsList.innerHTML = products.map((product) => {
      const key = normalizeFilterValue(product.name);
      const isFront = product.front || state.frontProducts.includes(key);
      return `
        <div class="settings-table-row settings-product-row" data-settings-draft-key="product:${escapeHtml(product.name)}">
          <input data-product-field="name" data-locked-field value="${escapeHtml(product.name)}" readonly aria-label="Produto">
          <input data-product-field="fixed" value="${escapeHtml(decimal(product.fixed || 0))}" inputmode="decimal" aria-label="Custo fixo" readonly>
          <input data-product-field="percent" value="${escapeHtml(decimal(product.percent || 0))}" inputmode="decimal" aria-label="Custo percentual" readonly>
          <select data-front-toggle value="${escapeHtml(key)}" aria-label="Produto de front" disabled>
            <option value="yes" ${isFront ? "selected" : ""}>Sim</option>
            <option value="no" ${!isFront ? "selected" : ""}>Não</option>
          </select>
          <div class="settings-row-actions">
            <button class="settings-row-edit-button" type="button" aria-label="Editar produto ${escapeHtml(product.name)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm15.71-10.04a1 1 0 0 0 0-1.41L18.2 4.29a1 1 0 0 0-1.41 0l-1.02 1.02 2.75 2.75 1.19-1.19Z"></path></svg>
            </button>
            <button class="settings-save-button" type="button" data-settings-edit="product" data-name="${escapeHtml(product.name)}" data-fixed="${escapeHtml(String(product.fixed || 0))}" data-percent="${escapeHtml(String(product.percent || 0))}" data-front="${isFront ? "true" : "false"}">Salvar</button>
            <button class="settings-delete-button" type="button" data-settings-delete="product" data-name="${escapeHtml(product.name)}" aria-label="Excluir produto ${escapeHtml(product.name)}">Apagar</button>
          </div>
        </div>`;
    }).join("");
  }

  function renderManualSalePermissionSettings() {
    if (!els.manualSaleAttendantsList) return;
    const query = normalizeSearchText(els.attendantsSearch ? els.attendantsSearch.value : "");
    const attendants = getConfigAttendantRows().filter((attendant) => !query || normalizeSearchText(attendant.name).includes(query));
    if (!attendants.length) {
      els.manualSaleAttendantsList.innerHTML = `<p class="settings-empty">Nenhum atendente cadastrado ainda.</p>`;
      return;
    }
    els.manualSaleAttendantsList.innerHTML = attendants.map((attendant) => {
      const key = normalizeFilterValue(attendant.name);
      return `
        <div class="settings-table-row settings-attendant-row" data-settings-draft-key="attendant:${escapeHtml(attendant.slug || attendant.name)}">
          <input data-attendant-field="name" value="${escapeHtml(attendant.name)}" aria-label="Nome" readonly>
          <input data-attendant-field="commission" value="${escapeHtml(decimal(attendant.commission || 0))}" inputmode="decimal" aria-label="Comissão" readonly>
          <input data-attendant-field="salary" value="${escapeHtml(decimal(attendant.salary || 0))}" inputmode="decimal" aria-label="Fixo mensal" readonly>
          <input data-attendant-field="start" value="${escapeHtml(attendant.start || "")}" placeholder="aaaa-mm-dd" aria-label="Início" readonly>
          <input data-attendant-field="pauses" value="${escapeHtml(attendant.pauses || "")}" placeholder="Sem pausas" aria-label="Pausas" readonly>
          <select data-manual-toggle aria-label="Permitir lançamento manual" disabled>
            <option value="yes" ${state.manualSalePermissions.includes(key) ? "selected" : ""}>Sim</option>
            <option value="no" ${!state.manualSalePermissions.includes(key) ? "selected" : ""}>Não</option>
          </select>
          <div class="settings-row-actions">
            <button class="settings-row-edit-button" type="button" aria-label="Editar atendente ${escapeHtml(attendant.name)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm15.71-10.04a1 1 0 0 0 0-1.41L18.2 4.29a1 1 0 0 0-1.41 0l-1.02 1.02 2.75 2.75 1.19-1.19Z"></path></svg>
            </button>
            <button class="settings-save-button" type="button" data-settings-edit="attendant" data-slug="${escapeHtml(attendant.slug || "")}" data-name="${escapeHtml(attendant.name)}" data-commission="${escapeHtml(String(attendant.commission || 0))}" data-salary="${escapeHtml(String(attendant.salary || 0))}" data-start="${escapeHtml(attendant.start || "")}" data-pauses="${escapeHtml(attendant.pauses || "")}">Salvar</button>
            <button class="settings-delete-button" type="button" data-settings-delete="attendant" data-slug="${escapeHtml(attendant.slug || "")}" data-name="${escapeHtml(attendant.name)}" aria-label="Excluir atendente ${escapeHtml(attendant.name)}">Apagar</button>
          </div>
        </div>`;
    }).join("");
    bindSettingsMirrorEditButtons();
  }

  function bindSettingsMirrorEditButtons() {
    document.querySelectorAll("[data-settings-edit]").forEach((button) => {
      if (button.dataset.bound === "1") return;
      button.dataset.bound = "1";
      button.addEventListener("click", async () => {
        try {
          if (button.dataset.settingsEdit === "product") {
            await editProductCostFromButton(button);
          } else if (button.dataset.settingsEdit === "goal") {
            await editGoalFromButton(button);
          } else {
            await editAttendantFromButton(button);
          }
        } catch (error) {
          if (error && error.name === "AbortError") return;
          alert(error && error.message ? error.message : "Não foi possível salvar agora.");
        }
      });
    });
    document.querySelectorAll("[data-settings-delete]").forEach((button) => {
      if (button.dataset.bound === "1") return;
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        const row = button.closest(".settings-table-row");
        if (!row) return;
        markSettingsRowDraft(row, "delete");
      });
    });
  }

  function bindSettingsDraftEvents() {
    document.querySelectorAll(".settings-table-row").forEach((row) => {
      if (row.dataset.draftEventsBound === "1") return;
      row.dataset.draftEventsBound = "1";
      const editButton = row.querySelector(".settings-row-edit-button");
      if (editButton) {
        editButton.addEventListener("click", () => {
          const isEditing = row.classList.toggle("is-editing");
          row.querySelectorAll("input").forEach((input) => {
            if (!input.hasAttribute("data-locked-field")) input.readOnly = !isEditing;
          });
          row.querySelectorAll("select").forEach((select) => {
            select.disabled = !isEditing;
            enhanceSelect(select);
          });
          if (isEditing) {
            const firstField = row.querySelector("input:not([data-locked-field]), select");
            if (firstField) firstField.focus();
          }
        });
      }
      row.querySelectorAll("input, select").forEach((field) => {
        field.addEventListener("focus", () => row.classList.add("is-editing"));
        field.addEventListener("input", () => markSettingsRowDraft(row, "save"));
        field.addEventListener("change", () => markSettingsRowDraft(row, "save"));
      });
    });
  }

  function markSettingsRowDraft(row, action) {
    const key = row.dataset.settingsDraftKey;
    if (!key) return;
    state.settingsDrafts[key] = { key, action: action || "save" };
    row.classList.add("is-draft-row");
    row.classList.toggle("is-delete-draft", action === "delete");
    updateRefreshButtonState();
    showNotificationSavedToast(action === "delete" ? "Exclusão em rascunho" : "Rascunho salvo");
  }

  async function deleteSettingsRowFromButton(button, options = {}) {
    const type = button.dataset.settingsDelete;
    const label = button.dataset.title || button.dataset.name || button.dataset.slug || "linha";
    if (options.confirm !== false && !window.confirm(`Apagar ${label}?`)) return;
    const payload = new FormData();
    payload.set("mutation_id", createMutationId(`delete-${type}`));
    if (type === "goal") {
      payload.set("action", "deleteGoal");
      payload.set("slug", button.dataset.slug || "");
      payload.set("meta_titulo", button.dataset.title || "");
    } else if (type === "product") {
      payload.set("action", "deleteProductCost");
      payload.set("produto", button.dataset.name || "");
    } else {
      payload.set("action", "deleteAttendant");
      payload.set("slug", button.dataset.slug || "");
      payload.set("nome", button.dataset.name || "");
    }
    await submitMutation(payload);
    showNotificationSavedToast("Linha apagada");
    if (options.refresh !== false) await refreshData({ applySelection: true });
  }

  async function editGoalFromButton(button, options = {}) {
    const row = button.closest(".settings-goal-row");
    const currentTitle = button.dataset.title || "";
    const slug = getSettingsFieldValue(row, "[data-goal-field='slug']", button.dataset.slug || "");
    const title = getSettingsFieldValue(row, "[data-goal-field='title']", currentTitle);
    const value = getSettingsFieldValue(row, "[data-goal-field='value']", decimal(Number(button.dataset.value || 0)));
    const prize = getSettingsFieldValue(row, "[data-goal-field='prize']", button.dataset.prize || "");
    const active = getSettingsFieldValue(row, "[data-goal-field='active']", button.dataset.active === "true" ? "TRUE" : "FALSE");
    if (!slug.trim()) {
      alert("Informe o slug da atendente.");
      return;
    }
    if (!title.trim()) {
      alert("Informe o título da meta.");
      return;
    }
    const payload = new FormData();
    payload.set("action", "updateGoal");
    payload.set("slug", slug.trim());
    payload.set("meta_titulo", title.trim() || currentTitle || "Meta");
    payload.set("meta_titulo_original", currentTitle);
    payload.set("meta_valor", value);
    payload.set("meta_premio", prize);
    payload.set("meta_ativa", active);
    payload.set("mutation_id", createMutationId("goal"));
    await submitMutation(payload);
    showNotificationSavedToast("Meta salva");
    if (options.refresh !== false) await refreshData({ applySelection: true });
  }

  async function editProductCostFromButton(button, options = {}) {
    const row = button.closest(".settings-product-row");
    const product = getSettingsFieldValue(row, "[data-product-field='name']", button.dataset.name || "");
    const fixed = getSettingsFieldValue(row, "[data-product-field='fixed']", decimal(Number(button.dataset.fixed || 0)));
    const percentValue = getSettingsFieldValue(row, "[data-product-field='percent']", decimal(Number(button.dataset.percent || 0)));
    const frontValue = getSettingsFieldValue(row, "[data-front-toggle]", button.dataset.front === "true" ? "yes" : "no");
    if (!product.trim()) {
      alert("Produto não informado.");
      return;
    }
    const payload = new FormData();
    payload.set("action", "updateProductCost");
    payload.set("produto", product);
    payload.set("custo_fixo", fixed);
    payload.set("custo_percentual", percentValue);
    payload.set("front", frontValue === "yes" ? "TRUE" : "FALSE");
    payload.set("mutation_id", createMutationId("product-cost"));
    await submitMutation(payload);
    const productKey = normalizeFilterValue(product);
    state.frontProducts = frontValue === "yes"
      ? Array.from(new Set(state.frontProducts.concat(productKey)))
      : state.frontProducts.filter((item) => item !== productKey);
    saveStringList("hsbi-front-products", state.frontProducts);
    showNotificationSavedToast("Produto salvo");
    if (options.refresh !== false) await refreshData({ applySelection: true });
  }

  async function editAttendantFromButton(button, options = {}) {
    const row = button.closest(".settings-attendant-row");
    const currentName = button.dataset.name || "";
    const name = getSettingsFieldValue(row, "[data-attendant-field='name']", currentName);
    const commission = getSettingsFieldValue(row, "[data-attendant-field='commission']", decimal(Number(button.dataset.commission || 0)));
    const salary = getSettingsFieldValue(row, "[data-attendant-field='salary']", decimal(Number(button.dataset.salary || 0)));
    const start = getSettingsFieldValue(row, "[data-attendant-field='start']", button.dataset.start || "");
    const pauses = getSettingsFieldValue(row, "[data-attendant-field='pauses']", button.dataset.pauses || "");
    const manualValue = getSettingsFieldValue(row, "[data-manual-toggle]", "no");
    if (!name.trim()) {
      alert("Informe o nome do atendente.");
      return;
    }
    const payload = new FormData();
    payload.set("action", "updateAttendant");
    payload.set("slug", button.dataset.slug || normalizeFilterValue(currentName).replace(/[^a-z0-9]+/g, "-"));
    payload.set("nome", name.trim() || currentName);
    payload.set("nome_original", currentName);
    payload.set("comissao_percentual", commission);
    payload.set("salario_fixo_mensal", salary);
    payload.set("inicio_trabalho", start);
    payload.set("pausas", pauses);
    payload.set("lancar_vendas", manualValue === "yes" ? "TRUE" : "FALSE");
    payload.set("mutation_id", createMutationId("attendant"));
    await submitMutation(payload);
    const attendantKey = normalizeFilterValue(name.trim() || currentName);
    state.manualSalePermissions = manualValue === "yes"
      ? Array.from(new Set(state.manualSalePermissions.concat(attendantKey)))
      : state.manualSalePermissions.filter((item) => item !== attendantKey);
    saveStringList("hsbi-manual-sale-attendants", state.manualSalePermissions);
    showNotificationSavedToast("Atendente salvo");
    if (options.refresh !== false) await refreshData({ applySelection: true });
  }

  function getSettingsFieldValue(row, selector, fallback = "") {
    const field = row ? row.querySelector(selector) : null;
    if (!field) return fallback;
    return "value" in field ? field.value : field.textContent || fallback;
  }

  function getConfigAttendantRows() {
    const byName = new Map();
    (state.attendantConfigs || []).forEach((item) => {
      const name = item.name || item.slug;
      if (!name || normalizeFilterValue(name) === "sem-atendente") return;
      byName.set(normalizeFilterValue(name), Object.assign({ name }, item));
    });
    getAttendantSelectOptions("").forEach((name) => {
      if (!name || name === "Sem atendente") return;
      const key = normalizeFilterValue(name);
      if (!byName.has(key)) byName.set(key, { name, commission: 0, salary: 0, start: "", pauses: "" });
    });
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function getConfigProductRows() {
    const byName = new Map();
    getProductSelectOptions("").forEach((name) => {
      if (!name || name === "Sem produto") return;
      byName.set(normalizeFilterValue(name), { name, fixed: 0, percent: 0, front: false });
    });
    if (state.costs && state.costs.forEach) {
      state.costs.forEach((cost, key) => {
        const name = cost.product || key;
        byName.set(key, { name, fixed: Number(cost.fixed || 0), percent: Number(cost.percent || 0), front: Boolean(cost.front) });
      });
    }
    return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  function restartElementAnimation(element, className) {
    if (!element || !canAnimateDashboard()) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  function renderTransactions() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) => {
      const phone = formatPhone(item.telefone);
      const haystack = `${item.pagador} ${phone} ${digitsOnly(phone)} ${item.atendente} ${item.produto} ${item.valor} ${money(item.valor)} ${item.moedaOriginal} ${formatOriginalValue(item)}`.toLowerCase();
      return haystack.includes(query);
    });
    const tbody = document.getElementById("transactionsBody");
    const totalPages = Math.max(1, Math.ceil(rows.length / config.rowsPerPage));
    state.pageIndex = Math.min(state.pageIndex, totalPages);
    const start = (state.pageIndex - 1) * config.rowsPerPage;
    const visible = rows.slice(start, start + config.rowsPerPage);
    tbody.innerHTML = "";

    if (!visible.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7">Nenhuma transação encontrada.</td>`;
      tbody.append(tr);
    } else {
      visible.forEach((item) => {
        const tr = document.createElement("tr");
        if (item.isDraft) tr.classList.add("is-draft-row");
        tr.innerHTML = `
          <td>${formatIsoDateBr(item.data)}</td>
          <td>${escapeHtml(item.hora)}</td>
          <td class="payer-cell">${escapeHtml(item.pagador)}</td>
          <td>${escapeHtml(formatPhone(item.telefone))}</td>
          <td class="attendant-cell">${escapeHtml(item.atendente)}<small>${escapeHtml(item.produto || "Sem produto")}</small></td>
          <td>${escapeHtml(item.moedaOriginal)}</td>
          <td class="transaction-value-cell">
            <span>${formatOriginalValue(item)}</span>
            ${item.isDraft ? '<small class="draft-label">Rascunho</small>' : ""}
            <button class="transaction-edit-button" type="button" data-id="${escapeHtml(item.id)}" aria-label="Editar transação">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.25V20h2.75L17.8 8.95l-2.75-2.75L4 17.25zm15.92-11.17a1 1 0 0 0 0-1.42l-.58-.58a1 1 0 0 0-1.42 0l-1.16 1.16 2.75 2.75 1.41-1.41z"></path></svg>
            </button>
          </td>
        `;
        tbody.append(tr);
      });
      tbody.querySelectorAll(".transaction-edit-button").forEach((button) => {
        button.addEventListener("click", () => openTransactionEditor(button.dataset.id));
      });
    }

    els.pageInfo.textContent = `Página ${state.pageIndex} de ${totalPages}`;
    els.prevPage.disabled = state.pageIndex <= 1;
    els.nextPage.disabled = state.pageIndex >= totalPages;
  }

  function getTotalPages() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) =>
      `${item.pagador} ${formatPhone(item.telefone)} ${digitsOnly(item.telefone)} ${item.atendente} ${item.produto} ${item.valor} ${money(item.valor)} ${item.moedaOriginal} ${formatOriginalValue(item)}`.toLowerCase().includes(query)
    );
    return Math.max(1, Math.ceil(rows.length / config.rowsPerPage));
  }

  function renderNotificationSummary() {
    const summary = document.getElementById("notificationSummary");
    updateSaleNotificationPreview();
    if (!summary) return;
    const preview = buildReportPreview();
    summary.textContent = preview.body;
    if (els.reportPreviewTitle) els.reportPreviewTitle.textContent = preview.title;
  }

  function renderNotifications() {
    els.enableAllNotifications.textContent = areAllNotificationsEnabled() ? "Desativar todos" : "Ativar todos";
    if (els.saleNotificationList) {
      els.saleNotificationList.innerHTML = `
        <label class="notification-row sale-notification-row">
          <span>Notificações de venda</span>
          <span class="switch">
            <input type="checkbox" data-notification="sales" ${isSaleNotificationsEnabled() ? "checked" : ""}>
            <span class="slider"></span>
          </span>
        </label>
        <label class="notification-row sale-notification-row">
          <span>Mostrar atendente</span>
          <span class="switch">
            <input type="checkbox" data-notification="sale-attendant" ${state.notifications.saleShowAttendant !== false ? "checked" : ""}>
            <span class="slider"></span>
          </span>
        </label>`;
      const saleInput = els.saleNotificationList.querySelector('[data-notification="sales"]');
      const saleAttendantInput = els.saleNotificationList.querySelector('[data-notification="sale-attendant"]');
      saleInput.addEventListener("change", async () => {
        const previous = state.notifications.salesEnabled;
        state.notifications.salesEnabled = saleInput.checked;
        saveNotificationPrefs();
        renderNotifications();
        try {
          await syncOwnerPush();
          showNotificationSavedToast();
        } catch (error) {
          state.notifications.salesEnabled = previous;
          saveNotificationPrefs();
          renderNotifications();
          alert(error.message);
        }
      });
      saleAttendantInput.addEventListener("change", async () => {
        const previous = state.notifications.saleShowAttendant;
        state.notifications.saleShowAttendant = saleAttendantInput.checked;
        saveNotificationPrefs();
        renderNotifications();
        updateSaleNotificationPreview();
        try {
          await syncOwnerPush();
          showNotificationSavedToast();
        } catch (error) {
          state.notifications.saleShowAttendant = previous;
          saveNotificationPrefs();
          renderNotifications();
          updateSaleNotificationPreview();
          alert(error.message);
        }
      });
    }
    els.notificationList.innerHTML = notificationTimes
      .map(
        (time) => `
          <label class="notification-row">
            <span>Notificação das ${time}</span>
            <span class="switch">
              <input type="checkbox" data-time="${time}" ${state.notifications[time] ? "checked" : ""}>
              <span class="slider"></span>
            </span>
          </label>`
      )
      .join("");

    if (els.reportStyleOptions) {
      const styles = [
        ["profit_status", "Status de lucro"],
        ["detailed", "Resumo detalhado"],
        ["creative", "Notificações criativas"]
      ];
      els.reportStyleOptions.innerHTML = styles.map(([value, label]) => `
        <label class="report-style-option ${getReportStyle() === value ? "is-active" : ""}">
          <input type="radio" name="reportStyle" value="${value}" ${getReportStyle() === value ? "checked" : ""}>
          <span>${label}</span>
        </label>`).join("");
      els.reportStyleOptions.querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", async () => {
          const previous = state.notifications.reportStyle;
          state.notifications.reportStyle = input.value;
          saveNotificationPrefs();
          renderNotifications();
          renderNotificationSummary();
          try {
            await syncOwnerPush();
            showNotificationSavedToast();
          } catch (error) {
            state.notifications.reportStyle = previous;
            saveNotificationPrefs();
            renderNotifications();
            renderNotificationSummary();
            alert(error.message);
          }
        });
      });
    }

    els.notificationList.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", async () => {
        const previous = state.notifications[input.dataset.time];
        state.notifications[input.dataset.time] = input.checked;
        saveNotificationPrefs();
        renderNotifications();
        try {
          await syncOwnerPush();
          showNotificationSavedToast();
        } catch (error) {
          state.notifications[input.dataset.time] = previous;
          saveNotificationPrefs();
          renderNotifications();
          alert(error.message);
        }
      });
    });
  }

  function areAllNotificationsEnabled() {
    return isSaleNotificationsEnabled() && notificationTimes.every((time) => state.notifications[time]);
  }

  function isSaleNotificationsEnabled() {
    return state.notifications.salesEnabled !== false;
  }

  function updateSaleNotificationPreview() {
    const body = document.getElementById("saleNotificationPreviewBody");
    if (!body) return;
    body.textContent = state.notifications.saleShowAttendant === false
      ? "Valor: R$ 99,90"
      : "Valor: R$ 99,90 • Nome do atendente";
    body.hidden = false;
  }

  function getReportStyle() {
    return ["profit_status", "detailed", "creative"].includes(state.notifications.reportStyle)
      ? state.notifications.reportStyle
      : "detailed";
  }

  async function syncOwnerPush(force) {
    const pushClient = await ensurePushClient();
    const times = notificationTimes.filter((time) => state.notifications[time]);
    const preferences = {
      enabled: isSaleNotificationsEnabled() || times.length > 0,
      times,
      salesEnabled: isSaleNotificationsEnabled(),
      saleShowAttendant: state.notifications.saleShowAttendant !== false,
      reportStyle: getReportStyle()
    };
    return force
      ? pushClient.sync("owner", preferences)
      : pushClient.update("owner", preferences);
  }

  function showNotificationSavedToast(message = "Alteração salva") {
    let toast = document.getElementById("notificationSaveToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "notificationSaveToast";
      toast.className = "notification-save-toast";

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "\u2713";

      const text = document.createElement("strong");
      text.textContent = message;

      toast.append(icon, text);
      document.body.appendChild(toast);
    }
    const text = toast.querySelector("strong");
    if (text) text.textContent = message;

    window.clearTimeout(notificationToastTimer);
    toast.classList.add("is-visible");
    notificationToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2200);
  }

  function ensurePushClient() {
    if (window.HSBIPush) return Promise.resolve(window.HSBIPush);
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-push-client="dynamic"]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.HSBIPush), { once: true });
        existing.addEventListener("error", () => reject(new Error("Não foi possível carregar o módulo de notificações.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "../push-client.js?v=63";
      script.dataset.pushClient = "dynamic";
      script.onload = () => window.HSBIPush
        ? resolve(window.HSBIPush)
        : reject(new Error("O módulo de notificações não foi inicializado."));
      script.onerror = () => reject(new Error("Não foi possível carregar o módulo de notificações."));
      document.head.appendChild(script);
    });
  }

  function buildNotificationText() {
    return `Seu investimento está em ${money(state.metrics.totalSpend || 0)}, com faturamento em ${money(state.metrics.revenue || 0)}, com um CPA de ${state.metrics.cpa == null ? "N/A" : money(state.metrics.cpa)} e um ROI de ${state.metrics.roas == null ? "0,00" : decimal(state.metrics.roas)}.`;
  }

  function buildReportPreview() {
    const style = getReportStyle();
    const profit = Number(state.metrics.profit || 0);
    const hasProfit = profit >= 0;
    if (style === "profit_status") {
      return hasProfit
        ? { title: "Parabéns!", body: `O dia está finalizando e você lucrou ${money(profit)}!` }
        : { title: "Não desanime.", body: `O dia está finalizando com ${money(Math.abs(profit))} de prejuízo. Ajuste a rota e siga em frente.` };
    }
    if (style === "creative") {
      return hasProfit
        ? { title: "Dois reais ou um lucro misterioso?", body: `Parabéns! Você teve ${money(profit)} de lucro até agora... 🤑🤑🤑` }
        : { title: "Respira, ajusta e continua.", body: `O resultado está em ${money(Math.abs(profit))} de prejuízo agora. Um dia não define a operação.` };
    }
    return { title: "Resumo das Campanhas!", body: buildNotificationText() };
  }

  function loadNotificationPrefs() {
    try {
      return Object.assign({ salesEnabled: true, saleShowAttendant: true, reportStyle: "detailed" }, JSON.parse(localStorage.getItem("hsbi-notifications") || "{}"));
    } catch {
      return {};
    }
  }

  function loadLeadMetricSource() {
    return localStorage.getItem("hsbi-lead-metric-source") === "leads" ? "leads" : "conversations";
  }

  function loadStringList(key) {
    try {
      const list = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(list) ? list.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }

  function saveStringList(key, list) {
    localStorage.setItem(key, JSON.stringify(Array.isArray(list) ? list : []));
  }

  function loadAttendantCostOptions() {
    try {
      return Object.assign({ commission: false, fixed: false }, JSON.parse(localStorage.getItem("hsbi-attendant-cost-options") || "{}"));
    } catch {
      return { commission: false, fixed: false };
    }
  }

  function saveAttendantCostOptions() {
    localStorage.setItem("hsbi-attendant-cost-options", JSON.stringify(state.attendantCostOptions || {}));
  }

  function loadRefundMetricOptions() {
    try {
      return Object.assign({ enabled: false }, JSON.parse(localStorage.getItem("hsbi-refund-metric-options") || "{}"));
    } catch {
      return { enabled: false };
    }
  }

  function saveRefundMetricOptions() {
    localStorage.setItem("hsbi-refund-metric-options", JSON.stringify(state.refundMetricOptions || {}));
  }

  function saveNotificationPrefs() {
    localStorage.setItem("hsbi-notifications", JSON.stringify(state.notifications));
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("../sw.js?v=63").then((registration) => registration.update()).catch(console.error);
    }
  }

  function getMetaForCurrentPeriod() {
    return applyAccountFilterToMeta(getRawMetaForCurrentPeriod());
  }

  function getTotalSpendForPeriod(period) {
    const meta = applyAccountFilterToMeta(period === "custom"
      ? Object.assign({ spend: 0, leads: 0 }, state.customMeta || {})
      : Object.assign({ spend: 0, leads: 0 }, state.metaByPeriod[period] || {}));
    const ads = Number(meta.spend || 0);
    return ads + ads * Number(config.metaTaxRate || 0);
  }

  function getRawMetaForCurrentPeriod() {
    return state.appliedPeriod === "custom"
      ? Object.assign({ spend: 0, leads: 0, daily: [] }, state.customMeta || {})
      : Object.assign({ spend: 0, leads: 0, daily: [] }, state.metaByPeriod[state.appliedPeriod] || {});
  }

  function getTotalSpendForDate(period, dateKey) {
    const meta = applyAccountFilterToMeta(period === "custom"
      ? Object.assign({ spend: 0, leads: 0, daily: [] }, state.customMeta || {})
      : Object.assign({ spend: 0, leads: 0, daily: [] }, state.metaByPeriod[period] || {}));
    const day = (Array.isArray(meta.daily) ? meta.daily : []).find((item) => item.date === dateKey);
    const ads = Number(day ? day.spend || 0 : 0);
    return ads + ads * Number(config.metaTaxRate || 0);
  }

  function getProfitForDate(period, dateKey, revenue, periodRevenue, fallbackSpend, productCost = 0, attendantCost = 0) {
    if (hasSalesDimensionFilter()) return null;
    const meta = applyAccountFilterToMeta(period === "custom"
      ? Object.assign({ spend: 0, leads: 0, daily: [] }, state.customMeta || {})
      : Object.assign({ spend: 0, leads: 0, daily: [] }, state.metaByPeriod[period] || {}));
    const daily = Array.isArray(meta.daily) ? meta.daily : [];
    const day = daily.find((item) => String(item.date || "").slice(0, 10) === dateKey);
    if (!day && Number(meta.spend || 0) > 0) {
      const share = Number(periodRevenue || 0) > 0 ? Number(revenue || 0) / Number(periodRevenue || 0) : 0;
      return Number(revenue || 0) - Number(productCost || 0) - Number(attendantCost || 0) - Number(fallbackSpend || 0) * share;
    }
    const ads = Number(day ? day.spend || 0 : 0);
    const totalSpend = ads + ads * Number(config.metaTaxRate || 0);
    return Number(revenue || 0) - Number(productCost || 0) - Number(attendantCost || 0) - totalSpend;
  }

  function hasSalesDimensionFilter() {
    return state.filters.attendant !== "all" || state.filters.product !== "all";
  }

  function getTransactionProductCost(item) {
    const key = normalizeFilterValue(item && item.produto ? item.produto : "Sem produto");
    const cost = state.costs && state.costs.get ? state.costs.get(key) : null;
    if (!cost) return 0;
    const fixed = Number(cost.fixed || 0);
    const percent = Number(cost.percent || 0);
    const value = Number(item && item.valor || 0);
    const total = (Number.isFinite(fixed) ? fixed : 0) + value * ((Number.isFinite(percent) ? percent : 0) / 100);
    return Number.isFinite(total) ? total : 0;
  }

  function getAttendantCosts(transactions) {
    const options = state.attendantCostOptions || {};
    if (!options.commission && !options.fixed) return 0;
    const configs = buildAttendantConfigMap();
    let total = 0;
    if (options.commission) {
      total += sum(transactions.map((item) => {
        const config = configs.get(normalizeFilterValue(item.atendente || "Sem atendente"));
        const commission = Number(config && config.commission || 0);
        return Number(item.valor || 0) * (Number.isFinite(commission) ? commission / 100 : 0);
      }));
    }
    if (options.fixed) {
      const range = getDateRange();
      total += Array.from(configs.values()).reduce((cost, config) => {
        const salary = Number(config.salary || 0);
        if (!Number.isFinite(salary) || salary <= 0) return cost;
        return cost + (salary / 30) * countAttendantCostDays(range.start, range.end, config);
      }, 0);
    }
    return Number.isFinite(total) ? total : 0;
  }

  function getAttendantCostsForDate(transactions, dateKey) {
    const options = state.attendantCostOptions || {};
    if (!options.commission && !options.fixed) return 0;
    const configs = buildAttendantConfigMap();
    let total = 0;
    if (options.commission) {
      total += sum(transactions.map((item) => {
        const config = configs.get(normalizeFilterValue(item.atendente || "Sem atendente"));
        const commission = Number(config && config.commission || 0);
        return Number(item.valor || 0) * (Number.isFinite(commission) ? commission / 100 : 0);
      }));
    }
    if (options.fixed) {
      const day = parseMaybeDate(dateKey);
      if (day && day.getDate() !== 31) {
        total += Array.from(configs.values()).reduce((cost, config) => {
          const salary = Number(config.salary || 0);
          if (!Number.isFinite(salary) || salary <= 0) return cost;
          return countAttendantCostDays(day, day, config) ? cost + salary / 30 : cost;
        }, 0);
      }
    }
    return Number.isFinite(total) ? total : 0;
  }

  function buildAttendantConfigMap() {
    const map = new Map();
    (state.attendantConfigs || []).forEach((config) => {
      const name = config.name || config.slug;
      if (name) map.set(normalizeFilterValue(name), config);
    });
    return map;
  }

  function countAttendantCostDays(start, end, config) {
    const first = startOfDay(start);
    const last = endOfDay(end);
    const startDate = parseMaybeDate(config.start);
    const pauses = parsePauseRanges(config.pauses);
    let days = 0;
    for (let cursor = startOfDay(first); cursor <= last; cursor = addDays(cursor, 1)) {
      if (cursor.getDate() === 31) continue;
      if (startDate && cursor < startOfDay(startDate)) continue;
      if (pauses.some((pause) => cursor >= startOfDay(pause.start) && cursor <= endOfDay(pause.end))) continue;
      days += 1;
    }
    return days;
  }

  function parsePauseRanges(value) {
    return String(value || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const parts = entry.split(/\s+a\s+/i);
        const start = parseMaybeDate(parts[0]);
        const end = parseMaybeDate(parts[1] || parts[0]);
        return start && end ? { start, end } : null;
      })
      .filter(Boolean);
  }

  function parseMaybeDate(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return null;
  }

  function applyAccountFilterToMeta(meta) {
    const selected = state.filters.account;
    if (!selected || selected === "all") return meta;
    const accounts = Array.isArray(meta.accountBreakdown) ? meta.accountBreakdown : [];
    const account = accounts.find((item) => String(item.id || item.account || "") === selected);
    if (!account) return Object.assign({}, meta, { spend: 0, leads: 0 });
    return Object.assign({}, meta, {
      spend: Number(account.spend || 0),
      leads: Number(account.leads || 0),
      conversations: Number(account.conversations || 0),
      daily: Array.isArray(account.daily) ? account.daily : [],
      accountBreakdown: [account]
    });
  }

  function getPreloadRange() {
    const today = new Date();
    return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: today };
  }

  function getDateRange(periodName) {
    const period = periodName || state.appliedPeriod;
    const today = new Date();
    if (period === "yesterday") {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    if (period === "last7") return { start: addDays(today, -7), end: addDays(today, -1) };
    if (period === "month") return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    if (period === "lastMonth") {
      return {
        start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        end: new Date(today.getFullYear(), today.getMonth(), 0)
      };
    }
    if (period === "custom") {
      return periodName ? readCustomInputRange() : state.customRange || readCustomInputRange();
    }
    return { start: today, end: today };
  }

  function readCustomInputRange() {
    return { start: parseLocalDate(els.startDate.value), end: parseLocalDate(els.endDate.value) };
  }

  function getPeriodName(periodName) {
    return {
      today: "Hoje",
      yesterday: "Ontem",
      last7: "Últimos 7 dias",
      month: "Este mês",
      lastMonth: "Mês passado",
      custom: "Personalizado"
    }[periodName || state.appliedPeriod];
  }

  function setDefaultDates() {
    const today = new Date();
    els.endDate.value = toIsoDate(today);
    els.startDate.value = toIsoDate(addDays(today, -6));
    updateDateDisplays();
  }

  function formatDateInputValue(value) {
    const date = parseLocalDate(value);
    return date.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
  }

  function buildHourLabels() {
    return Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      short: String(hour).padStart(2, "0"),
      full: `${String(hour).padStart(2, "0")}h`
    }));
  }

  function buildDayLabels(start, end) {
    const labels = [];
    for (let cursor = startOfDay(start); cursor <= endOfDay(end); cursor = addDays(cursor, 1)) {
      labels.push({
        key: toIsoDate(cursor),
        short: `${String(cursor.getDate()).padStart(2, "0")}/${String(cursor.getMonth() + 1).padStart(2, "0")}`,
        full: cursor.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "").toUpperCase()
      });
    }
    return labels;
  }

  function parseDate(value) {
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function parseLocalDateTime(dateValue, timeValue) {
    if (!dateValue) return null;
    const [year, month, day] = String(dateValue).slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return null;
    const [hour, minute] = String(timeValue || "00:00").split(":").map(Number);
    return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
  }

  function parseLocalDate(value) {
    if (!value) return new Date();
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function endOfDay(date) {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  }

  function addDays(date, amount) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + amount);
    return copy;
  }

  function toIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function normalizeDateValue(value) {
    if (!value) return "";
    if (value instanceof Date) return toIsoDate(value);
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : toIsoDate(parsed);
  }

  function normalizeTimeValue(value) {
    if (!value) return "";
    if (value instanceof Date) return formatTime(value);
    const text = String(value).trim();
    const match = text.match(/(\d{1,2}):(\d{2})/);
    return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : "";
  }

  function formatIsoDateBr(value) {
    const normalized = normalizeDateValue(value);
    if (!normalized) return "";
    const [year, month, day] = normalized.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatDateBr(date) {
    return date.toLocaleDateString("pt-BR");
  }

  function formatTime(date) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatOriginalValue(item) {
    const currency = normalizeCurrency(item.moedaOriginal || item.moeda || "BRL");
    const value = Number(item.valorOriginal || 0);
    try {
      return value.toLocaleString("pt-BR", { style: "currency", currency });
    } catch {
      return `${currency} ${decimal(value)}`;
    }
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatPhone(value) {
    let digits = digitsOnly(value);
    if (!digits) return "";
    if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
    if (digits.length === 10) digits = `${digits.slice(0, 2)}9${digits.slice(2)}`;
    if (digits.length > 11) digits = digits.slice(-11);
    if (digits.length < 10) return digits;
    const ddd = digits.slice(0, 2);
    const first = digits.length === 11 ? digits.slice(2, 7) : digits.slice(2, 6);
    const second = digits.length === 11 ? digits.slice(7, 11) : digits.slice(6, 10);
    return `(${ddd}) ${first}-${second}`;
  }

  function decimal(value) {
    return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function integer(value) {
    return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }

  function percent(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function debounce(callback, wait) {
    let timeout;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => callback(...args), wait);
    };
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function setSyncText(text) {
    els.syncStatus.textContent = text;
    els.desktopSyncStatus.textContent = text;
  }

  function setRefreshButtonLoading(isLoading) {
    if (!els.refreshButton) return;
    els.refreshButton.classList.toggle("is-loading", isLoading);
    els.refreshButton.setAttribute("aria-busy", String(isLoading));
  }
})();

