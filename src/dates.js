/**
 * 民國 → 西元。範本的日期欄一律是西元 ISO（2026-08-17 / 2026-08-24 09:00），
 * API 給的卻是民國（115/09/14 17:00）。
 *
 * 轉不出來就回 null，讓上層印「未公開」—— 絕不猜、絕不補值（規格第六節）。
 */
export function rocToIso(value) {
  if (value == null) return null;
  const m = /^(\d{2,3})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/.exec(String(value).trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm] = m;
  const year = Number(y) + 1911;
  const date = `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return hh ? `${date} ${hh.padStart(2, '0')}:${mm}` : date;
}

/** 20260817 → 2026-08-17 */
export function listDateToIso(date) {
  const s = String(date);
  if (!/^\d{8}$/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
