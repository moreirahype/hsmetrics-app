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
    metaByPeriod: {},
    customMeta: null,
    meta: { spend: 0, leads: 0 },
    filteredTransactions: [],
    loadedTransactionRange: null,
    metrics: {},
    pageIndex: 1,
    lastUpdated: null,
    notifications: loadNotificationPrefs()
  };

  const els = {
    pages: document.querySelectorAll(".page"),
    navItems: document.querySelectorAll(".nav-item, .bottom-item"),
    periodButtons: document.querySelectorAll(".period-button"),
    customFields: document.getElementById("customFields"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    refreshButton: document.getElementById("refreshButton"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    syncStatus: document.getElementById("syncStatus"),
    desktopSyncStatus: document.getElementById("desktopSyncStatus"),
    transactionSearch: document.getElementById("transactionSearch"),
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
    conversionRate: "metricConversionRate"
  };

  const notificationTimes = ["08:00", "12:00", "18:00", "23:00"];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    applySidebarPreference();
    setDefaultDates();
    bindEvents();
    setPage(location.hash.replace("#", "") || "dashboard");
    renderNotifications();
    registerServiceWorker();
    refreshData();
    window.setInterval(() => refreshData(), config.autoRefreshMinutes * 60 * 1000);
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && notificationTimes.some((time) => state.notifications[time])) {
      window.setTimeout(() => syncOwnerPush().catch(console.error), 1000);
    }
  }

  function bindEvents() {
    els.navItems.forEach((button) => {
      button.addEventListener("click", () => setPage(button.dataset.page));
    });

    els.periodButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.period = button.dataset.period;
        state.pageIndex = 1;
        if (state.period !== "custom") state.appliedPeriod = state.period;
        render();
      });
    });

    [els.startDate, els.endDate].forEach((input) => {
      input.addEventListener("change", () => {
        state.pageIndex = 1;
        updateDateDisplays();
        render();
      });
    });

    els.refreshButton.addEventListener("click", () => refreshData({ applySelection: true }));
    if (els.sidebarToggle) {
      els.sidebarToggle.addEventListener("click", toggleSidebar);
    }
    els.transactionSearch.addEventListener("input", () => {
      state.pageIndex = 1;
      renderTransactions();
    });

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
        await pushClient.test("owner", {
          title: "Resumo das Campanhas!",
          body: buildNotificationText(),
          url: `${location.origin}${location.pathname}#notifications`
        });
      } catch (error) {
        alert(error.message);
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest(".chart-point")) hideTooltips();
    });

    window.addEventListener("resize", debounce(() => {
      if (state.metrics) renderSalesChart();
    }, 120));

    window.addEventListener("hashchange", () => {
      const page = location.hash.replace("#", "");
      if (page) setPage(page);
    });
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
    try {
      const range = getPreloadRange();
      const payload = await fetchTransactionsPayload(range);
      const metaEntries = await Promise.all(
        standardPeriods.map(async (period) => [period, await fetchMetaPayload(getDateRange(period))])
      );
      state.transactions = payload.transactions.map(normalizeTransaction);
      state.loadedTransactionRange = range;
      state.metaByPeriod = Object.fromEntries(metaEntries);
      if (state.appliedPeriod === "custom") await loadCustomPeriodData();
      state.lastUpdated = new Date();
      render();
      setSyncText(`Atualizado ${formatTime(state.lastUpdated)}`);
    } catch (error) {
      console.error(error);
      const fallback = buildEmptyPayload();
      state.transactions = fallback.transactions.map(normalizeTransaction);
      state.loadedTransactionRange = getPreloadRange();
      state.metaByPeriod = Object.fromEntries(standardPeriods.map((period) => [period, fallback.meta]));
      state.customMeta = null;
      state.lastUpdated = new Date();
      render();
      setSyncText("Sem dados");
    } finally {
      els.refreshButton.disabled = false;
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
    try {
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error(`API respondeu ${response.status}`);
      return response.json();
    } catch (error) {
      return fetchJsonp(url);
    }
  }

  async function loadCustomPeriodData() {
    if (state.appliedPeriod !== "custom") return;
    const range = state.customRange || readCustomInputRange();
    try {
      let payload = null;
      if (!isRangeLoaded(range)) {
        payload = await fetchTransactionsPayload(range);
        mergeTransactions(payload.transactions.map(normalizeTransaction));
      }
      state.customMeta = payload && payload.meta ? payload.meta : await fetchMetaPayload(range);
    } catch (error) {
      console.error(error);
      state.customMeta = { spend: 0, leads: 0 };
    }
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
    return { transactions: [], meta: { spend: 0, leads: 0 } };
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
      pagador: item.pagador || item.payer || "Sem pagador",
      telefone: item.telefone || item.phone || "",
      moeda: "BRL",
      moedaOriginal: originalCurrency,
      valorOriginal: originalValue,
      valor: convertedValue,
      atendente: item.atendente || item.attendant || "Sem atendente"
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

  function render() {
    renderPeriodControls();
    state.filteredTransactions = getFilteredTransactions();
    state.meta = getMetaForCurrentPeriod();
    state.metrics = computeMetrics(state.filteredTransactions);
    renderMetrics();
    renderSalesChart();
    renderAttendants();
    renderTransactions();
    renderNotificationSummary();
  }

  function renderPeriodControls() {
    els.periodButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.period === state.period);
    });
    els.customFields.classList.toggle("is-visible", state.period === "custom");
    const hourlyPeriod = document.getElementById("hourlySalesChartPeriod") || document.getElementById("salesChartPeriod");
    const dailyPeriod = document.getElementById("dailySalesChartPeriod");
    if (hourlyPeriod) hourlyPeriod.textContent = getPeriodName(state.appliedPeriod);
    if (dailyPeriod) dailyPeriod.textContent = getPeriodName(getDailyChartPeriod());
    document.getElementById("attendantsPeriod").textContent = getPeriodName(state.appliedPeriod);
    updateDateDisplays();
  }

  function updateDateDisplays() {
    [els.startDate, els.endDate].forEach((input) => {
      const label = input.closest("label");
      if (label) label.dataset.display = formatDateInputValue(input.value);
    });
  }

  function setPage(page) {
    if (!["dashboard", "attendants", "transactions", "notifications"].includes(page)) return;
    state.page = page;
    els.pages.forEach((section) => section.classList.toggle("is-active", section.dataset.page === page));
    els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    document.body.dataset.currentPage = page;
    if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
    if (page === "dashboard" && state.metrics) requestAnimationFrame(renderSalesChart);
  }

  function getFilteredTransactions() {
    const range = getDateRange();
    return state.transactions
      .filter((item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function computeMetrics(transactions) {
    const revenue = sum(transactions.map((item) => item.valor));
    const sales = transactions.length;
    const ads = Number(state.meta.spend || 0);
    const tax = ads * Number(config.metaTaxRate || 0);
    const totalSpend = ads + tax;
    const profit = revenue - totalSpend;
    const leads = getLeadBase(state.meta);
    return {
      revenue,
      ads,
      tax,
      totalSpend,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      roas: totalSpend > 0 ? revenue / totalSpend : null,
      sales,
      cpa: sales > 0 ? totalSpend / sales : null,
      averageTicket: sales > 0 ? revenue / sales : null,
      leads,
      cpl: leads > 0 ? totalSpend / leads : null,
      conversionRate: leads > 0 ? sales / leads : 0
    };
  }

  function getLeadBase(meta) {
    const source = meta || {};
    const candidates = [
      source.leads,
      source.conversations,
      source.conversas,
      source.messaging_conversations,
      source.onsite_conversion_messaging_conversation_started_7d,
      source.omni_messaging_conversation_started_7d
    ];
    const value = candidates.find((item) => Number.isFinite(Number(item)) && Number(item) > 0);
    return value == null ? 0 : Number(value);
  }

  function renderMetrics() {
    setMetric("revenue", money(state.metrics.revenue));
    setMetric("ads", money(state.metrics.ads));
    setMetric("tax", money(state.metrics.tax));
    setMetric("profit", money(state.metrics.profit), signedTone(state.metrics.profit));
    setMetric("margin", state.metrics.margin == null ? "N/A" : percent(state.metrics.margin), signedTone(state.metrics.margin));
    setMetric("roas", state.metrics.roas == null ? "N/A" : decimal(state.metrics.roas), roasTone(state.metrics.roas));
    setMetric("sales", integer(state.metrics.sales));
    setMetric("cpa", state.metrics.cpa == null ? "N/A" : money(state.metrics.cpa));
    setMetric("averageTicket", state.metrics.averageTicket == null ? "N/A" : money(state.metrics.averageTicket));
    setMetric("leads", integer(state.metrics.leads));
    setMetric("cpl", state.metrics.cpl == null ? "N/A" : money(state.metrics.cpl));
    setMetric("conversionRate", state.metrics.conversionRate == null ? "N/A" : percent(state.metrics.conversionRate));
  }

  function setMetric(key, value, tone) {
    const ids = Array.isArray(metricIds[key]) ? metricIds[key] : [metricIds[key]];
    const el = ids.map((id) => document.getElementById(id)).find(Boolean);
    if (!el) return;
    el.textContent = value;
    el.classList.toggle("is-positive", tone === "positive");
    el.classList.toggle("is-negative", tone === "negative");
    el.classList.toggle("is-alert", tone === "negative");
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
    if (els.hourlyChart && els.dailyChart) {
      renderSingleSalesChart(els.hourlyChart, els.hourlyTooltip, buildHourlySeries(), "hourlySalesAreaGradient", "bar");
      renderSingleSalesChart(els.dailyChart, els.dailyTooltip, buildDailySeries(), "dailySalesAreaGradient", "line");
      return;
    }
    if (els.legacyChart) {
      const legacyTitle = document.getElementById("salesChartTitle");
      if (legacyTitle) legacyTitle.textContent = "Vendas por horário";
      renderSingleSalesChart(els.legacyChart, els.legacyTooltip, buildHourlySeries(), "legacySalesAreaGradient", "bar");
    }
  }

  function renderSingleSalesChart(chart, tooltip, grouped, gradientId, mode) {
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
      ${mode === "line" ? `<path d="${areaPath}" class="sales-area"></path><path d="${path}" class="sales-line"></path>` : ""}
      ${points
        .map(
          (point) => `
            <g class="chart-point" data-index="${point.index}">
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
    return labels.map((label, index) => {
      const sales = state.filteredTransactions.filter((item) => {
        return item.timestamp.getHours() === index;
      });
      return {
        index,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.valor))
      };
    });
  }

  function buildDailySeries() {
    const range = getDateRange(getDailyChartPeriod());
    return buildDayLabels(range.start, range.end).map((label, index) => {
      const sales = state.transactions.filter((item) => {
        return item.timestamp >= startOfDay(range.start)
          && item.timestamp <= endOfDay(range.end)
          && toIsoDate(item.timestamp) === label.key;
      });
      return {
        index,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.valor))
      };
    });
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
    tooltip.innerHTML = `<strong>${point.fullLabel}</strong>Vendas: ${point.sales}<br>Faturamento: ${money(point.revenue)}`;
  }

  function hideTooltip(tooltip) {
    tooltip.hidden = true;
  }

  function hideTooltips(except) {
    [els.hourlyTooltip, els.dailyTooltip, els.legacyTooltip].filter(Boolean).forEach((tooltip) => {
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
        (row) => {
          const revenueShare = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
          return `
          <div class="bar-row">
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

  function renderTransactions() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) => {
      const haystack = `${item.pagador} ${item.atendente} ${item.valor} ${money(item.valor)} ${item.moedaOriginal} ${formatOriginalValue(item)}`.toLowerCase();
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
      tr.innerHTML = `<td colspan="6">Nenhuma transação encontrada.</td>`;
      tbody.append(tr);
    } else {
      visible.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatIsoDateBr(item.data)}</td>
          <td>${escapeHtml(item.hora)}</td>
          <td class="payer-cell">${escapeHtml(item.pagador)}<small>${escapeHtml(item.atendente)}</small></td>
          <td>${escapeHtml(item.atendente)}</td>
          <td>${escapeHtml(item.moedaOriginal)}</td>
          <td>${formatOriginalValue(item)}</td>
        `;
        tbody.append(tr);
      });
    }

    els.pageInfo.textContent = `Página ${state.pageIndex} de ${totalPages}`;
    els.prevPage.disabled = state.pageIndex <= 1;
    els.nextPage.disabled = state.pageIndex >= totalPages;
  }

  function getTotalPages() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) =>
      `${item.pagador} ${item.atendente} ${item.valor} ${money(item.valor)} ${item.moedaOriginal} ${formatOriginalValue(item)}`.toLowerCase().includes(query)
    );
    return Math.max(1, Math.ceil(rows.length / config.rowsPerPage));
  }

  function renderNotificationSummary() {
    const summary = document.getElementById("notificationSummary");
    if (!summary) return;
    summary.textContent = buildNotificationText();
  }

  function renderNotifications() {
    els.enableAllNotifications.textContent = areAllNotificationsEnabled() ? "Desativar todos" : "Ativar todos";
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

    els.notificationList.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", async () => {
        const previous = state.notifications[input.dataset.time];
        state.notifications[input.dataset.time] = input.checked;
        saveNotificationPrefs();
        renderNotifications();
        try {
          await syncOwnerPush();
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
    return notificationTimes.every((time) => state.notifications[time]);
  }

  async function syncOwnerPush(force) {
    const pushClient = await ensurePushClient();
    const times = notificationTimes.filter((time) => state.notifications[time]);
    const preferences = {
      enabled: times.length > 0,
      times
    };
    return force
      ? pushClient.sync("owner", preferences)
      : pushClient.update("owner", preferences);
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
      script.src = "../push-client.js?v=42";
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

  function loadNotificationPrefs() {
    try {
      return Object.assign({}, JSON.parse(localStorage.getItem("hsbi-notifications") || "{}"));
    } catch {
      return {};
    }
  }

  function saveNotificationPrefs() {
    localStorage.setItem("hsbi-notifications", JSON.stringify(state.notifications));
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("../sw.js?v=42").then((registration) => registration.update()).catch(console.error);
    }
  }

  function getMetaForCurrentPeriod() {
    if (state.appliedPeriod === "custom") return Object.assign({ spend: 0, leads: 0 }, state.customMeta || {});
    return Object.assign({ spend: 0, leads: 0 }, state.metaByPeriod[state.appliedPeriod] || {});
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
})();

