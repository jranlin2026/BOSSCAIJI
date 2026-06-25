(function attachRiskbirdRules(root) {
  const MOBILE_RE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
  const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const COMPANY_PHONE_RE = /(?<!\d)(?:400-?\d{3}-?\d{4}|0\d{2,3}[- ]?\d{7,8})(?!\d)/g;
  const URL_RE = /https?:\/\/[^\s"'<>\uFF0C\u3002\uFF1B\u3001)\uFF09]+/gi;

  const OUTPUT_COLUMNS = [
    { key: "companyName", label: "\u516c\u53f8\u540d" },
    { key: "jobName", label: "\u5c97\u4f4d\u540d" },
    { key: "jobUrl", label: "BOSS\u5c97\u4f4d\u94fe\u63a5" },
    { key: "pageUrl", label: "BOSS\u641c\u7d22\u9875" },
    { key: "evidence", label: "BOSS\u62db\u8058\u8bc1\u636e" },
    { key: "collectedAt", label: "BOSS\u91c7\u96c6\u65f6\u95f4" },
    { key: "riskbirdMatchedCompanyName", label: "\u98ce\u9e1f\u5339\u914d\u516c\u53f8\u540d" },
    { key: "riskbirdCompanyPhones", label: "\u98ce\u9e1f\u4f01\u4e1a\u516c\u5f00\u7535\u8bdd" },
    { key: "riskbirdEmails", label: "\u98ce\u9e1f\u4f01\u4e1a\u90ae\u7bb1" },
    { key: "riskbirdWebsite", label: "\u98ce\u9e1f\u5b98\u7f51" },
    { key: "riskbirdHasPublicMobile", label: "\u662f\u5426\u53d1\u73b0\u516c\u5f00\u624b\u673a\u53f7" },
    { key: "riskbirdMobileNumbers", label: "\u98ce\u9e1f\u516c\u5f00\u624b\u673a\u53f7" },
    { key: "riskbirdSourceUrl", label: "\u98ce\u9e1f\u6765\u6e90\u94fe\u63a5" },
    { key: "riskbirdStatus", label: "\u98ce\u9e1f\u5339\u914d\u72b6\u6001" },
    { key: "riskbirdNote", label: "\u98ce\u9e1f\u5907\u6ce8" },
    { key: "note", label: "\u5907\u6ce8" },
  ];
  const OUTPUT_HEADERS = OUTPUT_COLUMNS.map((column) => column.key);

  function parseCsv(csv) {
    const input = String(csv || "").replace(/^\uFEFF/, "");
    const rows = [];
    let row = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < input.length; i += 1) {
      const char = input[i];
      const next = input[i + 1];

      if (char === '"' && inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        row.push(value);
        value = "";
      } else if ((char === "\n" || char === "\r") && !inQuotes) {
        if (char === "\r" && next === "\n") i += 1;
        row.push(value);
        if (row.some((cell) => cell !== "")) rows.push(row);
        row = [];
        value = "";
      } else {
        value += char;
      }
    }

    row.push(value);
    if (row.some((cell) => cell !== "")) rows.push(row);
    if (!rows.length) return [];

    const headers = rows[0].map((header) => header.trim());
    return normalizeRows(rows.slice(1).map((cells) => {
      const record = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] || "";
      });
      return record;
    }));
  }

  function normalizeRows(rows) {
    return (rows || []).map((row) => normalizeBossRow(row));
  }

  function normalizeBossRow(row) {
    const normalized = { ...row };
    const aliases = {
      companyName: ["companyName", "\u516c\u53f8\u540d", "\u516c\u53f8\u540d\u79f0", "\u4f01\u4e1a\u540d\u79f0"],
      jobName: ["jobName", "\u5c97\u4f4d\u540d", "\u804c\u4f4d", "BOSS\u5c97\u4f4d"],
      jobUrl: ["jobUrl", "\u5c97\u4f4d\u94fe\u63a5", "BOSS\u5c97\u4f4d\u94fe\u63a5"],
      pageUrl: ["pageUrl", "BOSS\u641c\u7d22\u9875", "\u641c\u7d22\u9875"],
      evidence: ["evidence", "BOSS\u62db\u8058\u8bc1\u636e", "\u62db\u8058\u8bc1\u636e"],
      collectedAt: ["collectedAt", "BOSS\u91c7\u96c6\u65f6\u95f4", "\u91c7\u96c6\u65f6\u95f4"],
    };

    Object.entries(aliases).forEach(([key, names]) => {
      const value = names.map((name) => row[name]).find(Boolean);
      if (value) normalized[key] = value;
    });

    return normalized;
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function extractMobileNumbers(text) {
    return unique(String(text || "").match(MOBILE_RE) || []);
  }

  function maskMobileNumbers(text) {
    return extractMobileNumbers(text);
  }

  function redactMobileNumbers(text) {
    return String(text || "");
  }

  function normalizePhone(value) {
    return value.replace(/\s+/g, "-").replace(/--+/g, "-");
  }

  function extractWebsite(text) {
    const urls = String(text || "").match(URL_RE) || [];
    return urls.find((url) => !/riskbird\.com|zhipin\.com|bosszhipin\.com/i.test(url)) || "";
  }

  function extractContacts(text) {
    const rawText = String(text || "");
    const withoutMobiles = rawText.replace(MOBILE_RE, " ");
    const emails = unique(rawText.match(EMAIL_RE) || []);
    const companyPhones = unique((withoutMobiles.match(COMPANY_PHONE_RE) || []).map(normalizePhone));
    const mobileNumbers = extractMobileNumbers(rawText);

    return {
      emails,
      companyPhones,
      website: extractWebsite(rawText),
      hasPublicMobile: mobileNumbers.length > 0,
      mobileNumbers,
      mobileMasked: mobileNumbers,
      redactedText: rawText,
    };
  }

  function normalizeCompanyName(value) {
    return String(value || "")
      .replace(/\.html?$/i, "")
      .replace(/[\uFF08\uFF09()\u3010\u3011[\]\s]/g, "")
      .replace(/\u6709\u9650\u8D23\u4EFB\u516C\u53F8$/g, "")
      .replace(/(?:\u80A1\u4EFD)?\u6709\u9650\u516C\u53F8$/g, "")
      .toLowerCase();
  }

  function scoreCompanyMatch(label, target) {
    const value = normalizeCompanyName(label);
    const expected = normalizeCompanyName(target);
    if (!value || !expected) return 0;
    if (value === expected) return 100;
    if (value.includes(expected) || expected.includes(value)) return 80;

    let score = 0;
    for (const char of expected) {
      if (value.includes(char)) score += 1;
    }
    return score >= Math.min(6, expected.length) ? score : 0;
  }

  function mergeResult(bossRow, riskbirdResult) {
    const result = riskbirdResult || {};
    const mobileNumbers = result.mobileNumbers || result.mobileMasked || [];
    return {
      ...normalizeBossRow(bossRow || {}),
      riskbirdMatchedCompanyName: result.matchedCompanyName || "",
      riskbirdCompanyPhones: (result.companyPhones || []).join("; "),
      riskbirdEmails: (result.emails || []).join("; "),
      riskbirdWebsite: result.website || "",
      riskbirdHasPublicMobile: result.hasPublicMobile ? "\u662f" : "\u5426",
      riskbirdMobileNumbers: mobileNumbers.join("; "),
      riskbirdSourceUrl: result.sourceUrl || "",
      riskbirdStatus: result.status || "",
      riskbirdNote: result.note || "",
    };
  }

  function mergeStoppedResults(bossRows, completedRows) {
    const normalizedRows = normalizeRows(bossRows || []);
    const completed = completedRows || [];
    return normalizedRows.map((row, index) => completed[index] || mergeResult(row, {
      status: "stopped_unprocessed",
      note: "Stopped before RiskBird enrichment",
    }));
  }

  function splitMobileNumbers(value) {
    return unique(String(value || "")
      .split(/[;\uFF1B\u3001\s]+/)
      .map((item) => item.trim())
      .filter(Boolean));
  }

  function splitMaskedMobiles(value) {
    return splitMobileNumbers(value);
  }

  function cleanSharedMobileMasks(rows, minCompanyCount = 2) {
    const companyByMobile = new Map();

    (rows || []).forEach((row, index) => {
      const company = row.riskbirdMatchedCompanyName || row.companyName || `row-${index}`;
      splitMobileNumbers(row.riskbirdMobileNumbers || row.riskbirdMobileMasked).forEach((mobile) => {
        if (!companyByMobile.has(mobile)) companyByMobile.set(mobile, new Set());
        companyByMobile.get(mobile).add(company);
      });
    });

    const sharedMobiles = new Set(
      [...companyByMobile.entries()]
        .filter(([, companies]) => companies.size >= minCompanyCount)
        .map(([mobile]) => mobile)
    );

    return (rows || []).map((row) => {
      const kept = splitMobileNumbers(row.riskbirdMobileNumbers || row.riskbirdMobileMasked)
        .filter((mobile) => !sharedMobiles.has(mobile));
      return {
        ...row,
        riskbirdMobileNumbers: kept.join("; "),
        riskbirdHasPublicMobile: kept.length ? "\u662f" : "\u5426",
        riskbirdNote: sharedMobiles.size
          ? [row.riskbirdNote, `removed shared mobile numbers: ${[...sharedMobiles].join("; ")}`].filter(Boolean).join(" | ")
          : row.riskbirdNote,
      };
    });
  }

  function cleanSharedMobileNumbers(rows, minCompanyCount = 2) {
    return cleanSharedMobileMasks(rows, minCompanyCount);
  }

  function isActionLockActive(lock, context = {}) {
    if (!lock) return false;
    const now = context.now ?? Date.now();
    if (!lock.until || lock.until <= now) return false;
    if (lock.index !== context.currentIndex) return false;
    if (lock.companyName !== context.companyName) return false;

    const searchText = decodeURIComponent(context.locationSearch || "");
    if (lock.action === "search" && context.isSearchPage && searchText.includes(context.companyName)) return false;
    if (lock.action === "openDetail" && context.isDetailPage) return false;
    return true;
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function toCsv(rows) {
    return [
      OUTPUT_COLUMNS.map((column) => csvEscape(column.label)).join(","),
      ...rows.map((row) => OUTPUT_COLUMNS.map((column) => csvEscape(row[column.key] || "")).join(",")),
    ].join("\n");
  }

  root.RiskbirdRules = {
    OUTPUT_COLUMNS,
    OUTPUT_HEADERS,
    parseCsv,
    normalizeRows,
    normalizeBossRow,
    extractContacts,
    normalizeCompanyName,
    scoreCompanyMatch,
    extractMobileNumbers,
    maskMobileNumbers,
    redactMobileNumbers,
    mergeResult,
    mergeStoppedResults,
    splitMobileNumbers,
    splitMaskedMobiles,
    cleanSharedMobileMasks,
    cleanSharedMobileNumbers,
    isActionLockActive,
    toCsv,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
