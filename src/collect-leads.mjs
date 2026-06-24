import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import crypto from "node:crypto";

import {
  extractContacts,
  parseSearchResults,
  redactMobileNumbers,
  scoreLead,
  toCsv,
  toLeadRow,
} from "./lead-rules.mjs";

const DEFAULT_QUERIES = [
  "AI客服 SaaS 服务商 官网 公司 -新闻 -报告 -文章 -知乎 -36氪",
  "AI智能体 企业服务 服务商 官网 公司 -新闻 -报告 -文章 -知乎",
  "AI外呼 系统 服务商 官网 公司 -新闻 -报告 -文章",
  "AI获客系统 服务商 官网 公司 -新闻 -报告 -文章",
  "企微SCRM SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "营销自动化 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "CRM SaaS 渠道代理 服务商 官网 公司 -新闻 -报告 -文章",
  "客户管理 CRM SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "企业数字化 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "AI知识库 智能客服 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "RPA AI 企业服务 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "智能客服系统 厂商 官网 公司 -新闻 -报告 -文章",
  "AI外呼机器人 系统 厂商 官网 公司 -新闻 -报告 -文章",
  "企微获客系统 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "私域运营 SCRM SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "电销外呼系统 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "客服机器人 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "知识库系统 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "低代码平台 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "OA 协同办公 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
  "财税 SaaS 服务商 官网 公司 -新闻 -报告 -文章",
];

const BLOCKED_DOMAINS = [
  "baidu.com",
  "bing.com",
  "google.",
  "zhihu.com",
  "weixin.qq.com",
  "mp.weixin.qq.com",
  "qcc.com",
  "tianyancha.com",
  "aiqicha.baidu.com",
  "riskbird.com",
  "zhipin.com",
  "liepin.com",
  "lagou.com",
  "51job.com",
  "jobui.com",
  "kanzhun.com",
  "processon.com",
  "thepaper.cn",
  "36kr.com",
  "msn.cn",
  "qixin.com",
  "gov.cn",
  "edu.cn",
  "aliyun.com",
  "cloud.tencent.com",
  "huaweicloud.com",
  "volcengine.com",
  "jdcloud.com",
  "journal.qq.com",
  "qq.com",
  "sohu.com",
  "163.com",
  "csdn.net",
  "juejin.cn",
  "unite.ai",
  "ai-bot.cn",
  "ai-kit.cn",
  "bilibili.com",
  "douyin.com",
];

const CONTACT_HINTS = ["contact", "contacts", "about", "lianxi", "联系我们", "关于我们", "商务合作"];

const BLOCKED_PATH_TERMS = [
  "/news",
  "/article",
  "/articles",
  "/blog/",
  "/post/",
  "/p/",
  "/a/",
  "/zh-cn/",
  "/gaming",
  "/download",
];

const BAD_RESULT_TERMS = [
  "新闻",
  "资讯",
  "报告",
  "文章",
  "排行榜",
  "排名",
  "盘点",
  "大全",
  "合集",
  "工具集",
  "教程",
  "下载",
  "招聘",
  "薪酬",
  "通知",
  "行动计划",
  "教育部",
  "第一节",
  "怎么样",
  "是什么",
  "36氪",
  "知乎",
];

const COMPANY_HINT_TERMS = [
  "官网",
  "公司",
  "有限公司",
  "服务商",
  "解决方案",
  "SaaS",
  "CRM",
  "SCRM",
  "AI客服",
  "智能体",
  "企业服务",
  "数字化",
  "系统",
  "平台",
];

const CHINA_MARKET_TERMS = [
  "ICP备",
  "ICP",
  "公网安备",
  "有限公司",
  "中国",
  "400-",
  "400",
  "北京",
  "上海",
  "深圳",
  "广州",
  "杭州",
  "成都",
];

