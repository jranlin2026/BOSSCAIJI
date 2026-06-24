const runButton = document.getElementById("run");
const runAutoButton = document.getElementById("run-auto");
const stopButton = document.getElementById("stop");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

async function getActiveBossTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/([^/]+\.)?(zhipin|bosszhipin)\.com\//.test(tab.url || "")) {
    throw new Error("\u8bf7\u5148\u5207\u5230 BOSS \u76f4\u8058\u641c\u7d22\u7ed3\u679c\u9875\u3002");
  }
  return tab;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectCollector(tabId, options = {}) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (collectorOptions) => {
      window.__bossLeadCollectorOptions = collectorOptions;
    },
    args: [options],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["vendor/xlsx.full.min.js", "collector.js"],
  });
}

async function startCollector(options = {}) {
  runButton.disabled = true;
  runAutoButton.disabled = true;
  setStatus("\u6b63\u5728\u542f\u52a8\u91c7\u96c6\u5668...");

  try {
    const tab = await getActiveBossTab();
    await injectCollector(tab.id, options);
    setStatus(
      options.autoRiskbird
        ? "\u5df2\u5f00\u59cb\u81ea\u52a8\u6d41\u7a0b\uff1aBOSS \u91c7\u96c6\u5b8c\u6210\u540e\u4f1a\u6253\u5f00\u98ce\u9e1f\u8865\u5168\u3002"
        : "\u5df2\u5f00\u59cb\u91c7\u96c6\u3002\u9700\u8981\u4e2d\u9014\u7ed3\u675f\u65f6\uff0c\u91cd\u65b0\u70b9\u6269\u5c55\u91cc\u7684\u300c\u505c\u6b62\u5e76\u5bfc\u51fa\u300d\u3002"
    );
    setTimeout(() => window.close(), 1200);
  } catch (error) {
    setStatus(`\u542f\u52a8\u5931\u8d25\uff1a${error.message || error}`);
    runButton.disabled = false;
    runAutoButton.disabled = false;
  }
}

runButton.addEventListener("click", () => startCollector({ autoRiskbird: false }));
runAutoButton.addEventListener("click", () => startCollector({ autoRiskbird: true }));

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

function downloadRiskbirdRows(rows) {
  const cleanedRows = RiskbirdRules.cleanSharedMobileNumbers(rows || []);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  if (globalThis.XLSX?.utils?.aoa_to_sheet && RiskbirdRules.OUTPUT_COLUMNS) {
    const sheetRows = [
      RiskbirdRules.OUTPUT_COLUMNS.map((column) => column.label),
      ...cleanedRows.map((row) => RiskbirdRules.OUTPUT_COLUMNS.map((column) => row[column.key] || "")),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "RiskBird\u8865\u5168");
    const arrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    downloadBlob(new Blob([arrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), `riskbird-enriched-${timestamp}.xlsx`);
    return;
  }

  const csv = RiskbirdRules.toCsv(cleanedRows);
  downloadBlob(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }), `riskbird-enriched-${timestamp}.csv`);
}

async function stopRiskbirdWorkflow() {
  const state = await chrome.storage.local.get("riskbirdEnricher");
  const job = state.riskbirdEnricher;
  if (!job) return false;

  const results = job.results || [];
  await chrome.storage.local.set({
    riskbirdEnricher: {
      ...job,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
    },
  });

  if (results.length) {
    downloadRiskbirdRows(results);
    setStatus(`\u5df2\u505c\u6b62\u98ce\u9e1f\u8865\u5168\uff0c\u5e76\u5bfc\u51fa ${results.length} \u6761\u5df2\u5b8c\u6210\u7ed3\u679c\u3002`);
  } else {
    setStatus("\u5df2\u505c\u6b62\u98ce\u9e1f\u8865\u5168\uff0c\u6682\u65e0\u5df2\u5b8c\u6210\u7ed3\u679c\u53ef\u5bfc\u51fa\u3002");
  }
  return true;
}

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  setStatus("\u6b63\u5728\u505c\u6b62\u5e76\u5bfc\u51fa...");

  try {
    const tab = await getActiveTab();
    if (tab?.id && /^https:\/\/([^/]+\.)?(zhipin|bosszhipin)\.com\//.test(tab.url || "")) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (!window.__bossLeadCollector?.stopAndDownload) {
            return { ok: false, message: "\u91c7\u96c6\u5668\u6ca1\u6709\u5728\u5f53\u524d\u9875\u9762\u8fd0\u884c\u3002" };
          }
          window.__bossLeadCollector.stopAndDownload();
          return { ok: true };
        },
      });
      setStatus("\u5df2\u53d1\u9001\u505c\u6b62\u6307\u4ee4\uff0c\u5f53\u524d BOSS \u7ed3\u679c\u4f1a\u81ea\u52a8\u4e0b\u8f7d\u3002");
    } else if (!(await stopRiskbirdWorkflow())) {
      throw new Error("\u5f53\u524d\u6ca1\u6709\u6b63\u5728\u8fd0\u884c\u7684 BOSS \u91c7\u96c6\u6216\u98ce\u9e1f\u8865\u5168\u4efb\u52a1\u3002");
    }
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    setStatus(`\u505c\u6b62\u5931\u8d25\uff1a${error.message || error}`);
    stopButton.disabled = false;
  }
});
