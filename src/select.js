/**
 * 過濾核心：把一天份的原始公告收斂成客戶要看的標案。
 *
 * 順序刻意如此 —— 先用公告類型砍掉八成資料量，再判定命中，
 * 最後才套排除清單。排除放最後，是為了知道每一筆「差點入選」的案子
 * 是被哪一條擋下的（見 SelectResult.excluded）。
 */

/** `勞務類871-廣告服務` → { nature:"勞務類", code:"871", name:"廣告服務" } */
export function parseCategory(category) {
  if (!category) return null;
  // 招標類公告在 list 就是這個格式；決標類 detail 另有 `<勞務類>871廣告服務` 的寫法，一併吃下
  const dashed = /^(工程類|勞務類|財物類)(\d+)-(.*)$/.exec(category);
  if (dashed) return { nature: dashed[1], code: dashed[2], name: dashed[3] };
  const angled = /^<(工程類|勞務類|財物類)>(\d+)(.*)$/.exec(category);
  if (angled) return { nature: angled[1], code: angled[2], name: angled[3] };
  return null;
}

/** 官網原文連結，可直接由 list 的 date + filename 組出，不需細查 */
export function tenderUrlFor(record, rules) {
  const base = rules.source.tenderPageUrl;
  return `${base}?ds=${record.date}&fn=${encodeURIComponent(record.filename)}.xml`;
}

/** 標案名稱命中的關鍵字組 id 陣列，例如 ["A","C"] */
export function matchKeywordGroups(title, rules) {
  return rules.keywordGroups
    .filter((g) => g.keywords.some((k) => title.includes(k)))
    .map((g) => g.id);
}

/** 擋下這筆的第一條排除詞，沒被擋則回 null */
export function findExclusion(title, rules) {
  return rules.titleExclusions.find((term) => title.includes(term)) ?? null;
}

/**
 * @param {import('./contracts.js').ListRecord[]} records 一天份的原始公告
 * @returns {import('./contracts.js').SelectResult}
 */
export function select(records, rules) {
  const allowedTypes = new Set(rules.announcementTypes);
  const wantedCodes = new Set(rules.categories.map((c) => c.code));
  const selected = [];
  const excluded = [];
  const seen = new Set();

  for (const record of records) {
    const { type, title, category } = record.brief ?? {};
    if (!type || !title) continue;
    if (!allowedTypes.has(type)) continue;

    const parsed = parseCategory(category);
    const isService = parsed?.nature === rules.procurementNature;

    // 路 A：標的分類命中（限勞務類）
    const hitCategory = isService && wantedCodes.has(parsed.code);
    // 路 B：標案名稱含關鍵字（限勞務類）
    //   分類為 null 的公告（如「公開徵求廠商提供參考資料公告」，API 不提供 category）
    //   無從判定採購性質。規格明文要收這 10 種公告，若因此整類丟掉即是漏報，
    //   故此處放行，改由排除清單與人工過濾雜訊。
    const natureUnknown = parsed === null;
    const matchedGroups =
      isService || natureUnknown ? matchKeywordGroups(title, rules) : [];
    const hitKeyword = matchedGroups.length > 0;

    if (!hitCategory && !hitKeyword) continue;

    // 去重用 filename（公告唯一鍵）。規格寫的 unit_id + job_number 是「案件」鍵，
    // 原公告與更正公告共用同一組值，拿來去重會把更正公告整個吃掉。
    if (seen.has(record.filename)) continue;
    seen.add(record.filename);

    const tenderUrl = tenderUrlFor(record, rules);
    const exclusionTerm = findExclusion(title, rules);
    if (exclusionTerm) {
      excluded.push({ record, exclusionTerm, matchedGroups, tenderUrl });
      continue;
    }

    const matchedPaths = [];
    if (hitCategory) matchedPaths.push('A');
    if (hitKeyword) matchedPaths.push('B');

    selected.push({
      record,
      matchedPaths,
      matchedGroups,
      categoryCode: hitCategory ? parsed.code : null,
      isCorrection: type.includes('更正'),
      tenderUrl,
    });
  }

  return { selected, excluded };
}
