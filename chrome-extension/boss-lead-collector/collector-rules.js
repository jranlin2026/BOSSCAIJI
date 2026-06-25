(function attachBossCollectorRules(root) {
  const CITY_CODE_BY_SLUG = {
    beijing: "101010100",
    shanghai: "101020100",
    guangzhou: "101280100",
    shenzhen: "101280600",
    hangzhou: "101210100",
    chengdu: "101270100",
    xiamen: "101230200",
  };

  const COMPANY_SUFFIX_RE = /(?:公司|科技|信息|网络|软件|智能|数字|数据|云|互联|集团|传媒|引擎|未来|盛世|乐薪)$/;
  const LOCATION_RE = /(?:北京|上海|广州|深圳|杭州|成都|厦门|武汉|南京|苏州|重庆|天津|西安|长沙|郑州|青岛|合肥|福州|东莞|佛山|无锡|宁波|中山|珠海)[·\s-]/;
  const SALARY_RE = /\d+\s*-\s*\d+\s*K|\d+\s*万|元|\/月|\/天/i;
  const META_RE = /经验|学历|本科|大专|高中|中专|不限|在校|应届|天|周|月/;

  const CHINESE_RE = /[\u4e00-\u9fff]/;
  const SAFE_SALARY_RE = /\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[Kk]|\d+(?:\.\d+)?\s*(?:\u4e07|[wW])\s*\/?\s*(?:\u6708|\u5e74)?/;
  const SAFE_META_RE = /\u7ecf\u9a8c|\u5b66\u5386|\u672c\u79d1|\u5927\u4e13|\u9ad8\u4e2d|\u4e2d\u4e13|\u4e0d\u9650|\u5728\u6821|\u5e94\u5c4a/;
  const TIME_META_RE = /^\d+(?:\.\d+)?\s*(?:\u5929|\u4e2a?\u6708)$/;
  const EXPERIENCE_RE = /^(?:\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*\u5e74|\d+(?:\.\d+)?\s*\u5e74\u4ee5\u4e0a)$/;
  const SALARY_FRAGMENT_RE = /^\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?$/;
  const BAD_TOKEN_RE = /^(?:K|k|\d+|[\d.]+[wW]?|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*[Kk]?)$/;
  const CITY_ONLY_RE = /^(?:\u5317\u4eac|\u4e0a\u6d77|\u5e7f\u5dde|\u6df1\u5733|\u676d\u5dde|\u6210\u90fd|\u53a6\u95e8|\u6b66\u6c49|\u5357\u4eac|\u82cf\u5dde|\u91cd\u5e86|\u5929\u6d25|\u897f\u5b89|\u957f\u6c99|\u90d1\u5dde|\u9752\u5c9b|\u5408\u80a5|\u798f\u5dde|\u4e1c\u839e|\u4f5b\u5c71|\u65e0\u9521|\u5b81\u6ce2|\u4e2d\u5c71|\u73e0\u6d77)$/;
  const LOCATION_WITH_SEPARATOR_RE = /(?:\u5317\u4eac|\u4e0a\u6d77|\u5e7f\u5dde|\u6df1\u5733|\u676d\u5dde|\u6210\u90fd|\u53a6\u95e8|\u6b66\u6c49|\u5357\u4eac|\u82cf\u5dde|\u91cd\u5e86|\u5929\u6d25|\u897f\u5b89|\u957f\u6c99|\u90d1\u5dde|\u9752\u5c9b|\u5408\u80a5|\u798f\u5dde|\u4e1c\u839e|\u4f5b\u5c71|\u65e0\u9521|\u5b81\u6ce2|\u4e2d\u5c71|\u73e0\u6d77)[\u00b7\s-]/;

  function compact(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isLocationLine(value) {
    const text = compact(value);
    return CITY_ONLY_RE.test(text) || LOCATION_WITH_SEPARATOR_RE.test(text);
  }

  function normalizeLines(value) {
    return String(value || "")
      .split(/\n+|\r+|\s{2,}/)
      .map(compact)
      .filter(Boolean);
  }

  function isLikelyCompany(value, jobName = "") {
    const text = compact(value);
    if (!text) return false;
    if (jobName && (text === jobName || jobName.includes(text) || text.includes(jobName))) return false;
    if (EXPERIENCE_RE.test(text)) return false;
    if (SAFE_SALARY_RE.test(text)) return false;
    if (SALARY_FRAGMENT_RE.test(text)) return false;
    if (BAD_TOKEN_RE.test(text)) return false;
    if (isLocationLine(text)) return false;
    if (!CHINESE_RE.test(text)) return false;
    if (TIME_META_RE.test(text)) return false;
    if (SAFE_META_RE.test(text) && text.length <= 8) return false;
    if (/立即沟通|收藏|地图|清空|搜索/.test(text)) return false;
    if (text.length < 2 || text.length > 32) return false;
    return true;
  }

  function pickCompanyFromLines(lines, jobName = "") {
    const normalized = (lines || []).map(compact).filter(Boolean);

    for (let index = 0; index < normalized.length; index += 1) {
      if (!isLocationLine(normalized[index])) continue;
      for (let back = index - 1; back >= Math.max(0, index - 4); back -= 1) {
        const candidate = normalized[back];
        if (isLikelyCompany(candidate, jobName)) return candidate;
      }
    }

    const strong = normalized.find((line) => COMPANY_SUFFIX_RE.test(line) && isLikelyCompany(line, jobName));
    if (strong) return strong;

    return normalized.find((line) => isLikelyCompany(line, jobName)) || "";
  }

  function bossAutoOptionsFromUrl(url) {
    const parsed = new URL(url, "https://www.zhipin.com/");
    const auto = parsed.searchParams.get("boss_auto") === "1";
    if (!auto) return { auto: false };

    const query = compact(parsed.searchParams.get("query") || parsed.searchParams.get("wd") || "");
    const slug = parsed.pathname.split("/").filter(Boolean)[0] || "";
    const city = parsed.searchParams.get("city") || CITY_CODE_BY_SLUG[slug] || "";
    return {
      auto: true,
      autoRiskbird: true,
      query,
      city,
    };
  }

  function buildSearchUrlFromAutoOptions(currentUrl, options) {
    const parsed = new URL(currentUrl, "https://www.zhipin.com/");
    const query = compact(options?.query || parsed.searchParams.get("query") || "");
    const city = compact(options?.city || parsed.searchParams.get("city") || "");
    const target = new URL("/web/geek/jobs", parsed.origin);
    if (query) target.searchParams.set("query", query);
    if (city) target.searchParams.set("city", city);
    target.searchParams.set("boss_auto", "1");
    return target.toString();
  }

  function shouldNavigateForAuto(currentUrl, options) {
    if (!options?.auto) return false;
    const parsed = new URL(currentUrl, "https://www.zhipin.com/");
    if (!parsed.pathname.startsWith("/web/geek/jobs")) return true;
    if (options.query && parsed.searchParams.get("query") !== options.query) return true;
    if (options.city && parsed.searchParams.get("city") !== options.city) return true;
    return false;
  }

  function shouldContinueCollecting(context = {}) {
    const scrolls = Number(context.scrolls || 0);
    const maxScrolls = Number(context.maxScrolls || 0);
    const stableRounds = Number(context.stableRounds || 0);
    const minStableRounds = Number(context.minStableRounds || 0);
    if (context.stopRequested) return false;
    if (maxScrolls > 0 && scrolls >= maxScrolls) return false;
    if (context.atBottom && stableRounds >= minStableRounds) return false;
    return true;
  }

  root.BossCollectorRules = {
    bossAutoOptionsFromUrl,
    buildSearchUrlFromAutoOptions,
    compact,
    isLikelyCompany,
    normalizeLines,
    pickCompanyFromLines,
    shouldContinueCollecting,
    shouldNavigateForAuto,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
