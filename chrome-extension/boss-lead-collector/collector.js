(() => {
  const CONFIG = {
    maxScrolls: 180,
    delayMs: 1100,
    emptyWaitMs: 20000,
    minStableRounds: 8,
    minEvidenceLength: 20,
  };
  const urlOptions = window.BossCollectorRules?.bossAutoOptionsFromUrl(location.href) || { auto: false };
  const options = { ...urlOptions, ...(window.__bossLeadCollectorOptions || {}) };
  const shouldStart = Boolean(options.manualStart || options.auto);

  if (!shouldStart) {
    window.__bossLeadCollector = {
      isRunning: false,
      showStatus: () => {},
      collectOnce: () => {},
      downloadCsv: () => {},
      stopAndDownload: () => {},
    };
    return;
  }

  if (window.BossCollectorRules?.shouldNavigateForAuto(location.href, options)) {
    location.href = window.BossCollectorRules.buildSearchUrlFromAutoOptions(location.href, options);
    return;
  }

  if (window.__bossLeadCollector?.isRunning) {
    window.__bossLeadCollector.showStatus("采集器已经在运行...");
    return;
  }

  const companyTerms = [
    "\u516c\u53f8",
    "\u79d1\u6280",
    "\u4fe1\u606f",
    "\u7f51\u7edc",
    "\u8f6f\u4ef6",
    "\u667a\u80fd",
    "\u6570\u5b57",
    "\u6570\u636e",
    "\u4e91",
    "\u4e92\u8054",
  ];

  const jobTerms = [
    "\u9500\u552e",
    "\u8fd0\u8425",
    "SaaS",
    "AI",
    "\u8f6f\u4ef6",
    "\u6e20\u9053",
    "\u5546\u52a1",
    "\u5ba2\u6237",
    "CRM",
    "SCRM",
  ];

  const state = {
    isRunning: true,
    stopRequested: false,
    hasDownloaded: false,
    seen: new Map(),
    scrolls: 0,
  };

  const rawText = (node) => (node?.innerText || node?.textContent || "").replace(/\u00a0/g, " ").trim();
  const text = (node) => rawText(node).replace(/\s+/g, " ").trim();

  function formatTimestampForFilename(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("-") + "-" + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join("-");
  }

  function uniqueNodes(nodes) {
    return [...new Set(nodes.filter(Boolean))];
  }

  function absUrl(href) {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return "";
    }
  }

  function matchesAny(value, terms) {
    return terms.some((term) => value.includes(term));
  }

  function getDocumentHeight() {
    return Math.max(
      document.body?.scrollHeight || 0,
      document.documentElement?.scrollHeight || 0
    );
  }

  function isNearBottom(height = getDocumentHeight()) {
    return window.scrollY + window.innerHeight >= height - Math.max(80, window.innerHeight * 0.15);
  }

  function createStatusBox() {
    const box = document.createElement("div");
    box.id = "__boss_lead_collector_status";
    box.style.cssText = [
      "position:fixed",
      "right:18px",
      "bottom:18px",
      "z-index:2147483647",
      "padding:10px 12px",
      "border-radius:6px",
      "background:#172033",
      "color:#fff",
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.22)",
    ].join(";");
    document.documentElement.appendChild(box);
    return box;
  }

  const statusBox = document.getElementById("__boss_lead_collector_status") || createStatusBox();

  function showStatus(message) {
    statusBox.textContent = message;
  }

  function pickCompany(card, jobName) {
    const selectors = [
      ".company-name",
      ".company-info .name",
      ".company-info h3",
      ".boss-name + span",
      "[class*=company] a",
      "[class*=brand] a",
    ];

    for (const selector of selectors) {
      const value = text(card.querySelector(selector));
      if (value && !/^\d/.test(value) && (!window.BossCollectorRules || window.BossCollectorRules.isLikelyCompany(value, jobName))) {
        return value;
      }
    }

    if (window.BossCollectorRules) {
      return window.BossCollectorRules.pickCompanyFromLines(window.BossCollectorRules.normalizeLines(rawText(card)), jobName);
    }

    const lines = text(card).split(" ").filter(Boolean);
    return lines.find((line) => line !== jobName && matchesAny(line, companyTerms)) || "";
  }

  function pickJob(card) {
    const selectors = [
      ".job-name",
      ".job-title",
      ".job-info .name",
      "a[href*='/job_detail/']",
      "[class*=job-name]",
      "[class*=jobName]",
    ];

    for (const selector of selectors) {
      const value = text(card.querySelector(selector));
      if (value) return value;
    }

    const lines = text(card).split(" ").filter(Boolean);
    return lines.find((line) => matchesAny(line, jobTerms)) || "";
  }

  function pickHref(card) {
    const link = card.querySelector("a[href*='/job_detail/'], a[href*='/gongsi/'], a[href*='/web/geek/job']");
    return absUrl(link?.getAttribute("href") || "");
  }

  function findCards() {
    const containerSelectors = [
      ".job-card-wrapper",
      ".job-card-box",
      ".job-list-box li",
      "li.job-card",
      "[class*=job-card]",
      "[class*=jobCard]",
    ];
    const containers = containerSelectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const cardsFromLinks = [...document.querySelectorAll("a[href*='/job_detail/']")]
      .map((link) => link.closest(".job-card-wrapper, .job-card-box, li.job-card, li, [class*=job-card], [class*=jobCard]"));

    return uniqueNodes([...containers, ...cardsFromLinks])
      .filter((card) => text(card).length >= CONFIG.minEvidenceLength);
  }

  function collectOnce() {
    const cards = findCards();
    let added = 0;

    for (const card of cards) {
      const allText = text(card);
      if (allText.length < CONFIG.minEvidenceLength) continue;

      const jobName = pickJob(card);
      const companyName = pickCompany(card, jobName);
      const jobUrl = pickHref(card);
      if (!companyName || !jobName) continue;

      const key = `${companyName}|${jobName}|${jobUrl}`;
      if (!state.seen.has(key)) {
        state.seen.set(key, {
          companyName,
          jobName,
          jobUrl,
          pageUrl: location.href,
          evidence: allText.slice(0, 300),
          collectedAt: new Date().toISOString(),
        });
        added += 1;
      }
    }

    showStatus(`BOSS \u91c7\u96c6\u4e2d\uff1a${state.seen.size} \u6761\uff0c\u672c\u8f6e\u8bc6\u522b ${cards.length} \u5f20\u5361\u7247\uff0c\u65b0\u589e ${added} \u6761\uff0c\u6eda\u52a8 ${state.scrolls}/${CONFIG.maxScrolls}`);
    return { added, cardCount: cards.length, total: state.seen.size };
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  const exportColumns = [
    { key: "companyName", label: "\u516c\u53f8\u540d" },
    { key: "jobName", label: "\u5c97\u4f4d\u540d" },
    { key: "jobUrl", label: "BOSS\u5c97\u4f4d\u94fe\u63a5" },
    { key: "pageUrl", label: "BOSS\u641c\u7d22\u9875" },
    { key: "evidence", label: "BOSS\u62db\u8058\u8bc1\u636e" },
    { key: "collectedAt", label: "BOSS\u91c7\u96c6\u65f6\u95f4" },
  ];

  function buildSheetRows(rows) {
    return [
      exportColumns.map((column) => column.label),
      ...rows.map((row) => exportColumns.map((column) => row[column.key] || "")),
    ];
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function downloadCsvFallback(rows, timestamp) {
    const csv = buildSheetRows(rows)
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `boss-leads-${timestamp}.csv`);
    showStatus(`\u91c7\u96c6\u5b8c\u6210\uff1a${rows.length} \u6761\uff0cCSV \u5df2\u4e0b\u8f7d`);
  }

  function downloadXlsx(rows, timestamp) {
    const worksheet = XLSX.utils.aoa_to_sheet(buildSheetRows(rows));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "BOSS\u7ebf\u7d22");
    const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    const blob = new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    downloadBlob(blob, `boss-leads-${timestamp}.xlsx`);
    showStatus(`\u91c7\u96c6\u5b8c\u6210\uff1a${rows.length} \u6761\uff0cXLSX \u5df2\u4e0b\u8f7d`);
  }

  async function maybeStartRiskbird(rows) {
    if (!options.autoRiskbird) return;
    if (!rows.length) {
      showStatus("\u672a\u91c7\u96c6\u5230 BOSS \u7ebf\u7d22\uff0c\u4e0d\u542f\u52a8\u98ce\u9e1f\u8865\u5168");
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "boss-auto-riskbird-start",
        rows,
      });
      if (!response?.ok) throw new Error(response?.message || "RiskBird workflow failed to start.");
      showStatus(`BOSS \u91c7\u96c6\u5b8c\u6210\uff1a${rows.length} \u6761\uff0c\u5df2\u6253\u5f00\u98ce\u9e1f\u8865\u5168`);
    } catch (error) {
      showStatus(`BOSS \u91c7\u96c6\u5b8c\u6210\uff0c\u4f46\u98ce\u9e1f\u81ea\u52a8\u542f\u52a8\u5931\u8d25\uff1a${error.message || error}`);
    }
  }

  async function downloadCsv() {
    if (state.hasDownloaded) return;
    const rows = [...state.seen.values()];
    if (!rows.length) {
      showStatus("\u672a\u91c7\u96c6\u5230 BOSS \u7ebf\u7d22\uff1a\u53ef\u80fd\u672a\u767b\u5f55\u3001\u641c\u7d22\u9875\u65e0\u5c97\u4f4d\uff0c\u6216 BOSS \u9875\u9762\u7ed3\u6784\u5df2\u53d8\u66f4\u3002\u672a\u5bfc\u51fa\u7a7a\u8868\u3002");
      return;
    }
    state.hasDownloaded = true;
    const timestamp = formatTimestampForFilename();
    if (globalThis.XLSX?.utils?.aoa_to_sheet) {
      downloadXlsx(rows, timestamp);
      await maybeStartRiskbird(rows);
      return;
    }
    downloadCsvFallback(rows, timestamp);
    await maybeStartRiskbird(rows);
  }

  async function stopAndDownload() {
    state.stopRequested = true;
    collectOnce();
    state.isRunning = false;
    window.__bossLeadCollector.isRunning = false;
    await downloadCsv();
  }

  async function run() {
    window.__bossLeadCollector = { ...state, showStatus, collectOnce, downloadCsv, stopAndDownload };

    const waitStartedAt = Date.now();
    let lastTotal = 0;
    let lastHeight = 0;
    let stableRounds = 0;
    for (state.scrolls = 0; ; state.scrolls += 1) {
      const result = collectOnce();
      const height = getDocumentHeight();
      const atBottom = isNearBottom(height);
      const changed = result.added > 0 || result.total !== lastTotal || height !== lastHeight;
      stableRounds = changed ? 0 : stableRounds + 1;
      lastTotal = result.total;
      lastHeight = height;

      if (!result.cardCount && Date.now() - waitStartedAt < CONFIG.emptyWaitMs) {
        showStatus(`\u6b63\u5728\u7b49\u5f85 BOSS \u804c\u4f4d\u5217\u8868\u52a0\u8f7d...\nURL: ${location.href}`);
        await new Promise((resolve) => setTimeout(resolve, CONFIG.delayMs));
        state.scrolls -= 1;
        continue;
      }

      const shouldContinue = window.BossCollectorRules?.shouldContinueCollecting?.({
        scrolls: state.scrolls,
        maxScrolls: CONFIG.maxScrolls,
        stableRounds,
        minStableRounds: CONFIG.minStableRounds,
        atBottom,
        stopRequested: state.stopRequested,
      }) ?? (state.scrolls < CONFIG.maxScrolls && !state.stopRequested);

      if (!shouldContinue) break;

      showStatus(`BOSS \u91c7\u96c6\u4e2d\uff1a${state.seen.size} \u6761\uff0c\u6eda\u52a8 ${state.scrolls}/${CONFIG.maxScrolls}\uff0c\u5230\u5e95\uff1a${atBottom ? "\u662f" : "\u5426"}\uff0c\u7a33\u5b9a ${stableRounds}/${CONFIG.minStableRounds}`);
      window.scrollBy(0, Math.max(900, window.innerHeight * 1.15));
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayMs));
    }

    collectOnce();
    state.isRunning = false;
    window.__bossLeadCollector.isRunning = false;
    await downloadCsv();
  }

  run();
})();
