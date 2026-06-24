(() => {
  if (window.__riskbirdCompanyEnricherInstalled) return;
  window.__riskbirdCompanyEnricherInstalled = true;

  const WAIT_MS = 1600;
  const NO_MATCH_TIMEOUT_MS = 10000;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function storageGet() {
    return chrome.storage.local.get("riskbirdEnricher").then((data) => data.riskbirdEnricher);
  }

  function storageSet(job) {
    return chrome.storage.local.set({ riskbirdEnricher: job });
  }

  function text(node) {
    return (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
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

  function searchUrl(companyName) {
    return `https://www.riskbird.com/search/company?keyword=${encodeURIComponent(companyName)}&timestamp=${Date.now()}`;
  }

  function isSearchPage() {
    return location.pathname.startsWith("/search/company");
  }

  function isDetailPage() {
    return location.pathname.startsWith("/ent/");
  }

  function findBestCompanyLink(companyName) {
    const links = [...document.querySelectorAll("a[href*='/ent/']")];
    const candidates = links
      .map((link) => ({
        link,
        label: text(link),
        href: link.href,
      }))
      .filter((item) => item.label && item.href);

    candidates.sort((a, b) =>
      RiskbirdRules.scoreCompanyMatch(b.label, companyName) - RiskbirdRules.scoreCompanyMatch(a.label, companyName)
    );
    return candidates.find((candidate) => RiskbirdRules.scoreCompanyMatch(candidate.label, companyName) > 0)?.link || null;
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
    const cleanedResults = RiskbirdRules.cleanSharedMobileNumbers(job.results || []);
    const csv = RiskbirdRules.toCsv(cleanedResults);
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `riskbird-enriched-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    await storageSet({ ...job, results: cleanedResults, status: "done", finishedAt: new Date().toISOString() });
    showStatus(`风鸟补全完成：${cleanedResults.length}/${job.rows.length}，CSV 已下载`);
  }

  async function advance(job, result) {
    const nextJob = {
      ...job,
      results: [...(job.results || []), result],
      currentIndex: (job.currentIndex || 0) + 1,
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
      const matchedName = extractMatchedCompanyName(companyName);
      if (RiskbirdRules.scoreCompanyMatch(matchedName, companyName) <= 0) {
        location.href = searchUrl(companyName);
        return;
      }
      await advance(job, buildResult(row, "matched"));
      return;
    }

    if (!isSearchPage() || !decodeURIComponent(location.search).includes(companyName)) {
      location.href = searchUrl(companyName);
      return;
    }

    const searchStartedAt = job.searchStartedAt || Date.now();
    if (!job.searchStartedAt) await storageSet({ ...job, searchStartedAt });
    await sleep(WAIT_MS);

    const link = findBestCompanyLink(companyName);
    if (link) {
      link.click();
      return;
    }

    if (Date.now() - searchStartedAt > NO_MATCH_TIMEOUT_MS) {
      await advance(job, RiskbirdRules.mergeResult(row, {
        status: "no_match",
        note: "No matching /ent/ link found on RiskBird search page",
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
