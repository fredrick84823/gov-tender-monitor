/**
 * 補上 list 沒有、必須逐案細查的欄位：預算、截止投標、公告日、招標方式。
 *
 * detail 的 key 是 `區塊:欄位` 形式，而區塊前綴隨公告類型而異
 * （招標類是 `採購資料:`，決標類是 `已公告資料:`，無法決標是 `無法決標公告:`）。
 * 因此一律以「欄位名」尾段比對，不綁死前綴。
 */

/** 取出任一區塊底下叫這個名字的欄位 */
export function field(detail, name) {
  if (!detail) return null;
  const key = Object.keys(detail).find((k) => k.endsWith(`:${name}`) || k === name);
  const value = key ? detail[key] : null;
  return value === '' ? null : value ?? null;
}

/**
 * /api/tender 回傳整個案子的公告史，沒有「目前這筆」的標記。
 * 優先取 filename 相符的那筆，否則取日期最新的。
 */
export function pickAnnouncement(records, filename) {
  if (!records?.length) return null;
  const exact = records.find((r) => r.filename === filename);
  if (exact) return exact;
  return [...records].sort((a, b) => (b.date ?? 0) - (a.date ?? 0))[0];
}

/** "1,000,000元" → 1000000；無法解析回 null（絕不補 0） */
export function parseBudget(raw) {
  if (raw == null) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  return digits ? Number(digits) : null;
}

/**
 * 預算是否公開。API 回的是多行字串，如 "否\n預算金額涉及商業機密"，
 * 不能用 === "否" 比對。
 */
export function isBudgetPublic(raw) {
  if (raw == null) return true;
  return !String(raw).trimStart().startsWith('否');
}

/**
 * @param {import('./contracts.js').Classified} tender
 * @param {object[]} detailRecords /api/tender 的 records
 * @returns {import('./contracts.js').Enriched}
 */
export function enrich(tender, detailRecords) {
  const chosen = pickAnnouncement(detailRecords, tender.record.filename);
  const detail = chosen?.detail ?? null;
  const publicFlag = field(detail, '預算金額是否公開');
  const budgetRaw = field(detail, '預算金額');
  const budgetPublic = isBudgetPublic(publicFlag);

  return {
    tender,
    budget: budgetPublic ? budgetRaw : null,
    budgetAmount: budgetPublic ? parseBudget(budgetRaw) : null,
    budgetPublic,
    budgetBand: field(detail, '採購金額級距'),
    deadline: field(detail, '截止投標'),
    announcedOn: field(detail, '公告日'),
    tenderMethod: field(detail, '招標方式') ?? field(detail, '決標方式'),
    category: field(detail, '標的分類') ?? tender.record.brief?.category ?? null,
    // 範本的超連結用的是 pkPmsMain（只有招標類 detail 有）。
    // 拿不到時上層改用由 date + filename 組出的 redirectPublic 連結。
    pkPmsMain: chosen?.detail?.pkPmsMain ?? field(detail, 'pkPmsMain') ?? null,
  };
}
