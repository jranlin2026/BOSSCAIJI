const runButton = document.getElementById("run");
const stopButton = document.getElementById("stop");
const statusEl = document.getElementById("status");

function setStatus(message) {
  statusEl.textContent = message;
}

async function getActiveBossTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/([^/]+\.)?(zhipin|bosszhipin)\.com\//.test(tab.url || "")) {
    throw new Error("请先切到 BOSS 直聘搜索结果页。");
  }
  return tab;
}

async function injectCollector(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["vendor/xlsx.full.min.js", "collector.js"],
  });
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  setStatus("正在启动采集器...");

  try {
    const tab = await getActiveBossTab();
    await injectCollector(tab.id);
    setStatus("已开始。需要中途结束时，重新点扩展里的「停止并导出」。");
    setTimeout(() => window.close(), 1200);
  } catch (error) {
    setStatus(`启动失败：${error.message || error}`);
    runButton.disabled = false;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  setStatus("正在停止并导出...");

  try {
    const tab = await getActiveBossTab();
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (!window.__bossLeadCollector?.stopAndDownload) {
          return { ok: false, message: "采集器没有在当前页面运行。" };
        }
        window.__bossLeadCollector.stopAndDownload();
        return { ok: true };
      },
    });
    setStatus("已发送停止指令，当前结果会自动下载。");
    setTimeout(() => window.close(), 1000);
  } catch (error) {
    setStatus(`停止失败：${error.message || error}`);
    stopButton.disabled = false;
  }
});
