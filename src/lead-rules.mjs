const MOBILE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const COMPANY_PHONE_RE = /(?<!\d)(?:400-?\d{3}-?\d{4}|0\d{2,3}[- ]?\d{7,8})(?!\d)/g;

const CSV_HEADERS = [
  ["companyName", "公司名"],
  ["website", "官网"],
  ["category", "类型"],
  ["score", "评分"],
  ["grade", "等级"],
  ["emails", "商务邮箱"],
  ["companyPhones", "企业公开电话"],
  ["hasPublicMobile", "是否存在公开手机号"],
  ["mobileMasked", "公开手机号脱敏"],
  ["contactPage", "联系页"],
  ["recommendedCooperation", "推荐合作方式"],
  ["rationale", "判断依据"],
  ["sourceUrls", "来源链接"],
];

export function maskMobileNumbers(text) {
  return unique((text.match(MOBILE_RE) || []).map(maskMobile));
}

export function redactMobileNumbers(text) {
  return text.replace(MOBILE_RE, maskMobile);
}

export function extractContacts(text, sourceUrl = "") {
  const withoutMobiles = text.replace(MOBILE_RE, " ");
  const emails = unique(text.match(EMAIL_RE) || []);
  const companyPhones = unique((withoutMobiles.match(COMPANY_PHONE_RE) || []).map(normalizePhone))
    .filter((phone) => phone.length >= 7);
  const mobileMasked = maskMobileNumbers(text);

  return {
    emails,
    companyPhones,
    hasPublicMobile: mobileMasked.length > 0,
    mobileMasked,
    sourceUrl,
  };
}

export function classifyBusiness(text) {
  const normalized = text.toLowerCase();
  const aiHits = countHits(normalized, [
    "ai",
    "人工智能",
    "智能体",
    "智能客服",
    "ai客服",
    "外呼",
    "知识库",
    "大模型",
    "chatbot",
  ]);
  const saasHits = countHits(normalized, [
    "saas",
    "crm",
    "scrm",
    "erp",
    "系统",
    "软件",
    "数字化",
    "营销自动化",
    "客户成功",
  ]);

  if (aiHits > 0 && saasHits > 0) {
    return { category: "AI/SaaS", aiHits, saasHits };
  }
  if (aiHits > 0) {
    return { category: "AI服务商", aiHits, saasHits };
  }
  if (saasHits >= 2) {
    return { category: "SaaS/软件服务商", aiHits, saasHits };
  }
  return { category: "Other", aiHits, saasHits };
}

export function scoreLead(rawLead) {
  const description = rawLead.description || "";
  const classification = classifyBusiness(`${rawLead.companyName || ""} ${description}`);
  const channelHits = countHits(description.toLowerCase(), [
    "代理",
    "渠道",
    "oem",
    "白标",
    "联合交付",
    "客户成功",
    "销售",
    "合作伙伴",
  ]);
  const customerHits = countHits(description.toLowerCase(), [
    "企业客户",
    "中小企业",
    "行业客户",
    "解决方案",
    "案例",
  ]);
  const hasContacts = Boolean(rawLead.contacts?.emails?.length || rawLead.contacts?.companyPhones?.length);

  let score = 0;
  if (classification.category === "AI/SaaS") score += 45;
  else if (classification.category === "AI服务商") score += 35;
  else if (classification.category === "SaaS/软件服务商") score += 30;

  score += Math.min(channelHits * 8, 25);
  score += Math.min(customerHits * 5, 15);
  if (hasContacts) score += 10;
  if ((rawLead.sourceUrls || []).length > 0) score += 5;
  score = Math.min(score, 100);

  return {
    ...rawLead,
    category: classification.category,
    score,
    grade: score >= 80 ? "A" : score >= 60 ? "B" : "C",
    recommendedCooperation: score >= 60 ? "代理/OEM/联合交付" : "暂缓",
    rationale: buildRationale(classification, channelHits, customerHits, hasContacts),
  };
}

export function toCsv(rows) {
  const header = CSV_HEADERS.map(([, label]) => label);
  const lines = [header, ...rows.map((row) => CSV_HEADERS.map(([key]) => row[key] ?? ""))];
  return lines.map((line) => line.map(csvEscape).join(",")).join("\n");
}

export function parseSearchResults(html) {
  const results = [];
  const blockRe = /<li[^>]*class="[^"]*\bb_algo\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let blockMatch;
  while ((blockMatch = blockRe.exec(html))) {
    const block = blockMatch[1];
    const linkMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if (!linkMatch) continue;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    results.push({
      title: decodeHtml(stripTags(linkMatch[2])),
      url: decodeHtml(linkMatch[1]),
      snippet: decodeHtml(stripTags(snippetMatch?.[1] || "")),
    });
  }
  return results;
}

export function toLeadRow(lead) {
  const contacts = lead.contacts || {};
  return {
    companyName: lead.companyName || "",
    website: lead.website || "",
    category: lead.category || "",
    score: lead.score ?? "",
    grade: lead.grade || "",
    emails: (contacts.emails || []).join("; "),
    companyPhones: (contacts.companyPhones || []).join("; "),
    hasPublicMobile: contacts.hasPublicMobile ? "是" : "否",
    mobileMasked: (contacts.mobileMasked || []).join("; "),
    contactPage: contacts.sourceUrl || "",
    recommendedCooperation: lead.recommendedCooperation || "",
    rationale: lead.rationale || "",
    sourceUrls: (lead.sourceUrls || []).join("; "),
  };
}

function buildRationale(classification, channelHits, customerHits, hasContacts) {
  const parts = [`${classification.category}`];
  if (channelHits) parts.push(`渠道/OEM信号${channelHits}`);
  if (customerHits) parts.push(`企业客户信号${customerHits}`);
  if (hasContacts) parts.push("有企业公开联系方式");
  return parts.join("；");
}

function maskMobile(value) {
  return `${value.slice(0, 3)}****${value.slice(7)}`;
}

function normalizePhone(value) {
  return value.replace(/\s+/g, "-").replace(/--+/g, "-");
}

function countHits(text, terms) {
  return terms.reduce((count, term) => count + (text.includes(term.toLowerCase()) ? 1 : 0), 0);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function csvEscape(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
