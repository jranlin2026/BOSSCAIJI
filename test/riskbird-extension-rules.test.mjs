import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadRules() {
  const code = await readFile("chrome-extension/riskbird-company-enricher/rules.js", "utf8");
  delete globalThis.RiskbirdRules;
  vm.runInThisContext(code);
  return globalThis.RiskbirdRules;
}

async function loadBossCollectorRules() {
  const code = await readFile("chrome-extension/boss-lead-collector/collector-rules.js", "utf8");
  delete globalThis.BossCollectorRules;
  vm.runInThisContext(code);
  return globalThis.BossCollectorRules;
}

test("parseCsv reads BOSS exported rows with quoted commas", async () => {
  const { parseCsv } = await loadRules();
  const rows = parseCsv(
    "\uFEFFcompanyName,jobName,evidence\n\"厦门篮王互联网科技\",\"SaaS销售\",\"负责CRM, AI系统销售\""
  );

  assert.deepEqual(rows, [
    {
      companyName: "厦门篮王互联网科技",
      jobName: "SaaS销售",
      evidence: "负责CRM, AI系统销售",
    },
  ]);
});

test("extractContacts keeps public company contacts and mobile numbers", async () => {
  const { extractContacts } = await loadRules();
  const contacts = extractContacts(`
    官网：https://www.example.com
    电话：400-800-1234 0592-1234567
    邮箱：bd@example.com
    手机：13812345678
  `);

  assert.deepEqual(contacts.emails, ["bd@example.com"]);
  assert.deepEqual(contacts.companyPhones, ["400-800-1234", "0592-1234567"]);
  assert.equal(contacts.hasPublicMobile, true);
  assert.deepEqual(contacts.mobileNumbers, ["13812345678"]);
  assert.equal(contacts.website, "https://www.example.com");
});

test("mergeResult preserves BOSS evidence and appends riskbird fields", async () => {
  const { mergeResult } = await loadRules();
  const merged = mergeResult(
    { companyName: "测试科技", jobName: "AI销售", jobUrl: "https://www.zhipin.com/job_detail/x" },
    {
      matchedCompanyName: "测试科技有限公司",
      companyPhones: ["400-111-2222"],
      emails: ["sales@example.com"],
      mobileNumbers: ["13900000000"],
      sourceUrl: "https://www.riskbird.com/ent/测试科技有限公司",
    }
  );

  assert.equal(merged.companyName, "测试科技");
  assert.equal(merged.riskbirdMatchedCompanyName, "测试科技有限公司");
  assert.equal(merged.riskbirdCompanyPhones, "400-111-2222");
  assert.equal(merged.riskbirdEmails, "sales@example.com");
  assert.equal(merged.riskbirdMobileNumbers, "13900000000");
  assert.equal(merged.riskbirdSourceUrl, "https://www.riskbird.com/ent/测试科技有限公司");
});

test("mergeStoppedResults preserves unprocessed BOSS rows when RiskBird is stopped", async () => {
  const { mergeResult, mergeStoppedResults } = await loadRules();
  const bossRows = [
    { companyName: "A公司", jobName: "AI销售" },
    { companyName: "B公司", jobName: "SaaS销售" },
    { companyName: "C公司", jobName: "渠道销售" },
  ];
  const completed = [
    mergeResult(bossRows[0], {
      matchedCompanyName: "A公司",
      companyPhones: ["400-111-2222"],
      status: "matched",
    }),
  ];

  const rows = mergeStoppedResults(bossRows, completed);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].companyName, "A公司");
  assert.equal(rows[0].riskbirdStatus, "matched");
  assert.equal(rows[1].companyName, "B公司");
  assert.equal(rows[1].jobName, "SaaS销售");
  assert.equal(rows[1].riskbirdStatus, "stopped_unprocessed");
  assert.equal(rows[2].companyName, "C公司");
  assert.equal(rows[2].riskbirdStatus, "stopped_unprocessed");
});

