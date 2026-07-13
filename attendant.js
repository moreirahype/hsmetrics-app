(function () {
  "use strict";

  const baseConfig = Object.assign(
    { apiUrl: "", rowsPerPage: 10, autoRefreshMinutes: 15 },
    window.HSBI_CONFIG || {}
  );
  const pageConfig = Object.assign({ slug: "", name: "" }, window.HSBI_ATTENDANT_CONFIG || {});
  const dataProvider = window.HSMData || null;

  const state = {
    page: "dashboard",
    period: "today",
    appliedPeriod: "today",
    customRange: null,
    transactions: [],
    goals: [],
    displayTransactions: [],
    filteredSales: [],
    manualSaleOptions: [],
    attendant: {
      nome: pageConfig.name,
      comissao_percentual: null,
      salario_fixo_mensal: 0,
      inicio_trabalho: "",
      pausas: "",
      lancar_vendas: false
    },
    pageIndex: 1,
    lastUpdated: null,
    seenSaleIds: new Set(),
    hasInitializedSales: false,
    notificationsEnabled: loadNotificationPref(),
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
    syncStatus: document.getElementById("syncStatus"),
    desktopSyncStatus: document.getElementById("desktopSyncStatus"),
    search: document.getElementById("transactionSearch"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageInfo: document.getElementById("pageInfo"),
    chart: document.getElementById("salesChart"),
    tooltip: document.getElementById("chartTooltip"),
    dailyChart: document.getElementById("dailySalesChart"),
    dailyTooltip: document.getElementById("dailyChartTooltip"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    saleNotifications: document.getElementById("saleNotifications"),
    testNotification: document.getElementById("testNotification"),
    manualSalePanel: document.getElementById("attendantManualSalePanel"),
    manualSaleForm: document.getElementById("manualSaleForm"),
    manualSaleValue: document.getElementById("manualSaleValue"),
    manualSaleCurrency: document.getElementById("manualSaleCurrency"),
    manualSalePayer: document.getElementById("manualSalePayer"),
    manualSalePhone: document.getElementById("manualSalePhone"),
    manualSaleProduct: document.getElementById("manualSaleProduct"),
    manualSaleDate: document.getElementById("manualSaleDate"),
    manualSaleTime: document.getElementById("manualSaleTime"),
    manualSaleSubmit: document.getElementById("manualSaleSubmit"),
    logoutButton: document.getElementById("logoutButton")
  };

  const metricAnimationFrames = new Map();

  let applicationStarted = false;
  function startApplication() {
    if (applicationStarted) return;
    applicationStarted = true;
    init().catch((error) => {
      console.error(error);
      document.body.classList.remove("auth-pending");
      setSyncText("Falha ao iniciar");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApplication, { once: true });
    window.setTimeout(() => {
      if (document.readyState !== "loading") startApplication();
    }, 0);
  } else {
    startApplication();
  }

  async function init() {
    if (dataProvider) {
      const context = await dataProvider.requireAuth();
      if (!context) return;
      if (context.role !== "attendant") {
        location.replace(new URL("../painel/", location.href));
        return;
      }
    }
    setDefaultDates();
    applySidebarPreference();
    bindEvents();
    setPage(location.hash.replace("#", "") || "dashboard");
    els.saleNotifications.checked = state.notificationsEnabled;
    registerServiceWorker();
    refreshData();
    window.setInterval(() => refreshData(), baseConfig.autoRefreshMinutes * 60 * 1000);
  }

  function bindEvents() {
    els.navItems.forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
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
    els.refreshButton.addEventListener("click", () => refreshData({ applySelection: true, buttonLoading: true }));
    if (els.sidebarToggle) {
      els.sidebarToggle.addEventListener("click", toggleSidebar);
    }
    if (els.logoutButton && dataProvider) {
      els.logoutButton.addEventListener("click", async () => {
        await dataProvider.signOut();
        location.replace(new URL("../", location.href));
      });
    }
    els.search.addEventListener("input", () => {
      state.pageIndex = 1;
      renderTransactions();
    });
    els.prevPage.addEventListener("click", () => {
      state.pageIndex = Math.max(1, state.pageIndex - 1);
      renderTransactions();
    });
    els.nextPage.addEventListener("click", () => {
      state.pageIndex = Math.min(getTotalPages(), state.pageIndex + 1);
      renderTransactions();
    });
    els.saleNotifications.addEventListener("change", async () => {
      const previous = state.notificationsEnabled;
      state.notificationsEnabled = Boolean(els.saleNotifications.checked);
      saveNotificationPref();
      try {
        await syncAttendantPush();
      } catch (error) {
        state.notificationsEnabled = previous;
        els.saleNotifications.checked = previous;
        saveNotificationPref();
        alert(error.message);
      }
    });
    els.testNotification.addEventListener("click", async () => {
      try {
        await syncAttendantPush(true);
        const pushClient = await ensurePushClient();
        await pushClient.test(attendantPushAudience(), {
          title: "\uD83D\uDCB0 Venda realizada!",
          body: "Valor: R$ 99,90 \u2022 Comiss\u00E3o: R$ 9,99",
          url: `${location.origin}${location.pathname}#transactions`
        });
      } catch (error) {
        alert(error.message);
      }
    });
    if (els.manualSaleForm) {
      els.manualSaleForm.addEventListener("submit", submitManualSale);
      if (els.manualSaleCurrency) {
        els.manualSaleCurrency.addEventListener("change", () => updateCurrencyPlaceholder());
        updateCurrencyPlaceholder();
      }
      if (els.manualSalePhone) {
        els.manualSalePhone.addEventListener("input", () => {
          els.manualSalePhone.value = formatPhone(els.manualSalePhone.value);
        });
      }
    }
    document.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".custom-select")) return;
      closeCustomSelects();
      if (!event.target.closest(".chart-point")) {
        hideTooltip(els.tooltip);
        hideTooltip(els.dailyTooltip);
      }
    });
    window.addEventListener("resize", debounce(() => {
      renderSalesChart();
      renderDailySalesChart();
    }, 120));
    window.addEventListener("hashchange", () => setPage(location.hash.replace("#", "") || "dashboard"));
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
    requestAnimationFrame(() => {
      renderSalesChart();
      renderDailySalesChart();
    });
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
      const payload = await fetchAttendantPayload(getPreloadRange());
      applyPayload(payload, true);
      if (state.appliedPeriod === "custom") await ensurePeriodData();
      state.lastUpdated = new Date();
      state.animateDashboard = state.page === "dashboard";
      render();
      setSyncText(`Atualizado ${formatTime(state.lastUpdated)}`);
    } catch (error) {
      console.error(error);
      applyPayload(buildEmptyPayload(), true);
      state.lastUpdated = new Date();
      state.animateDashboard = state.page === "dashboard";
      render();
      setSyncText("Sem dados");
    } finally {
      els.refreshButton.disabled = false;
      setRefreshButtonLoading(false);
    }
  }

  async function ensurePeriodData() {
    if (state.appliedPeriod !== "custom") return;
    const payload = await fetchAttendantPayload(state.customRange || readCustomInputRange());
    applyPayload(payload, false);
  }

  function applyPayload(payload, replace) {
    if (payload.attendant) {
      state.attendant = Object.assign({}, state.attendant, payload.attendant);
      if (state.attendant.nome) document.title = `HS Metrics — ${state.attendant.nome}`;
      maybeAutoSyncPush();
    }
    if (Array.isArray(payload.goals)) state.goals = payload.goals.map(normalizeGoal);
    state.manualSaleOptions = normalizeManualSaleOptions(payload.manualSaleOptions);
    const sales = (payload.transactions || []).map(normalizeSale);
    if (replace) {
      state.transactions = sales;
    } else {
      const map = new Map(state.transactions.map((item) => [item.id, item]));
      sales.forEach((item) => map.set(item.id, item));
      state.transactions = Array.from(map.values());
    }
    trackNewSales(sales);
  }

  async function fetchAttendantPayload(range) {
    if (dataProvider) return dataProvider.fetchAttendantPayload(range);
    if (!baseConfig.apiUrl) return buildEmptyPayload();
    const url = new URL(baseConfig.apiUrl);
    url.searchParams.set("action", "attendant");
    url.searchParams.set("slug", pageConfig.slug);
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

  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = `hsbiAttendantJsonp${Date.now()}${Math.floor(Math.random() * 1000)}`;
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

  function trackNewSales(sales) {
    if (!state.hasInitializedSales) {
      sales.forEach((sale) => state.seenSaleIds.add(sale.id));
      state.hasInitializedSales = true;
      return;
    }
    sales.forEach((sale) => {
      if (!state.seenSaleIds.has(sale.id)) {
        state.seenSaleIds.add(sale.id);
      }
    });
  }

  function normalizeSale(item) {
    const data = normalizeDateValue(item.data);
    const hora = normalizeTimeValue(item.hora);
    const timestamp = parseLocalDateTime(data, hora) || parseDate(item.timestamp || "");
    const gross = parseMoneyValue(item.valor || 0);
    const commissionRate = parseMoneyValue(item.comissao_percentual || state.attendant.comissao_percentual || 0);
    return {
      id: item.id || `${timestamp.getTime()}-${item.pagador || ""}-${gross}`,
      type: "sale",
      timestamp,
      data: data || toIsoDate(timestamp),
      hora: hora || formatTime(timestamp),
      pagador: item.pagador || "Sem cliente",
      telefone: item.telefone || item.phone || "",
      gross,
      commissionRate,
      value: gross * (commissionRate / 100)
    };
  }

  function normalizeGoal(item) {
    return {
      slug: item.slug || pageConfig.slug,
      meta_titulo: item.meta_titulo || "Meta",
      meta_valor: parseMoneyValue(item.meta_valor || 0),
      meta_premio: item.meta_premio || "",
      meta_ativa: item.meta_ativa !== false && String(item.meta_ativa || "true").toLowerCase() !== "false",
      meta_inicio: item.meta_inicio || ""
    };
  }

  function render() {
    renderPeriodControls();
    state.filteredSales = getFilteredSales();
    state.displayTransactions = buildDisplayTransactions();
    renderGoals();
    renderMetrics();
    renderManualSale();
    renderSalesChart();
    renderDailySalesChart();
    if (state.page === "dashboard" && state.animateDashboard) {
      state.animateDashboard = false;
    }
    renderTransactions();
    refreshCustomSelects();
  }

  function setPeriod(period) {
    if (state.period === period) return;
    state.period = period;
    state.pageIndex = 1;
    if (state.period !== "custom") state.appliedPeriod = state.period;
    if (state.page === "dashboard" && state.period !== "custom") state.animateDashboard = true;
    render();
  }

  function refreshCustomSelects() {
    document.querySelectorAll("select").forEach(enhanceSelect);
  }

  function renderManualSale() {
    if (!els.manualSalePanel || !els.manualSaleProduct) return;
    const canLaunch = Boolean(state.attendant.lancar_vendas);
    els.manualSalePanel.classList.toggle("is-hidden", !canLaunch);
    if (!canLaunch) return;
    const current = els.manualSaleProduct.value || "";
    const products = uniqueManualProductOptions();
    els.manualSaleProduct.innerHTML = products
      .map((product) => `<option value="${escapeHtml(product.value)}">${escapeHtml(product.label)}</option>`)
      .join("");
    const values = products.map((product) => product.value);
    els.manualSaleProduct.value = values.includes(current) ? current : values[0];
  }

  async function submitManualSale(event) {
    event.preventDefault();
    if (!dataProvider || typeof dataProvider.submitMutation !== "function") {
      alert("O banco de dados ainda não foi configurado.");
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
    const payload = new FormData();
    payload.set("action", "manualSale");
    payload.set("origem", "Manual");
    payload.set("moeda", normalizeCurrency(els.manualSaleCurrency ? els.manualSaleCurrency.value : "BRL"));
    payload.set("valor", String(value).replace(".", ","));
    payload.set("pagador", els.manualSalePayer.value.trim() || "Cliente manual");
    payload.set("telefone", els.manualSalePhone ? els.manualSalePhone.value.trim() : "");
    payload.set("atendente", state.attendant.nome || pageConfig.name || "");
    payload.set("produto", els.manualSaleProduct ? els.manualSaleProduct.value || "" : "");
    payload.set("timestamp", saleTimestamp.toISOString());
    payload.set("transaction_id", `manual-${saleTimestamp.getTime()}-${Math.random().toString(36).slice(2, 8)}`);
    payload.set("mutation_id", createMutationId("attendant-manual"));
    setManualSaleLoading(true);
    try {
      await dataProvider.submitMutation(payload);
      els.manualSaleForm.reset();
      updateCurrencyPlaceholder();
      await refreshData({ applySelection: true });
    } catch (error) {
      console.error(error);
      alert(error?.message || "Não foi possível adicionar a venda agora.");
    } finally {
      setManualSaleLoading(false);
    }
  }

  function setManualSaleLoading(isLoading) {
    if (!els.manualSaleSubmit) return;
    els.manualSaleSubmit.disabled = isLoading;
    els.manualSaleSubmit.textContent = isLoading ? "Adicionando..." : "Adicionar venda";
  }

  function uniqueManualProductOptions() {
    const products = normalizeManualSaleOptions(state.manualSaleOptions)
      .map((option) => option.product)
      .filter(Boolean);
    const unique = Array.from(new Set(products));
    return [{ label: "Sem produto", value: "" }].concat(unique.map((product) => ({ label: product, value: product })));
  }

  function normalizeManualSaleOptions(options) {
    const rows = Array.isArray(options) ? options : [];
    return rows.map((option) => {
      if (option && typeof option === "object") {
        return {
          attendant: String(option.atendente || option.attendant || option.nome || option.name || "").trim(),
          product: String(option.produto || option.product || "").trim()
        };
      }
      return { attendant: "", product: String(option || "").trim() };
    });
  }

  function updateCurrencyPlaceholder() {
    if (!els.manualSaleValue) return;
    const symbol = currencySymbol(normalizeCurrency(els.manualSaleCurrency ? els.manualSaleCurrency.value : "BRL"));
    els.manualSaleValue.placeholder = `${symbol} 0,00`;
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
    els.periodButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.period === state.period));
    if (els.mobilePeriodSelect) els.mobilePeriodSelect.value = state.period;
    els.customFields.classList.toggle("is-visible", state.period === "custom");
    document.getElementById("salesChartPeriod").textContent = getPeriodName(state.appliedPeriod);
    document.getElementById("dailySalesChartPeriod").textContent = getPeriodName(getDailyChartPeriod());
    updateDateDisplays();
  }

  function updateDateDisplays() {
    [els.startDate, els.endDate].forEach((input) => {
      const label = input.closest("label");
      if (label) label.dataset.display = formatDateInputValue(input.value);
    });
  }

  function renderGoals() {
    const list = document.getElementById("goalsList");
    const goals = getActiveGoals();
    list.classList.toggle("is-hidden", !goals.length);
    if (!goals.length) {
      list.innerHTML = "";
      return;
    }
    list.innerHTML = goals.map((goal) => {
      const target = Number(goal.meta_valor || 0);
      const range = getGoalRange(goal);
      const current = state.transactions
        .filter((item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end))
        .reduce((total, item) => total + item.value, 0);
      const progress = target > 0 ? current / target : 0;
      const percentValue = Math.min(100, progress * 100);
      const remaining = Math.max(0, target - current);
      const complete = progress >= 1;
      return `
        <article class="panel goal-panel${complete ? " is-complete" : ""}" style="--goal-progress:${percentValue}%">
          <div class="goal-head">
            <div>
              <h1>${escapeHtml(goal.meta_titulo || "Meta")}</h1>
              <p>${escapeHtml(goal.meta_premio || "Prêmio")}</p>
            </div>
            <span class="period-label">${percent(progress)}</span>
          </div>
          <div class="goal-track"><div class="goal-fill" style="--goal-progress:${percentValue}%"></div></div>
          <div class="goal-meta">
            <span>${money(current)}</span>
            <span>${money(target)}</span>
          </div>
          ${complete ? "" : `<div class="goal-remaining">Faltam ${money(remaining)} para bater a meta.</div>`}
          <div class="goal-complete">Parabéns! Meta batida. Avise no grupo para receber o prêmio. 🎉</div>
        </article>
      `;
    }).join("");
  }

  function getActiveGoals() {
    const activeGoals = state.goals.filter((goal) => goal.meta_ativa && Number(goal.meta_valor || 0) > 0);
    if (activeGoals.length) return activeGoals;
    return [];
  }

  function getGoalRange(goal) {
    return {
      start: goal.meta_inicio ? parseDate(goal.meta_inicio) : getWeekRange(new Date()).start,
      end: new Date()
    };
  }

  function renderMetrics() {
    const animate = state.page === "dashboard" && canAnimateDashboard();
    const sales = state.filteredSales;
    const fixed = buildFixedCredits(getDateRange()).reduce((total, item) => total + item.value, 0);
    const commission = sales.reduce((total, item) => total + item.value, 0);
    setText("metricTotalIncome", commission + fixed, { animate, formatter: money });
    setText("metricCommission", commission, { animate, formatter: money });
    setText("metricFixed", fixed, { animate, formatter: money });
    setText("metricSales", sales.length, { animate, formatter: integer });
    setText("metricRate", state.attendant.comissao_percentual == null ? "N/A" : Number(state.attendant.comissao_percentual || 0) / 100, { animate, formatter: percent });
  }

  function renderSalesChart() {
    const grouped = buildHourlySeries();
    const animateChart = state.page === "dashboard" && state.animateDashboard && canAnimateDashboard();
    const chartBox = els.chart.parentElement.getBoundingClientRect();
    const highestSales = Math.max(0, ...grouped.map((point) => point.sales));
    const maxSales = Math.max(1, Math.ceil(highestSales * 1.2));
    const left = 34;
    const right = 10;
    const top = 12;
    const bottom = 32;
    const canvasWidth = 980;
    const canvasHeight = Math.max(300, Math.round(canvasWidth * (chartBox.height / Math.max(chartBox.width, 1))));
    els.chart.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    const width = canvasWidth - left - right;
    const height = canvasHeight - top - bottom;
    const step = width / grouped.length;
    const barWidth = Math.max(7, Math.min(28, step * 0.58));
    const points = grouped.map((point, index) => {
      const x = left + index * step + step / 2;
      const y = top + height - (point.sales / maxSales) * height;
      const barHeight = Math.max(2, top + height - y);
      return Object.assign({ x, y, barX: x - barWidth / 2, barWidth, barHeight }, point);
    });
    const gridYTop = top;
    const gridYMid = top + height / 2;
    const gridYBottom = top + height;
    document.getElementById("salesChartTitle").textContent = "Vendas por horário";
    els.chart.innerHTML = `
      <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="4" class="chart-plot-bg"></rect>
      <line x1="${left}" y1="${gridYTop}" x2="${canvasWidth - right}" y2="${gridYTop}" class="grid-line"></line>
      <line x1="${left}" y1="${gridYMid}" x2="${canvasWidth - right}" y2="${gridYMid}" class="grid-line is-soft"></line>
      <line x1="${left}" y1="${gridYBottom}" x2="${canvasWidth - right}" y2="${gridYBottom}" class="axis-line"></line>
      <text x="${left - 18}" y="${gridYTop + 5}" class="axis-text">${maxSales}</text>
      <text x="${left - 18}" y="${gridYMid + 5}" class="axis-text">${Math.round(maxSales / 2)}</text>
      <text x="${left - 18}" y="${gridYBottom + 5}" class="axis-text">0</text>
      ${points.map((point) => `
        <g class="chart-point" data-index="${point.index}" style="--bar-delay:${Math.min(point.index * 8, 180)}ms">
          <rect class="sales-bar-hit" x="${point.x - Math.max(point.barWidth, 18) / 2}" y="${top}" width="${Math.max(point.barWidth, 18)}" height="${height}" rx="4"></rect>
          <rect class="sales-bar" x="${point.barX}" y="${top + height - point.barHeight}" width="${point.barWidth}" height="${point.barHeight}" rx="${Math.min(6, point.barWidth / 3)}"></rect>
          <text x="${point.x}" y="${canvasHeight - 12}" class="x-label">${shouldShowAxisLabel(point.index, grouped.length) ? point.label : ""}</text>
        </g>`).join("")}
    `;
    const chartAnimationCss = animateChart ? `
      .sales-bar{animation:chartBarIn 680ms cubic-bezier(.2,.78,.2,1) both;animation-delay:var(--bar-delay,0ms);transform-box:fill-box;transform-origin:center bottom}
      @keyframes chartBarIn{0%{opacity:0;transform:scaleY(.04)}72%{opacity:.82;transform:scaleY(1.015)}100%{opacity:.82;transform:scaleY(1)}}
    ` : "";
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .chart-plot-bg{fill:rgba(255,255,255,.012)}
      .grid-line,.axis-line{stroke:rgba(159,232,112,.18);stroke-width:1}
      .grid-line.is-soft{stroke:rgba(159,232,112,.1)}
      .chart-point,.chart-point *{pointer-events:all;cursor:pointer;outline:none}
      .sales-bar-hit{fill:transparent;stroke:transparent}
      .sales-bar{fill:#a8f078;opacity:.82;filter:drop-shadow(0 0 3px rgba(168,240,120,.14));transition:opacity 120ms ease,fill 120ms ease}
      .chart-point:hover .sales-bar,.chart-point:focus .sales-bar{opacity:1;fill:#bcff8c}
      .axis-text,.x-label{fill:#b8c0b4;font-size:var(--text-xs)}
      .axis-text{text-anchor:end}
      .x-label{text-anchor:middle}
      ${chartAnimationCss}
    `;
    els.chart.prepend(style);
    els.chart.querySelectorAll(".chart-point").forEach((node) => {
      const point = points[Number(node.dataset.index)];
      node.addEventListener("mouseenter", (event) => showTooltip(event, point, els.tooltip));
      node.addEventListener("mousemove", (event) => showTooltip(event, point, els.tooltip));
      node.addEventListener("mouseleave", () => hideTooltip(els.tooltip));
    });
  }

  function renderDailySalesChart() {
    if (!els.dailyChart) return;
    const grouped = buildDailySeries();
    const animateChart = state.page === "dashboard" && state.animateDashboard && canAnimateDashboard();
    const chartBox = els.dailyChart.parentElement.getBoundingClientRect();
    const highestSales = Math.max(0, ...grouped.map((point) => point.sales));
    const maxSales = Math.max(1, Math.ceil(highestSales * 1.2));
    const left = 34;
    const right = 10;
    const top = 12;
    const bottom = 32;
    const canvasWidth = 980;
    const canvasHeight = Math.max(300, Math.round(canvasWidth * (chartBox.height / Math.max(chartBox.width, 1))));
    els.dailyChart.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    const width = canvasWidth - left - right;
    const height = canvasHeight - top - bottom;
    const step = grouped.length > 1 ? width / (grouped.length - 1) : width / 2;
    const points = grouped.map((point, index) => {
      const x = grouped.length > 1 ? left + index * step : left + step;
      const y = top + height - (point.sales / maxSales) * height;
      return Object.assign({ x, y }, point);
    });
    const path = makeAngularPath(points);
    const areaPath = `${path} L ${points[points.length - 1].x},${top + height} L ${points[0].x},${top + height} Z`;
    const gridYTop = top;
    const gridYMid = top + height / 2;
    const gridYBottom = top + height;
    els.dailyChart.innerHTML = `
      <defs>
        <linearGradient id="dailySalesAreaGradientAttendant" x1="0" x2="0" y1="0" y2="1">
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
      <path d="${areaPath}" class="sales-area"></path>
      <path d="${path}" class="sales-line" pathLength="1"></path>
      ${points.map((point) => `
        <g class="chart-point" data-index="${point.index}">
          <circle class="point-hit" cx="${point.x}" cy="${point.y}" r="13"></circle>
          <circle class="point-dot" cx="${point.x}" cy="${point.y}" r="${point.sales || point.revenue ? 4.8 : 3.8}"></circle>
          <text x="${point.x}" y="${canvasHeight - 12}" class="x-label">${shouldShowAxisLabel(point.index, grouped.length) ? point.label : ""}</text>
        </g>`).join("")}
    `;
    const chartAnimationCss = animateChart ? `
      .sales-line{stroke-dasharray:1;stroke-dashoffset:1;animation:chartLineTraceIn 820ms cubic-bezier(.2,.78,.2,1) both}
      .sales-area{animation:chartAreaIn 820ms ease both 140ms;transform-box:fill-box;transform-origin:center}
      .point-dot{animation:chartDotIn 620ms ease both;transform-box:fill-box;transform-origin:center}
      @keyframes chartLineTraceIn{to{stroke-dashoffset:0}}
      @keyframes chartAreaIn{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
      @keyframes chartDotIn{from{opacity:0;transform:scale(.72)}to{opacity:1;transform:scale(1)}}
    ` : "";
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .chart-plot-bg{fill:rgba(255,255,255,.012)}
      .grid-line,.axis-line{stroke:rgba(159,232,112,.18);stroke-width:1}
      .grid-line.is-soft{stroke:rgba(159,232,112,.1)}
      .sales-area{fill:url(#dailySalesAreaGradientAttendant)}
      .sales-line{fill:none;stroke:#9fe870;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 3px rgba(159,232,112,.16))}
      .chart-point,.chart-point *{pointer-events:all;cursor:pointer;outline:none}
      .point-hit{fill:transparent;stroke:transparent}
      .point-dot{fill:#1b241a;stroke:#9fe870;stroke-width:2.5}
      .chart-point:hover .point-dot{fill:#9fe870;stroke:#071009;stroke-width:2.2}
      .axis-text,.x-label{fill:#b8c0b4;font-size:var(--text-xs)}
      .axis-text{text-anchor:end}
      .x-label{text-anchor:middle}
      ${chartAnimationCss}
    `;
    els.dailyChart.prepend(style);
    els.dailyChart.querySelectorAll(".chart-point").forEach((node) => {
      const point = points[Number(node.dataset.index)];
      node.addEventListener("mouseenter", (event) => showTooltip(event, point, els.dailyTooltip));
      node.addEventListener("mousemove", (event) => showTooltip(event, point, els.dailyTooltip));
      node.addEventListener("mouseleave", () => hideTooltip(els.dailyTooltip));
    });
  }

  function renderTransactions() {
    const query = els.search.value.trim().toLowerCase();
    const rows = state.displayTransactions
      .filter((item) => `${item.pagador} ${formatPhone(item.telefone)} ${digitsOnly(item.telefone)} ${item.value} ${money(item.value)}`.toLowerCase().includes(query))
      .sort((a, b) => b.timestamp - a.timestamp);
    const tbody = document.getElementById("transactionsBody");
    const totalPages = Math.max(1, Math.ceil(rows.length / baseConfig.rowsPerPage));
    state.pageIndex = Math.min(state.pageIndex, totalPages);
    const visible = rows.slice((state.pageIndex - 1) * baseConfig.rowsPerPage, state.pageIndex * baseConfig.rowsPerPage);
    tbody.innerHTML = "";
    if (!visible.length) {
      tbody.innerHTML = `<tr><td colspan="5">Nenhuma transação encontrada.</td></tr>`;
    } else {
      visible.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatIsoDateBr(item.data)}</td>
          <td>${escapeHtml(item.hora)}</td>
          <td>${escapeHtml(item.pagador)}</td>
          <td>${escapeHtml(formatPhone(item.telefone))}</td>
          <td>${money(item.value)}</td>
        `;
        tbody.append(tr);
      });
    }
    els.pageInfo.textContent = `Página ${state.pageIndex} de ${totalPages}`;
    els.prevPage.disabled = state.pageIndex <= 1;
    els.nextPage.disabled = state.pageIndex >= totalPages;
  }

  function buildDisplayTransactions() {
    return state.filteredSales.concat(buildFixedCredits(getDateRange()));
  }

  function buildFixedCredits(range) {
    const salary = Number(state.attendant.salario_fixo_mensal || 0);
    const salaryCents = Math.round(salary * 100);
    const baseDailyCents = Math.floor(salaryCents / 30);
    const remainderCents = salaryCents - baseDailyCents * 30;
    const workStart = getWorkStartDate();
    const today = endOfDay(new Date());
    const start = workStart && startOfDay(range.start) < workStart ? workStart : startOfDay(range.start);
    const end = endOfDay(range.end) > today ? today : endOfDay(range.end);
    const credits = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      if (cursor.getDate() === 31) continue;
      if (!isWorkingDate(cursor)) continue;
      const dayOfMonth = cursor.getDate();
      const daily = (baseDailyCents + (dayOfMonth <= remainderCents ? 1 : 0)) / 100;
      const timestamp = new Date(cursor);
      timestamp.setHours(0, 0, 0, 0);
      credits.push({
        id: `fixed-${toIsoDate(timestamp)}`,
        type: "fixed",
        timestamp,
        data: toIsoDate(timestamp),
        hora: "00:00",
        pagador: "Fixo diário",
        value: daily,
        gross: 0,
        commissionRate: 0
      });
    }
    return credits;
  }

  function getFilteredSales() {
    const range = getDateRange();
    return state.transactions
      .filter((item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end))
      .filter((item) => isWorkingDate(item.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function buildHourlySeries() {
    const labels = buildHourLabels();
    return labels.map((label, index) => {
      const sales = state.filteredSales.filter((item) => {
        return item.timestamp.getHours() === index;
      });
      return {
        index,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.value))
      };
    });
  }

  function buildDailySeries() {
    const range = getDateRange(getDailyChartPeriod());
    return buildDayLabels(range.start, range.end).map((label, index) => {
      const sales = state.transactions.filter((item) => {
        return item.timestamp >= startOfDay(range.start)
          && item.timestamp <= endOfDay(range.end)
          && toIsoDate(item.timestamp) === label.key
          && isWorkingDate(item.timestamp);
      });
      return {
        index,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.value))
      };
    });
  }

  function getDailyChartPeriod() {
    return state.appliedPeriod === "today" || state.appliedPeriod === "yesterday" ? "month" : state.appliedPeriod;
  }

  function isWorkingDate(date) {
    const day = startOfDay(date);
    const workStart = getWorkStartDate();
    if (workStart && day < workStart) return false;
    return !getPauseRanges().some((range) => day >= range.start && day <= range.end);
  }

  function getWorkStartDate() {
    const normalized = normalizeFlexibleDate(state.attendant.inicio_trabalho);
    return normalized ? startOfDay(parseDate(`${normalized}T00:00:00`)) : null;
  }

  function getPauseRanges() {
    const raw = String(state.attendant.pausas || "").trim();
    if (!raw) return [];
    return raw
      .split(/[;\n|]+/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const dates = entry.match(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}/g) || [];
        const start = normalizeFlexibleDate(dates[0]);
        const end = normalizeFlexibleDate(dates[1] || dates[0]);
        if (!start || !end) return null;
        const startDate = startOfDay(parseDate(`${start}T00:00:00`));
        const endDate = startOfDay(parseDate(`${end}T00:00:00`));
        return startDate <= endDate
          ? { start: startDate, end: endDate }
          : { start: endDate, end: startDate };
      })
      .filter(Boolean);
  }

  function normalizeFlexibleDate(value) {
    if (!value) return "";
    if (value instanceof Date) return toIsoDate(value);
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (br) {
      const year = br[3].length === 2 ? `20${br[3]}` : br[3];
      return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : toIsoDate(parsed);
  }

  function setPage(page) {
    if (!["dashboard", "transactions", "notifications"].includes(page)) return;
    if (state.page === page) return;
    state.page = page;
    els.pages.forEach((section) => section.classList.toggle("is-active", section.dataset.page === page));
    els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    document.body.dataset.currentPage = page;
    if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
    if (page === "dashboard") {
      state.animateDashboard = true;
      renderMetrics();
      requestAnimationFrame(() => {
        renderSalesChart();
        renderDailySalesChart();
        state.animateDashboard = false;
      });
    }
  }

  function getTotalPages() {
    return Math.max(1, Math.ceil(state.displayTransactions.length / baseConfig.rowsPerPage));
  }

  function attendantPushAudience() {
    return state.attendant.id ? `att-${state.attendant.id}` : "";
  }

  let autoPushSynced = false;
  function maybeAutoSyncPush() {
    if (autoPushSynced || !state.attendant.id) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || !state.notificationsEnabled) return;
    autoPushSynced = true;
    syncAttendantPush().catch(console.error);
  }

  async function syncAttendantPush(force) {
    const audience = attendantPushAudience();
    if (!audience) throw new Error("Aguarde os dados carregarem e tente novamente.");
    const pushClient = await ensurePushClient();
    const preferences = {
      enabled: state.notificationsEnabled,
      salesEnabled: state.notificationsEnabled,
      times: []
    };
    if (dataProvider && dataProvider.saveNotificationPreferences) {
      dataProvider.saveNotificationPreferences("attendant", {
        salesEnabled: state.notificationsEnabled,
        times: [],
        reportStyle: "detailed"
      }).catch(console.error);
    }
    return force
      ? pushClient.sync(audience, preferences)
      : pushClient.update(audience, preferences);
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
      script.src = "../push-client.js?v=64";
      script.dataset.pushClient = "dynamic";
      script.onload = () => window.HSBIPush
        ? resolve(window.HSBIPush)
        : reject(new Error("O módulo de notificações não foi inicializado."));
      script.onerror = () => reject(new Error("Não foi possível carregar o módulo de notificações."));
      document.head.appendChild(script);
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("../sw.js?v=65").then((registration) => registration.update()).catch(console.error);
    }
  }

  function buildEmptyPayload() {
    return {
      ok: true,
      attendant: {
        slug: pageConfig.slug,
        nome: pageConfig.name,
        comissao_percentual: null,
        salario_fixo_mensal: 0
      },
      transactions: [],
      goals: []
    };
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
    if (period === "lastMonth") return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: new Date(today.getFullYear(), today.getMonth(), 0) };
    if (period === "custom") return periodName ? readCustomInputRange() : state.customRange || readCustomInputRange();
    return { start: today, end: today };
  }

  function getWeekRange(date) {
    const start = startOfDay(date);
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    return { start, end: addDays(start, 6) };
  }

  function readCustomInputRange() {
    return { start: parseLocalDate(els.startDate.value), end: parseLocalDate(els.endDate.value) };
  }

  function getPeriodName(periodName) {
    return { today: "Hoje", yesterday: "Ontem", last7: "Últimos 7 dias", month: "Este mês", lastMonth: "Mês passado", custom: "Personalizado" }[periodName || state.appliedPeriod];
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
    return Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), short: String(hour).padStart(2, "0"), full: `${String(hour).padStart(2, "0")}h` }));
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

  function makeSmoothPath(points) {
    if (points.length < 2) return points.map((point) => `M${point.x},${point.y}`).join(" ");
    const commands = [`M${points[0].x},${points[0].y}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const controlDistance = (current.x - previous.x) * 0.42;
      commands.push(`C${previous.x + controlDistance},${previous.y} ${current.x - controlDistance},${current.y} ${current.x},${current.y}`);
    }
    return commands.join(" ");
  }

  function makeAngularPath(points) {
    return points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  }

  function shouldShowAxisLabel(index, total) {
    if (window.innerWidth <= 720) return total <= 12 || index % 2 === 0;
    return total <= 16 || index % 2 === 0;
  }

  function showTooltip(event, point, tooltip) {
    const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    const wrap = event.currentTarget.ownerSVGElement.parentElement.getBoundingClientRect();
    const viewBox = event.currentTarget.ownerSVGElement.viewBox.baseVal;
    const pointX = ((point.x / viewBox.width) * rect.width) + rect.left - wrap.left;
    const pointY = ((point.y / viewBox.height) * rect.height) + rect.top - wrap.top;
    const x = event.clientX ? event.clientX - wrap.left : pointX;
    const y = event.clientY ? event.clientY - wrap.top : pointY;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(72, Math.min(wrap.width - 72, x))}px`;
    tooltip.style.top = `${Math.max(52, y - 8)}px`;
    tooltip.innerHTML = `<strong>${point.fullLabel}</strong>Vendas: ${point.sales}<br>Comissão: ${money(point.revenue)}`;
  }

  function hideTooltip(tooltip) {
    if (tooltip) tooltip.hidden = true;
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
    const match = String(value).trim().match(/(\d{1,2}):(\d{2})/);
    return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : "";
  }

  function parseMoneyValue(value) {
    if (typeof value === "number") return value;
    const text = String(value || "0").trim().replace(/[^\d,.-]/g, "");
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    let normalized = text;
    if (lastComma > -1 && lastDot > -1) normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
    else if (lastComma > -1) normalized = text.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
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

  function formatIsoDateBr(value) {
    const normalized = normalizeDateValue(value);
    if (!normalized) return "";
    const [year, month, day] = normalized.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatTime(date) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function normalizeCurrency(value) {
    const normalized = String(value || "BRL").trim().toUpperCase();
    return ["BRL", "USD", "EUR", "GBP", "CHF"].includes(normalized) ? normalized : "BRL";
  }

  function currencySymbol(currency) {
    return { BRL: "R$", USD: "US$", EUR: "€", GBP: "£", CHF: "CHF" }[normalizeCurrency(currency)] || "R$";
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

  function integer(value) {
    return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }

  function percent(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function createMutationId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function setText(id, value, options = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    const numberValue = Number(value);
    const hasNumber = value !== null && value !== "" && Number.isFinite(numberValue);
    const displayValue = hasNumber && options.formatter ? options.formatter(numberValue) : String(value);
    if (options.animate && hasNumber && options.formatter) {
      animateMetricValue(el, numberValue, options.formatter, displayValue);
      return;
    }
    const frame = metricAnimationFrames.get(el);
    if (frame) window.cancelAnimationFrame(frame);
    metricAnimationFrames.delete(el);
    el.textContent = displayValue;
  }

  function animateMetricValue(el, target, formatter, finalText) {
    const previousFrame = metricAnimationFrames.get(el);
    if (previousFrame) window.cancelAnimationFrame(previousFrame);
    const duration = 820;
    const start = performance.now();
    const initial = 0;
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = initial + (target - initial) * eased;
      el.textContent = progress >= 1 ? finalText : formatter(current);
      if (progress < 1) {
        metricAnimationFrames.set(el, window.requestAnimationFrame(tick));
      } else {
        metricAnimationFrames.delete(el);
      }
    };
    metricAnimationFrames.set(el, window.requestAnimationFrame(tick));
  }

  function canAnimateDashboard() {
    return !window.matchMedia || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  function debounce(callback, wait) {
    let timeout;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => callback(...args), wait);
    };
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

  function loadNotificationPref() {
    return localStorage.getItem("hsbi-sale-notifications-attendant") === "1"
      || localStorage.getItem(`hsbi-sale-notifications-${pageConfig.slug}`) === "1";
  }

  function saveNotificationPref() {
    localStorage.setItem("hsbi-sale-notifications-attendant", state.notificationsEnabled ? "1" : "0");
  }
})();