const DIRECTORY_API_BASE = "https://gateway.36dianping.com";
const DIRECTORY_SIGN_SECRET = "qtdND6p2f2A42o2NFIHFAw";
const DIRECTORY_CATEGORY_TERMS = [
  "智能营销",
  "私域运营",
  "客户关系管理",
  "销售自动化",
  "AI智能销售",
  "电话销售",
  "AI智能外呼",
  "渠道管理",
  "在线客服",
  "AI智能客服",
  "呼叫中心",
  "智能质检",
  "售后服务",
  "客户体验",
  "人力资源",
  "招聘",
  "绩效",
  "低代码",
  "无代码",
  "RPA",
  "OA",
  "协同办公",
  "电子签",
  "项目管理",
  "财税",
  "进销存",
  "ERP",
  "BI",
  "数据分析",
  "CDP",
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });

  const directoryResults = options.source !== "search"
    ? await getDirectorySeeds(options).catch(() => [])
    : [];

  const searchResults = [];
  if (options.source !== "directory") {
    for (const query of options.queries) {
      for (let page = 1; page <= options.pages; page += 1) {
        const html = await fetchText(bingUrl(query, page), options.timeoutMs);
        const parsed = parseSearchResults(html)
          .map((result) => ({ ...result, query }))
          .filter(isLikelyLeadCandidate);
        searchResults.push(...parsed);
        await sleep(options.delayMs);
        if (uniqueOrigins([...directoryResults, ...searchResults]).length >= options.max * 6) break;
      }
      if (uniqueOrigins([...directoryResults, ...searchResults]).length >= options.max * 6) break;
    }
  }

  const candidates = uniqueByOrigin([...directoryResults, ...searchResults])
    .filter((result) => isUsefulUrl(result.url))
    .slice(0, options.max * 6);

  const leads = await collectLeads(candidates, options);

  const rows = leads
    .sort((a, b) => b.score - a.score)
    .slice(0, options.max)
    .map(toLeadRow);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const csvPath = resolve(options.outDir, `saas-ai-leads-${stamp}.csv`);
  const jsonPath = resolve(options.outDir, `saas-ai-leads-${stamp}.json`);
  await writeFile(csvPath, `\uFEFF${toCsv(rows)}\n`, "utf8");
  await writeFile(jsonPath, JSON.stringify(leads, null, 2), "utf8");

  console.log(JSON.stringify({ csvPath, jsonPath, count: rows.length }, null, 2));
}

async function buildLead(candidate, options) {
  const candidateUrl = normalizeUrl(candidate.url);
  const homepage = originOf(candidateUrl);
  const pageText = await fetchText(homepage, options.timeoutMs).catch(() =>
    fetchText(candidateUrl, options.timeoutMs)
  );
  const contactPage = await findContactPage(homepage, pageText, options);
  const contactText = contactPage ? await fetchText(contactPage, options.timeoutMs).catch(() => "") : "";
  const combinedText = normalizeText(`${candidate.title}\n${candidate.snippet}\n${pageText}\n${contactText}`);
  if (!looksLikeCompanyPage(combinedText)) return null;
  if (options.market === "cn" && !looksLikeChinaMarket(combinedText, homepage)) return null;

  const description = redactMobileNumbers(combinedText).slice(0, 1800);
  const contacts = extractContacts(combinedText, contactPage || homepage);
  const companyName = inferCompanyName(candidate.title, pageText, homepage);

  const scored = scoreLead({
    companyName,
    website: originOf(homepage),
    description,
    contacts,
    sourceUrls: unique([candidate.sourceUrl, candidate.url, homepage, contactPage].filter(Boolean)),
  });

  return scored.category === "Other" ? null : scored;
}

async function collectLeads(candidates, options) {
  const leads = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(options.concurrency, candidates.length));

  async function worker() {
    while (nextIndex < candidates.length && leads.length < options.max) {
      const candidate = candidates[nextIndex];
      nextIndex += 1;

      const lead = await buildLead(candidate, options).catch(() => null);
      if (lead && lead.score >= options.minScore) leads.push(lead);
      await sleep(options.delayMs);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, worker));
  return leads;
}

async function findContactPage(homepage, html, options) {
  const links = extractLinks(homepage, html);
  const contact = links.find((link) =>
    CONTACT_HINTS.some((hint) => link.text.includes(hint) || link.href.toLowerCase().includes(hint.toLowerCase()))
  );
  if (contact) return contact.href;

  const origin = originOf(homepage);
  for (const path of ["/contact", "/contact-us", "/about", "/about-us"]) {
    const url = `${origin}${path}`;
    const text = await fetchText(url, Math.min(options.timeoutMs, 8000)).catch(() => "");
    if (text && /联系|电话|邮箱|contact|email/i.test(text)) return url;
  }
  return homepage;
}

function extractLinks(baseUrl, html) {
  const links = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = re.exec(html))) {
    const href = absolutize(baseUrl, match[1]);
    if (!href || originOf(href) !== originOf(baseUrl)) continue;
    const text = stripTags(match[2]);
    links.push({ href, text });
  }
  return links;
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LeadResearchBot/0.1; +local)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return decodeResponse(await response.arrayBuffer(), response.headers.get("content-type") || "");
  } finally {
    clearTimeout(timeout);
  }
}

function decodeResponse(buffer, contentType) {
  const declared = contentType.match(/charset=([^;]+)/i)?.[1]?.trim().toLowerCase();
  const encodings = unique([declared, "utf-8", "gb18030", "gbk"].filter(Boolean));

  for (const encoding of encodings) {
    try {
      return new TextDecoder(encoding).decode(buffer);
    } catch {
      // Try the next likely web-page encoding.
    }
  }
  return new TextDecoder().decode(buffer);
}

