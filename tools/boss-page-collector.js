(() => {
  const MAX_SCROLLS = 30;
  const DELAY_MS = 1200;
  const seen = new Map();

  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim();
  const absUrl = (href) => {
    try {
      return new URL(href, location.href).toString();
    } catch {
      return "";
    }
  };

  function pickCompany(card) {
    const companySelectors = [
      ".company-name",
      ".company-info .name",
      ".company-info h3",
      ".boss-name + span",
      "[class*=company] a",
    ];
    for (const selector of companySelectors) {
      const value = text(card.querySelector(selector));
      if (value && !/^\d/.test(value)) return value;
    }

    const lines = text(card).split(" ");
    return lines.find((line) => /公司|科技|信息|网络|软件|智能|数字|数据|云|互联/.test(line)) || "";
  }

  function pickJob(card) {
    const jobSelectors = [".job-name", ".job-title", ".job-info .name", "a[href*='/job_detail/']"];
    for (const selector of jobSelectors) {
      const value = text(card.querySelector(selector));
      if (value) return value;
    }
    return text(card).split(" ").find((line) => /销售|运营|SaaS|AI|软件|渠道|商务|客户/.test(line)) || "";
  }

  function pickHref(card) {
    const link = card.querySelector("a[href*='/job_detail/'], a[href*='/gongsi/']");
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
      if (allText.length < 20) continue;
      const companyName = pickCompany(card);
      const jobName = pickJob(card);
      const jobUrl = pickHref(card);
      if (!companyName || !jobName) continue;

      const key = `${companyName}|${jobName}|${jobUrl}`;
      if (!seen.has(key)) {
        seen.set(key, {
          companyName,
          jobName,
          jobUrl,
          pageUrl: location.href,
          evidence: allText.slice(0, 300),
          collectedAt: new Date().toISOString(),
        });
      }
    }

    console.clear();
    console.table([...seen.values()].slice(-20));
    console.log(`BOSS collector: ${seen.size} leads captured`);
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadCsv() {
    const headers = ["companyName", "jobName", "jobUrl", "pageUrl", "evidence", "collectedAt"];
    const rows = [...seen.values()];
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
    ].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `boss-leads-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function run() {
    for (let i = 0; i < MAX_SCROLLS; i += 1) {
      collectOnce();
      window.scrollBy(0, Math.max(600, window.innerHeight * 0.85));
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }
    collectOnce();
    downloadCsv();
  }

  window.__bossLeadCollector = { seen, collectOnce, downloadCsv, run };
  run();
})();
