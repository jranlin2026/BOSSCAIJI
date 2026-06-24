(() => {
  const CONFIG = {
    maxScrolls: 35,
    delayMs: 1100,
    minEvidenceLength: 20,
  };
  const options = window.__bossLeadCollectorOptions || {};

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

  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();

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

  function pickCompany(card) {
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
      if (value && !/^\d/.test(value)) return value;
    }

    const lines = text(card).split(" ").filter(Boolean);
    return lines.find((line) => matchesAny(line, companyTerms)) || "";
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

  function collectOnce() {
    const cards = [
      ...document.querySelectorAll(
        ".job-card-wrapper, .job-list-box li, li.job-card, [class*=job-card], [class*=jobCard]"
      ),
    ];

    for (const card of cards) {
      const allText = text(card);
      if (allText.length < CONFIG.minEvidenceLength) continue;

      const companyName = pickCompany(card);
      const jobName = pickJob(card);
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
      }
    }

    showStatus(`BOSS 采集中：${state.seen.size} 条，滚动 ${state.scrolls}/${CONFIG.maxScrolls}`);
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
    state.hasDownloaded = true;
    const rows = [...state.seen.values()];
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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

    for (state.scrolls = 0; state.scrolls < CONFIG.maxScrolls; state.scrolls += 1) {
      if (state.stopRequested) break;
      collectOnce();
      window.scrollBy(0, Math.max(650, window.innerHeight * 0.9));
      await new Promise((resolve) => setTimeout(resolve, CONFIG.delayMs));
    }

    collectOnce();
    state.isRunning = false;
    window.__bossLeadCollector.isRunning = false;
    await downloadCsv();
  }

  run();
})();