function parseArgs(args) {
  const options = {
    max: 100,
    minScore: 30,
    pages: 5,
    directoryPages: 3,
    pageSize: 50,
    source: "all",
    market: "cn",
    concurrency: 4,
    timeoutMs: 15000,
    delayMs: 600,
    outDir: "outputs",
    queries: DEFAULT_QUERIES,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--max") options.max = Number(args[++i]);
    else if (arg === "--min-score") options.minScore = Number(args[++i]);
    else if (arg === "--pages") options.pages = Number(args[++i]);
    else if (arg === "--directory-pages") options.directoryPages = Number(args[++i]);
    else if (arg === "--page-size") options.pageSize = Number(args[++i]);
    else if (arg === "--source") options.source = args[++i];
    else if (arg === "--market") options.market = args[++i];
    else if (arg === "--concurrency") options.concurrency = Number(args[++i]);
    else if (arg === "--out") options.outDir = args[++i];
    else if (arg === "--query") options.queries = [args[++i]];
  }
  return options;
}

function bingUrl(query, page = 1) {
  const first = (page - 1) * 10 + 1;
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${first}`;
}

async function getDirectorySeeds(options) {
  const classify = await directoryPost("/api/qps/nav/classifyList", {});
  const categories = flattenCategories(classify?.classifyList || [])
    .filter((category) => DIRECTORY_CATEGORY_TERMS.some((term) => category.name.includes(term)));

  const products = [];
  for (const category of categories) {
    for (let pageNo = 1; pageNo <= options.directoryPages; pageNo += 1) {
      const data = await directoryPost("/api/qps/nav/classify/productList", {
        classifyId: category.id,
        pageNo,
        pageSize: options.pageSize,
      }).catch(() => null);
      const list = data?.productList || [];
      products.push(...list.map((product) => ({
        title: product.name,
        snippet: `${category.name} ${product.introduction || ""}`,
        url: product.webUrl,
        sourceUrl: product.route || `https://nav.36dianping.com/category/${category.id}`,
      })));
      if (list.length < options.pageSize) break;
      await sleep(Math.min(options.delayMs, 300));
    }
  }

  return products
    .filter((product) => product.url)
    .filter((product) => isUsefulUrl(product.url));
}

async function directoryPost(path, param) {
  const body = { param, partner_id: "dian-ping-web" };
  const sign = crypto
    .createHash("md5")
    .update(`${JSON.stringify(body)}${DIRECTORY_SIGN_SECRET}`)
    .digest("hex");

  const response = await fetch(`${DIRECTORY_API_BASE}${path}?sign=${sign}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": "https://nav.36dianping.com",
      "Referer": "https://nav.36dianping.com/",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Directory API HTTP ${response.status}`);
  const json = await response.json();
  if (json.code !== 0) throw new Error(json.msg || `Directory API code ${json.code}`);
  return json.data;
}

function flattenCategories(categories) {
  const out = [];
  for (const category of categories) {
    out.push(category);
    if (category.childList?.length) out.push(...flattenCategories(category.childList));
  }
  return out;
}

function inferCompanyName(title, html, url) {
  const titleName = cleanupCompanyName(title);
  if (titleName) return titleName;

  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (h1) return cleanupCompanyName(stripTags(h1));

  return new URL(url).hostname.replace(/^www\./, "");
}

function cleanupCompanyName(value) {
  return stripTags(value)
    .split(/[-_|—–]/)[0]
    .replace(/官网|官方网站|首页|系统|平台/g, "")
    .replace(/\s+/g, "")
    .slice(0, 40);
}

function isUsefulUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    return !BLOCKED_DOMAINS.some((domain) => host.includes(domain)) &&
      !BLOCKED_PATH_TERMS.some((term) => path.includes(term));
  } catch {
    return false;
  }
}

function isLikelyLeadCandidate(result) {
  if (!isUsefulUrl(result.url)) return false;

  const text = `${result.title || ""} ${result.snippet || ""}`;
  if (BAD_RESULT_TERMS.some((term) => text.includes(term))) return false;
  return COMPANY_HINT_TERMS.some((term) => text.toLowerCase().includes(term.toLowerCase()));
}

function looksLikeCompanyPage(text) {
  const hits = COMPANY_HINT_TERMS.filter((term) => text.toLowerCase().includes(term.toLowerCase())).length;
  return hits >= 2;
}

function looksLikeChinaMarket(text, url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith(".cn") || host.endsWith(".com.cn") || host.endsWith(".net.cn")) return true;
  return CHINA_MARKET_TERMS.some((term) => text.includes(term));
}

function uniqueByOrigin(results) {
  const seen = new Set();
  const out = [];
  for (const result of results) {
    const origin = originOf(result.url);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    out.push(result);
  }
  return out;
}

function uniqueOrigins(results) {
  return new Set(results.map((result) => originOf(result.url)).filter(Boolean));
}

function normalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function absolutize(baseUrl, href) {
  try {
    if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) return "";
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
}

function normalizeText(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