test("toCsv quotes merged rows", async () => {
  const { toCsv } = await loadRules();
  const csv = toCsv([
    {
      companyName: "测试科技",
      riskbirdMobileNumbers: "13812345678",
      riskbirdCompanyPhones: "400-111-2222",
      note: "A,B",
    },
  ]);

  assert.match(csv, /^"公司名","岗位名"/);
  assert.match(csv, /"测试科技"/);
  assert.match(csv, /"A,B"/);
  assert.match(csv, /"13812345678"/);
});

test("riskbird toCsv exports Chinese column headers", async () => {
  const { toCsv } = await loadRules();
  const headerLine = toCsv([]).split("\n")[0];

  assert.equal(
    headerLine,
    [
      "公司名",
      "岗位名",
      "BOSS岗位链接",
      "BOSS搜索页",
      "BOSS招聘证据",
      "BOSS采集时间",
      "风鸟匹配公司名",
      "风鸟企业公开电话",
      "风鸟企业邮箱",
      "风鸟官网",
      "是否发现公开手机号",
      "风鸟公开手机号",
      "风鸟来源链接",
      "风鸟匹配状态",
      "风鸟备注",
      "备注",
    ].map((value) => `"${value}"`).join(",")
  );
});

test("boss collector declares Chinese CSV headers", async () => {
  const code = await readFile("chrome-extension/boss-lead-collector/collector.js", "utf8");

  assert.match(code, /label:\s*"\\u516c\\u53f8\\u540d"/);
  assert.match(code, /label:\s*"\\u5c97\\u4f4d\\u540d"/);
  assert.match(code, /label:\s*"BOSS\\u5c97\\u4f4d\\u94fe\\u63a5"/);
});

