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
  assert.match(popupJs, /files:\s*\["vendor\/xlsx\.full\.min\.js",\s*"collector\.js"\]/);
  assert.match(collectorCode, /XLSX\.utils\.aoa_to_sheet/);
  assert.match(collectorCode, /\.xlsx`/);
});

test("boss extension declares an automatic RiskBird workflow", async () => {
  const manifest = JSON.parse(await readFile("chrome-extension/boss-lead-collector/manifest.json", "utf8"));
  const popupHtml = await readFile("chrome-extension/boss-lead-collector/popup.html", "utf8");
  const popupJs = await readFile("chrome-extension/boss-lead-collector/popup.js", "utf8");
  const collectorCode = await readFile("chrome-extension/boss-lead-collector/collector.js", "utf8");
  const backgroundCode = await readFile("chrome-extension/boss-lead-collector/background.js", "utf8");
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

  assert.match(popupHtml, /id="run-auto"/);
  assert.match(popupHtml, /riskbird-rules\.js/);
  assert.match(popupJs, /autoRiskbird:\s*true/);
  assert.match(popupJs, /stopRiskbirdWorkflow/);
  assert.match(popupJs, /downloadRiskbirdRows/);
  assert.match(collectorCode, /boss-auto-riskbird-start/);
  assert.match(backgroundCode, /riskbirdEnricher/);
  assert.match(backgroundCode, /chrome\.tabs\.create/);
  assert.match(riskbirdContentCode, /__bossRiskbirdAutoInstalled/);
  assert.match(riskbirdContentCode, /XLSX\.utils\.aoa_to_sheet/);
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
