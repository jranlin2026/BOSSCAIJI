const RISK_BIRD_HOME = "https://www.riskbird.com/";

function firstCompanySearchUrl(rows) {
  const companyName = rows.find((row) => row.companyName)?.companyName || "";
  if (!companyName) return RISK_BIRD_HOME;
  return `https://www.riskbird.com/search/company?keyword=${encodeURIComponent(companyName)}&timestamp=${Date.now()}`;
}

async function openRiskbird(rows) {
  const url = firstCompanySearchUrl(rows);
  const tabs = await chrome.tabs.query({
    url: ["https://riskbird.com/*", "https://www.riskbird.com/*"],
  });
  const [tab] = tabs;
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true, url });
    return tab.id;
  }
  const created = await chrome.tabs.create({ active: true, url });
  return created.id;
}

async function startRiskbirdWorkflow(rows) {
  const validRows = (rows || []).filter((row) => row?.companyName);
  if (!validRows.length) {
    throw new Error("No company rows collected from BOSS.");
  }

  await chrome.storage.local.set({
    riskbirdEnricher: {
      status: "running",
      rows: validRows,
      results: [],
      currentIndex: 0,
      startedAt: new Date().toISOString(),
      source: "boss-auto",
    },
  });

  await openRiskbird(validRows);
  return { ok: true, count: validRows.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "boss-auto-riskbird-start") return false;

  startRiskbirdWorkflow(message.rows)
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, message: error.message || String(error) }));
  return true;
});
