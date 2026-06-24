import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyBusiness,
  extractContacts,
  maskMobileNumbers,
  parseSearchResults,
  redactMobileNumbers,
  toLeadRow,
  scoreLead,
  toCsv,
} from "../src/lead-rules.mjs";

test("extractContacts keeps company phones and emails but masks mobile numbers", () => {
  const pageText = `
    商务合作：sales@example.com
    联系电话：400-800-1234 / 010-88886666
    项目负责人：13812345678
  `;

  const contacts = extractContacts(pageText, "https://example.com/contact");

  assert.deepEqual(contacts.emails, ["sales@example.com"]);
  assert.deepEqual(contacts.companyPhones, ["400-800-1234", "010-88886666"]);
  assert.equal(contacts.hasPublicMobile, true);
  assert.deepEqual(contacts.mobileMasked, ["138****5678"]);
  assert.equal(contacts.sourceUrl, "https://example.com/contact");
});

test("extractContacts does not treat random bare numbers as company phones", () => {
  const contacts = extractContacts("阅读数 15008605，文章编号 20200755", "https://example.com");

  assert.deepEqual(contacts.companyPhones, []);
});

test("redactMobileNumbers masks full mobile numbers inside saved text", () => {
  assert.equal(
    redactMobileNumbers("负责人 13812345678，备用 19900001111"),
    "负责人 138****5678，备用 199****1111"
  );
});

test("classifyBusiness recognizes SaaS and AI service providers", () => {
  assert.equal(
    classifyBusiness("我们提供AI智能客服、AI外呼、知识库智能体和SaaS系统交付").category,
    "AI/SaaS"
  );
  assert.equal(
    classifyBusiness("专注餐饮门店装修设计和施工").category,
    "Other"
  );
});

test("scoreLead prioritizes AI/SaaS vendors with channel fit", () => {
  const lead = scoreLead({
    companyName: "某某智能科技有限公司",
    description: "AI客服 SaaS CRM 渠道代理 OEM 客户成功",
    contacts: { emails: ["bd@example.com"], companyPhones: ["400-123-4567"], hasPublicMobile: false },
    sourceUrls: ["https://example.com"],
  });

  assert.equal(lead.grade, "A");
  assert.ok(lead.score >= 80);
  assert.equal(lead.recommendedCooperation, "代理/OEM/联合交付");
});

test("toCsv exports stable headers and quotes values", () => {
  const csv = toCsv([
    {
      companyName: "测试科技",
      website: "https://example.com",
      category: "AI/SaaS",
      score: 88,
      grade: "A",
      emails: "bd@example.com",
      companyPhones: "400-123-4567",
      hasPublicMobile: "是",
      mobileMasked: "138****5678",
      contactPage: "https://example.com/contact",
      recommendedCooperation: "代理/OEM/联合交付",
      rationale: "AI客服",
      sourceUrls: "https://example.com",
    },
  ]);

  assert.match(csv, /^"公司名","官网","类型"/);
  assert.match(csv, /"测试科技","https:\/\/example.com","AI\/SaaS"/);
});

test("parseSearchResults extracts result title, url, and snippet from Bing HTML", () => {
  const html = `
    <li class="b_algo">
      <h2><a href="https://example.com">某某AI客服系统</a></h2>
      <p>提供AI客服、SaaS系统、渠道代理合作。</p>
    </li>
  `;

  assert.deepEqual(parseSearchResults(html), [
    {
      title: "某某AI客服系统",
      url: "https://example.com",
      snippet: "提供AI客服、SaaS系统、渠道代理合作。",
    },
  ]);
});

test("toLeadRow joins contacts without exposing raw mobile numbers", () => {
  const scored = scoreLead({
    companyName: "某某AI",
    website: "https://example.com",
    description: "AI客服 SaaS 渠道",
    contacts: {
      emails: ["bd@example.com"],
      companyPhones: ["400-123-4567"],
      hasPublicMobile: true,
      mobileMasked: ["139****0000"],
      sourceUrl: "https://example.com/contact",
    },
    sourceUrls: ["https://example.com"],
  });

  const row = toLeadRow(scored);

  assert.equal(row.hasPublicMobile, "是");
  assert.equal(row.mobileMasked, "139****0000");
  assert.equal(row.companyPhones, "400-123-4567");
  assert.doesNotMatch(JSON.stringify(row), /13900000000/);
});
