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
    files: ["vendor/xlsx.full.min.js", "rules.js", "content.js"],
  });
}

async function sendToContent(tabId, message) {
  await ensureContentScripts(tabId);
  return chrome.tabs.sendMessage(tabId, message);
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

async function downloadRows(rows) {
  const cleanedRows = RiskbirdRules.cleanSharedMobileNumbers(rows);
  let blob;
  let extension = "csv";

  if (globalThis.XLSX?.utils?.aoa_to_sheet && RiskbirdRules.OUTPUT_COLUMNS) {
    const sheetRows = [
      RiskbirdRules.OUTPUT_COLUMNS.map((column) => column.label),
      ...cleanedRows.map((row) => RiskbirdRules.OUTPUT_COLUMNS.map((column) => row[column.key] || "")),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "RiskBird补全");
    const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    blob = new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    extension = "xlsx";
  } else {
    const csv = RiskbirdRules.toCsv(cleanedRows);
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
  const results = RiskbirdRules.mergeStoppedResults(job.rows || [], job.results || []);
  await chrome.storage.local.set({
    riskbirdEnricher: { ...job, results, status: "stopped", stoppedAt: new Date().toISOString() },
  });
  if (!results.length) {
    setStatus("Stopped. No BOSS rows to export.");
    stopButton.disabled = false;
    return;
  }
  await downloadRows(results);
  setStatus(`Stopped and exported ${results.length} rows, including unprocessed BOSS rows.`);
  setTimeout(() => window.close(), 1000);
});

refreshStatus();
