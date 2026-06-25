(() => {
  if (window.__riskbirdCompanyEnricherInstalled) return;
  window.__riskbirdCompanyEnricherInstalled = true;

  const WAIT_MS = 1600;
  const NO_MATCH_TIMEOUT_MS = 6000;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function storageGet() {
    return chrome.storage.local.get("riskbirdEnricher").then((data) => data.riskbirdEnricher);
  }

  function storageSet(job) {
    return chrome.storage.local.set({ riskbirdEnricher: job });
  }

  async function getLatestRunningJob(job) {
    const latestJob = await storageGet();
    if (
      latestJob?.status === "running" &&
      (latestJob.currentIndex || 0) === (job.currentIndex || 0) &&
      (!job.startedAt || latestJob.startedAt === job.startedAt)
    ) {
      return latestJob;
    }
    return null;
  }

  async function isJobStillRunning(job) {
    const latestJob = await getLatestRunningJob(job);
    return Boolean(latestJob);
  }

  async function markSearchStarted(job, searchStartedAt) {
    const latestJob = await getLatestRunningJob(job);
    if (!latestJob) return null;
    const nextJob = { ...latestJob, searchStartedAt };
    await storageSet(nextJob);
    return nextJob;
  }

  function text(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  }

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

  function showStatus(message) {
    let box = document.getElementById("__riskbird_enricher_status");
    if (!box) {
      box = document.createElement("div");
      box.id = "__riskbird_enricher_status";
      box.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:2147483647",
        "max-width:360px",
        "padding:10px 12px",
        "border-radius:6px",
        "background:#172033",
        "color:#fff",
        "font:13px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        "box-shadow:0 8px 24px rgba(0,0,0,.22)",
        "white-space:pre-wrap",
      ].join(";");
      document.documentElement.appendChild(box);
    }
    box.textContent = message;
  }

  function getCompanyName(row) {
    return row.companyName || row["公司名"] || row["公司名称"] || row["企业名称"] || "";
  }

  function normalizeSearchKeyword(value) {
    return String(value || "")
      .replace(/["'\u201c\u201d\u2018\u2019]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function searchUrl(companyName) {
    const keyword = normalizeSearchKeyword(companyName);
    return `https://www.riskbird.com/search/company?keyword=${encodeURIComponent(keyword)}&timestamp=${Date.now()}`;
  }

  function isSearchPage() {
    return location.pathname.startsWith("/search/company");
  }

  function isDetailPage() {
    return location.pathname.startsWith("/ent/");
  }

  function isCurrentSearchForCompany(companyName) {
    if (!isSearchPage()) return false;
    const params = new URLSearchParams(location.search);
    const keyword = params.get("keyword") || "";
    return normalizeSearchKeyword(keyword) === normalizeSearchKeyword(companyName);
  }

  function getSearchResultContainer(link) {
    let node = link;
    for (let depth = 0; node && node !== document.body && depth < 8; depth += 1) {
      const value = text(node);
      if (
        value.length > 60 &&
        /电话|邮箱|官网|通信地址|法定代表人|注册资本|统一社会信用代码/i.test(value)
      ) {
        return node;
      }
      node = node.parentElement;
    }
    return link.closest("tr, li, section, article, div") || link;
  }

  function findBestCompanySearchResult(companyName) {
    const links = [...document.querySelectorAll("a[href*='/ent/']")];
    const candidates = links
      .map((link) => ({
        link,
        label: text(link),
        href: link.href,
        container: getSearchResultContainer(link),
      }))
      .filter((item) => item.label && item.href);

    candidates.sort((a, b) =>
      RiskbirdRules.scoreCompanyMatch(b.label, companyName) - RiskbirdRules.scoreCompanyMatch(a.label, companyName)
    );
    return candidates.find((candidate) => RiskbirdRules.scoreCompanyMatch(candidate.label, companyName) > 0) || null;
  }

  function buildSearchResult(row, searchResult, status = "matched_search") {
    const resultText = text(searchResult?.container);
    const contacts = RiskbirdRules.extractContacts(resultText);
    return RiskbirdRules.mergeResult(row, {
      matchedCompanyName: searchResult?.label || getCompanyName(row),
      companyPhones: contacts.companyPhones,
      emails: contacts.emails,
      website: contacts.website,
      hasPublicMobile: contacts.hasPublicMobile,
      mobileNumbers: contacts.mobileNumbers,
      sourceUrl: location.href,
      status,
      note: "Extracted from RiskBird search result page; detail page not opened.",
    });
  }

  function extractMatchedCompanyName(fallback) {
    const selectors = ["h1", ".company-name", ".ent-name", "[class*=ent-name]", "[class*=company-name]"];
    for (const selector of selectors) {
      const value = text(document.querySelector(selector));
      if (value && value.length <= 80) return value;
    }
    const decoded = decodeURIComponent(location.pathname.replace(/^\/ent\//, "")).replace(/\.html?$/i, "");
    return decoded || fallback;
  }

  function buildResult(row, status, note = "") {
    const pageText = getDetailMainText();
    const contacts = RiskbirdRules.extractContacts(pageText);
    return RiskbirdRules.mergeResult(row, {
      matchedCompanyName: extractMatchedCompanyName(getCompanyName(row)),
      companyPhones: contacts.companyPhones,
      emails: contacts.emails,
      website: contacts.website,
      hasPublicMobile: contacts.hasPublicMobile,
      mobileNumbers: contacts.mobileNumbers,
      sourceUrl: location.href,
      status,
      note,
    });
  }

  function getDetailMainText() {
    const selectors = [
      "main",
      "[class*=basic]",
      "[class*=detail]",
      "[class*=info]",
      "[class*=contact]",
      "[class*=content]",
    ];
    const parts = selectors
      .map((selector) => [...document.querySelectorAll(selector)])
      .flat()
      .filter((node) => {
        const value = text(node);
        return value.length > 30 && /电话|邮箱|官网|手机|联系方式|地址|工商|统一社会信用代码/i.test(value);
      })
      .map((node) => text(node));

    if (parts.length) return parts.join(" ");

    const clone = document.body.cloneNode(true);
    clone.querySelectorAll([
      "script",
      "style",
      "header",
      "footer",
      "nav",
      "aside",
      "[class*=header]",
      "[class*=footer]",
      "[class*=login]",
      "[class*=user]",
      "[class*=account]",
      "[class*=customer]",
      "[class*=service]",
      "[class*=sidebar]",
      "[class*=fixed]",
    ].join(",")).forEach((node) => node.remove());
    return text(clone);
  }

  async function finish(job) {
    const latestJob = await getLatestRunningJob(job);
    if (!latestJob) return;
    const cleanedResults = RiskbirdRules.cleanSharedMobileNumbers(latestJob.results || []);
    let blob;
    let extension = "csv";

    if (globalThis.XLSX?.utils?.aoa_to_sheet && RiskbirdRules.OUTPUT_COLUMNS) {
      const rows = [
        RiskbirdRules.OUTPUT_COLUMNS.map((column) => column.label),
        ...cleanedResults.map((row) => RiskbirdRules.OUTPUT_COLUMNS.map((column) => row[column.key] || "")),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "RiskBird补全");
      const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      blob = new Blob([arrayBuffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      extension = "xlsx";
    } else {
      const csv = RiskbirdRules.toCsv(cleanedResults);
      blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `riskbird-enriched-${formatTimestampForFilename()}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await storageSet({ ...latestJob, results: cleanedResults, status: "done", finishedAt: new Date().toISOString() });
    showStatus(`风鸟补全完成：${cleanedResults.length}/${latestJob.rows.length}，${extension.toUpperCase()} 已下载`);
  }

  async function advance(job, result) {
    const latestJob = await getLatestRunningJob(job);
    if (!latestJob) return;
    const nextJob = {
      ...latestJob,
      results: [...(latestJob.results || []), result],
      currentIndex: (latestJob.currentIndex || 0) + 1,
      updatedAt: new Date().toISOString(),
      searchStartedAt: null,
    };
    await storageSet(nextJob);
    await sleep(400);
    await tick();
  }

  async function tick() {
    const job = await storageGet();
    if (!job || job.status !== "running") return;

    const row = job.rows[job.currentIndex || 0];
    if (!row) {
      await finish(job);
      return;
    }

    const companyName = getCompanyName(row);
    showStatus(`风鸟补全中：${(job.currentIndex || 0) + 1}/${job.rows.length}\n${companyName}`);

    if (!companyName) {
      await advance(job, RiskbirdRules.mergeResult(row, { status: "skipped", note: "missing companyName" }));
      return;
    }

    if (isDetailPage()) {
      await sleep(WAIT_MS);
      if (!await isJobStillRunning(job)) return;
      const matchedName = extractMatchedCompanyName(companyName);
      if (RiskbirdRules.scoreCompanyMatch(matchedName, companyName) <= 0) {
        if (!await isJobStillRunning(job)) {
          return;
        }
        location.href = searchUrl(companyName);
        return;
      }
      await advance(job, buildResult(row, "matched"));
      return;
    }

    if (!isCurrentSearchForCompany(companyName)) {
      if (!await isJobStillRunning(job)) {
        return;
      }
      location.href = searchUrl(companyName);
      return;
    }

    const searchStartedAt = job.searchStartedAt || Date.now();
    if (!job.searchStartedAt && !await markSearchStarted(job, searchStartedAt)) return;
    await sleep(WAIT_MS);
    if (!await isJobStillRunning(job)) return;

    const searchResult = findBestCompanySearchResult(companyName);
    if (searchResult) {
      await advance(job, buildSearchResult(row, searchResult));
      return;
    }

    if (Date.now() - searchStartedAt > NO_MATCH_TIMEOUT_MS) {
      await advance(job, RiskbirdRules.mergeResult(row, {
        status: "no_match",
        note: "No matching company result found on RiskBird search page",
        sourceUrl: location.href,
      }));
      return;
    }

    setTimeout(tick, WAIT_MS);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "riskbird-enricher-start") {
      tick();
      sendResponse({ ok: true });
    }
    return true;
  });

  setTimeout(tick, 800);
})();