test("boss collector exports xlsx when the XLSX library is available", async () => {
  const popupHtml = await readFile("chrome-extension/boss-lead-collector/popup.html", "utf8");
  const popupJs = await readFile("chrome-extension/boss-lead-collector/popup.js", "utf8");
  const collectorCode = await readFile("chrome-extension/boss-lead-collector/collector.js", "utf8");

  assert.match(popupHtml, /vendor\/xlsx\.full\.min\.js/);
  assert.match(popupJs, /files:\s*\["vendor\/xlsx\.full\.min\.js",\s*"collector-rules\.js",\s*"collector\.js"\]/);
  assert.match(collectorCode, /XLSX\.utils\.aoa_to_sheet/);
  assert.match(collectorCode, /\.xlsx`/);
});

test("exports use readable local timestamps in filenames", async () => {
  const collectorCode = await readFile("chrome-extension/boss-lead-collector/collector.js", "utf8");
  const bossPopupCode = await readFile("chrome-extension/boss-lead-collector/popup.js", "utf8");
  const integratedRiskbirdCode = await readFile("chrome-extension/boss-lead-collector/riskbird-content.js", "utf8");
  const standaloneRiskbirdCode = await readFile("chrome-extension/riskbird-company-enricher/content.js", "utf8");
  const standalonePopupCode = await readFile("chrome-extension/riskbird-company-enricher/popup.js", "utf8");

  for (const code of [collectorCode, bossPopupCode, integratedRiskbirdCode, standaloneRiskbirdCode, standalonePopupCode]) {
    assert.match(code, /function formatTimestampForFilename/);
    assert.match(code, /getFullYear\(\)/);
    assert.match(code, /getHours\(\)/);
  }

  assert.doesNotMatch(collectorCode, /boss-leads-\$\{new Date\(\)\.toISOString/);
  assert.doesNotMatch(bossPopupCode, /riskbird-enriched-\$\{new Date\(\)\.toISOString/);
  assert.doesNotMatch(integratedRiskbirdCode, /riskbird-enriched-\$\{new Date\(\)\.toISOString/);
  assert.doesNotMatch(standaloneRiskbirdCode, /riskbird-enriched-\$\{new Date\(\)\.toISOString/);
  assert.doesNotMatch(standalonePopupCode, /riskbird-enriched-\$\{new Date\(\)\.toISOString/);
});

test("standalone RiskBird enricher exports XLSX when the XLSX library is available", async () => {
  const manifest = JSON.parse(await readFile("chrome-extension/riskbird-company-enricher/manifest.json", "utf8"));
  const popupHtml = await readFile("chrome-extension/riskbird-company-enricher/popup.html", "utf8");
  const popupCode = await readFile("chrome-extension/riskbird-company-enricher/popup.js", "utf8");
  const contentCode = await readFile("chrome-extension/riskbird-company-enricher/content.js", "utf8");

  assert.match(popupHtml, /vendor\/xlsx\.full\.min\.js/);
  assert.deepEqual(manifest.content_scripts[0].js, [
    "vendor/xlsx.full.min.js",
    "rules.js",
    "content.js",
  ]);
  assert.match(popupCode, /files:\s*\["vendor\/xlsx\.full\.min\.js",\s*"rules\.js",\s*"content\.js"\]/);
  assert.match(popupCode, /XLSX\.utils\.aoa_to_sheet/);
  assert.match(popupCode, /extension = "xlsx"/);
  assert.match(popupCode, /riskbird-enriched-\$\{formatTimestampForFilename\(\)\}\.\$\{extension\}/);
  assert.match(contentCode, /XLSX\.utils\.aoa_to_sheet/);
  assert.match(contentCode, /extension = "xlsx"/);
  assert.match(contentCode, /riskbird-enriched-\$\{formatTimestampForFilename\(\)\}\.\$\{extension\}/);
});

test("boss extension declares an automatic RiskBird workflow", async () => {
  const manifest = JSON.parse(await readFile("chrome-extension/boss-lead-collector/manifest.json", "utf8"));
  const popupHtml = await readFile("chrome-extension/boss-lead-collector/popup.html", "utf8");
  const popupJs = await readFile("chrome-extension/boss-lead-collector/popup.js", "utf8");
  const collectorCode = await readFile("chrome-extension/boss-lead-collector/collector.js", "utf8");
  const backgroundCode = await readFile("chrome-extension/boss-lead-collector/background.js", "utf8");
  const riskbirdRulesCode = await readFile("chrome-extension/boss-lead-collector/riskbird-rules.js", "utf8");
  const riskbirdContentCode = await readFile("chrome-extension/boss-lead-collector/riskbird-content.js", "utf8");

  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.host_permissions.includes("https://*.riskbird.com/*"));
  assert.equal(manifest.background.service_worker, "background.js");
  assert.deepEqual(manifest.content_scripts[0].js, [
    "vendor/xlsx.full.min.js",
    "riskbird-rules.js",
    "riskbird-content.js",
  ]);
  assert.deepEqual(manifest.content_scripts[1].js, [
    "vendor/xlsx.full.min.js",
    "collector-rules.js",
    "collector.js",
  ]);

  assert.match(popupHtml, /id="run-auto"/);
  assert.match(popupHtml, /riskbird-rules\.js/);
  assert.match(popupJs, /autoRiskbird:\s*true/);
  assert.match(popupJs, /stopRiskbirdWorkflow/);
  assert.match(popupJs, /mergeStoppedResults\(job\.rows/);
  assert.match(popupJs, /downloadRiskbirdRows/);
  assert.match(collectorCode, /boss-auto-riskbird-start/);
  assert.match(backgroundCode, /riskbirdEnricher/);
  assert.match(backgroundCode, /chrome\.tabs\.create/);
  assert.match(riskbirdRulesCode, /mergeStoppedResults/);
  assert.match(riskbirdContentCode, /__bossRiskbirdAutoInstalled/);
  assert.match(riskbirdContentCode, /function normalizeSearchKeyword/);
  assert.match(riskbirdContentCode, /function isCurrentSearchForCompany/);
  assert.match(riskbirdContentCode, /\.replace\(\/\\s\+\/g,\s*""\)/);
  assert.match(riskbirdContentCode, /new URLSearchParams\(location\.search\)/);
  assert.match(riskbirdContentCode, /function findBestCompanySearchResult/);
  assert.match(riskbirdContentCode, /function buildSearchResult/);
  assert.match(riskbirdContentCode, /matched_search/);
  assert.doesNotMatch(riskbirdContentCode, /openCompanyLinkInCurrentTab\(link\)/);
  assert.doesNotMatch(riskbirdContentCode, /if \(link\) \{\s*link\.click\(\);/);
  assert.match(riskbirdContentCode, /XLSX\.utils\.aoa_to_sheet/);
});

test("standalone RiskBird enricher uses search results without opening detail pages", async () => {
  const contentCode = await readFile("chrome-extension/riskbird-company-enricher/content.js", "utf8");
  const popupCode = await readFile("chrome-extension/riskbird-company-enricher/popup.js", "utf8");

  assert.match(contentCode, /function normalizeSearchKeyword/);
  assert.match(contentCode, /function isCurrentSearchForCompany/);
  assert.match(contentCode, /function findBestCompanySearchResult/);
  assert.match(contentCode, /function buildSearchResult/);
  assert.match(contentCode, /matched_search/);
  assert.match(contentCode, /No matching company result found on RiskBird search page/);
  assert.doesNotMatch(contentCode, /if \(link\) \{\s*link\.click\(\);/);
  assert.match(popupCode, /mergeStoppedResults\(job\.rows/);
});

test("RiskBird content scripts recheck stopped state before continuing async work", async () => {
  const standaloneContentCode = await readFile("chrome-extension/riskbird-company-enricher/content.js", "utf8");
  const integratedContentCode = await readFile("chrome-extension/boss-lead-collector/riskbird-content.js", "utf8");

  for (const code of [standaloneContentCode, integratedContentCode]) {
    assert.match(code, /async function isJobStillRunning\(job\)/);
    assert.match(code, /const latestJob = await storageGet\(\)/);
    assert.match(code, /latestJob\?\.status === "running"/);
    assert.match(code, /if \(!await isJobStillRunning\(job\)\) return;/);
    assert.match(code, /if \(!await isJobStillRunning\(job\)\) \{\s*return;\s*\}\s*location\.href = searchUrl\(companyName\)/);
    assert.match(code, /async function markSearchStarted\(job, searchStartedAt\)/);
    assert.doesNotMatch(code, /storageSet\(\{\s*...job,\s*searchStartedAt\s*\}\)/);
  }
});

test("boss collector picks company names from BOSS cards instead of job titles", async () => {
  const { isLikelyCompany, pickCompanyFromLines } = await loadBossCollectorRules();

  assert.equal(isLikelyCompany("3-5年", "AI数字人 销售"), false);
  assert.equal(isLikelyCompany("5-10年", "销售经理"), false);

  assert.equal(
    pickCompanyFromLines(
      ["AI蓝图赛道·高提成销售+无责", "9-14K", "经验不限", "学历不限", "成都属华盛世数字科技", "成都·武侯区·中和"],
      "AI蓝图赛道·高提成销售+无责"
    ),
    "成都属华盛世数字科技"
  );
  assert.equal(
    pickCompanyFromLines(
      ["ai人工智能项目推广 月入过万 可全职可居家", "6-11K", "1-3年", "高中", "数智引擎", "成都·成华区·建设路"],
      "ai人工智能项目推广 月入过万 可全职可居家"
    ),
    "数智引擎"
  );
  assert.equal(
    pickCompanyFromLines(
      ["ai销售 面试就上班 入职1.5w起", "20-35K", "经验不限", "学历不限", "成都乐薪", "成都·成华区·万象城"],
      "ai销售 面试就上班 入职1.5w起"
    ),
    "成都乐薪"
  );
  assert.equal(
    pickCompanyFromLines(
      ["人工智能销售岗位/接受应届生", "6-9", "K", "经验不限", "学历不限", "杭州合鑫元商务咨询", "杭州"],
      "人工智能销售岗位/接受应届生"
    ),
    "杭州合鑫元商务咨询"
  );
  assert.equal(
    pickCompanyFromLines(
      ["AI销售经理", "10-15", "K", "3-5年", "学历不限", "杭州成美信息技术服务", "杭州"],
      "AI销售经理"
    ),
    "杭州成美信息技术服务"
  );
  assert.equal(
    pickCompanyFromLines(
      ["人工智能软件销售（已接入 Deepseek）", "8-13K", "1-3年", "大专", "汉数科技", "杭州·滨江区·长河"],
      "人工智能软件销售（已接入 Deepseek）"
    ),
    "汉数科技"
  );
  assert.equal(
    pickCompanyFromLines(
      ["AI数字人 销售", "10-15K", "3-5年", "大专", "杭州天擎来客科技", "杭州·临平区·临平"],
      "AI数字人 销售"
    ),
    "杭州天擎来客科技"
  );
  assert.equal(
    pickCompanyFromLines(
      ["销售经理", "20-30K", "5-10年", "大专", "铂然天使", "杭州·临平区·东湖"],
      "销售经理"
    ),
    "铂然天使"
  );
});

test("boss collector can start automatically from boss_auto URLs", async () => {
  const {
    bossAutoOptionsFromUrl,
    buildSearchUrlFromAutoOptions,
    shouldNavigateForAuto,
  } = await loadBossCollectorRules();

  const options = bossAutoOptionsFromUrl("https://www.zhipin.com/chengdu/?boss_auto=1&query=AI%E9%94%80%E5%94%AE");
  assert.deepEqual(options, {
    auto: true,
    autoRiskbird: true,
    query: "AI销售",
    city: "101270100",
  });

  const target = buildSearchUrlFromAutoOptions("https://www.zhipin.com/chengdu/?boss_auto=1&query=AI%E9%94%80%E5%94%AE", options);
  assert.equal(target, "https://www.zhipin.com/web/geek/jobs?query=AI%E9%94%80%E5%94%AE&city=101270100&boss_auto=1");
  assert.equal(shouldNavigateForAuto("https://www.zhipin.com/chengdu/?boss_auto=1&query=AI%E9%94%80%E5%94%AE", options), true);
  assert.equal(shouldNavigateForAuto(target, options), false);
});

test("boss collector keeps scrolling until the page bottom is stable", async () => {
  const { shouldContinueCollecting } = await loadBossCollectorRules();

  assert.equal(shouldContinueCollecting({
    scrolls: 35,
    maxScrolls: 180,
    atBottom: false,
    stableRounds: 12,
    minStableRounds: 8,
    stopRequested: false,
  }), true);
  assert.equal(shouldContinueCollecting({
    scrolls: 50,
    maxScrolls: 180,
    atBottom: true,
    stableRounds: 7,
    minStableRounds: 8,
    stopRequested: false,
  }), true);
  assert.equal(shouldContinueCollecting({
    scrolls: 51,
    maxScrolls: 180,
    atBottom: true,
    stableRounds: 8,
    minStableRounds: 8,
    stopRequested: false,
  }), false);
  assert.equal(shouldContinueCollecting({
    scrolls: 180,
    maxScrolls: 180,
    atBottom: false,
    stableRounds: 0,
    minStableRounds: 8,
    stopRequested: false,
  }), false);
});

test("boss collector waits for cards and does not export an empty workbook", async () => {
  const collectorCode = await readFile("chrome-extension/boss-lead-collector/collector.js", "utf8");

  assert.match(collectorCode, /function findCards\(\)/);
  assert.match(collectorCode, /a\[href\*='\/job_detail\/'\]/);
  assert.match(collectorCode, /normalizeLines\(rawText\(card\)\)/);
  assert.match(collectorCode, /emptyWaitMs/);
  assert.match(collectorCode, /maxScrolls:\s*180/);
  assert.match(collectorCode, /minStableRounds:\s*8/);
  assert.match(collectorCode, /shouldContinueCollecting/);
  assert.match(collectorCode, /if \(!rows\.length\)/);
  assert.match(collectorCode, /\\u672a\\u5bfc\\u51fa\\u7a7a\\u8868/);
});

test("scoreCompanyMatch rejects unrelated RiskBird detail pages", async () => {
  const { scoreCompanyMatch } = await loadRules();

  assert.equal(
    scoreCompanyMatch("\u629a\u987a\u987a\u91d1\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8.html", "\u98ce\u706b\u8f6e\u7f51\u7edc"),
    0
  );
  assert.ok(
    scoreCompanyMatch("\u629a\u987a\u987a\u91d1\u4fe1\u606f\u79d1\u6280\u6709\u9650\u516c\u53f8.html", "\u629a\u987a\u987a\u91d1\u4fe1\u606f\u79d1\u6280") > 0
  );
});

test("normalizeRows accepts spreadsheet objects with Chinese company headers", async () => {
  const { normalizeRows } = await loadRules();
  const rows = normalizeRows([
    {
      "\u516c\u53f8\u540d": "\u53a6\u95e8\u7bee\u738b\u4e92\u8054\u7f51\u79d1\u6280",
      "\u5c97\u4f4d\u540d": "SaaS\u9500\u552e",
      "\u5c97\u4f4d\u94fe\u63a5": "https://www.zhipin.com/job_detail/x.html",
    },
  ]);

  assert.equal(rows[0].companyName, "\u53a6\u95e8\u7bee\u738b\u4e92\u8054\u7f51\u79d1\u6280");
  assert.equal(rows[0].jobName, "SaaS\u9500\u552e");
  assert.equal(rows[0].jobUrl, "https://www.zhipin.com/job_detail/x.html");
});

test("cleanSharedMobileMasks removes masks repeated across different companies", async () => {
  const { cleanSharedMobileMasks } = await loadRules();
  const rows = cleanSharedMobileMasks([
    {
      riskbirdMatchedCompanyName: "A公司",
      riskbirdHasPublicMobile: "是",
      riskbirdMobileMasked: "177****2966; 189****8041",
    },
    {
      riskbirdMatchedCompanyName: "B公司",
      riskbirdHasPublicMobile: "是",
      riskbirdMobileMasked: "177****2966; 183****2892; 180****7610; 189****8041",
    },
    {
      riskbirdMatchedCompanyName: "C公司",
      riskbirdHasPublicMobile: "是",
      riskbirdMobileMasked: "177****2966; 189****8041",
    },
  ]);

  assert.equal(rows[0].riskbirdHasPublicMobile, "否");
  assert.equal(rows[0].riskbirdMobileNumbers, "");
  assert.equal(rows[1].riskbirdHasPublicMobile, "是");
  assert.equal(rows[1].riskbirdMobileNumbers, "183****2892; 180****7610");
  assert.equal(rows[2].riskbirdHasPublicMobile, "否");
  assert.equal(rows[2].riskbirdMobileNumbers, "");
});

test("isActionLockActive blocks repeated action but releases on target page", async () => {
  const { isActionLockActive } = await loadRules();
  const lock = {
    index: 3,
    companyName: "厦门篮王互联网科技",
    action: "search",
    until: 2000,
  };

  assert.equal(
    isActionLockActive(lock, {
      currentIndex: 3,
      companyName: "厦门篮王互联网科技",
      now: 1000,
      isSearchPage: false,
      isDetailPage: false,
      locationSearch: "",
    }),
    true
  );

  assert.equal(
    isActionLockActive(lock, {
      currentIndex: 3,
      companyName: "厦门篮王互联网科技",
      now: 1000,
      isSearchPage: true,
      isDetailPage: false,
      locationSearch: "?keyword=%E5%8E%A6%E9%97%A8%E7%AF%AE%E7%8E%8B%E4%BA%92%E8%81%94%E7%BD%91%E7%A7%91%E6%8A%80",
    }),
    false
  );

  assert.equal(
    isActionLockActive({ ...lock, until: 900 }, {
      currentIndex: 3,
      companyName: "厦门篮王互联网科技",
      now: 1000,
      isSearchPage: false,
      isDetailPage: false,
      locationSearch: "",
    }),
    false
  );
});
