const fileInput = document.getElementById("file");
const startButton = document.getElementById("start");
const exportButton = document.getElementById("export");
const stopButton = document.getElementById("stop");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

async function parseLeadFile(file) {
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".xlsx")) {
    if (!globalThis.XLSX) throw new Error("XLSX parser is not loaded.");
    const workbook = XLSX.read(await readFileAsArrayBuffer(file), { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const records = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    return RiskbirdRules.normalizeRows(records);
  }
  return RiskbirdRules.parseCsv(await readFileAsText(file));
}

async function getActiveRiskbirdTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/([^/]+\.)?riskbird\.com\//.test(tab.url || "")) {
    throw new Error("Please open a RiskBird page first: https://www.riskbird.com/");
  }
  return tab;
}

async function ensureContentScripts(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["rules.js", "content.js"],
  });
}

async function sendToContent(tabId, message) {
  await ensureContentScripts(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

async function downloadRows(rows) {
  const csv = RiskbirdRules.toCsv(RiskbirdRules.cleanSharedMobileNumbers(rows));
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `riskbird-enriched-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function refreshStatus() {
  const state = await chrome.storage.local.get("riskbirdEnricher");
  const job = state.riskbirdEnricher;
  if (!job) {
    setStatus("Ready. Upload a BOSS CSV, then click Start.");
    return;
  }
  setStatus(`Status: ${job.status}\nProgress: ${job.currentIndex || 0}/${job.rows?.length || 0}\nDone: ${job.results?.length || 0}`);
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  try {
    const file = fileInput.files?.[0];
    if (!file) throw new Error("Please choose the BOSS exported CSV/XLSX first.");
    const tab = await getActiveRiskbirdTab();
    const rows = (await parseLeadFile(file))
      .filter((row) => row.companyName);
    if (!rows.length) throw new Error("No companyName/company column found in the file.");

    await chrome.storage.local.set({
      riskbirdEnricher: {
        status: "running",
        rows,
        results: [],
        currentIndex: 0,
        startedAt: new Date().toISOString(),
      },
    });
    await sendToContent(tab.id, { type: "riskbird-enricher-start" });
    setStatus(`Started: ${rows.length} companies. Keep the RiskBird tab open.`);
    setTimeout(() => window.close(), 1200);
  } catch (error) {
    setStatus(`Start failed: ${error.message || error}`);
    startButton.disabled = false;
  }
});

exportButton.addEventListener("click", async () => {
  const state = await chrome.storage.local.get("riskbirdEnricher");
  const job = state.riskbirdEnricher;
  if (!job?.results?.length) {
    setStatus("No enriched rows to export yet.");
    return;
  }
  await downloadRows(job.results);
  setStatus(`Exported ${job.results.length} rows.`);
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  const state = await chrome.storage.local.get("riskbirdEnricher");
  const job = state.riskbirdEnricher;
  if (!job) {
    setStatus("No running job.");
    stopButton.disabled = false;
    return;
  }
  const results = job.results || [];
  await chrome.storage.local.set({
    riskbirdEnricher: { ...job, results, status: "stopped", stoppedAt: new Date().toISOString() },
  });
  if (!results.length) {
    setStatus("Stopped. No enriched rows have been collected yet.");
    stopButton.disabled = false;
    return;
  }
  await downloadRows(results);
  setStatus(`Stopped and exported ${results.length} rows.`);
  setTimeout(() => window.close(), 1000);
});

refreshStatus();
