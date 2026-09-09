/**
 * 唯一的測試接縫（seam）。
 *
 * 所有外部世界都從參數注入：資料源、時鐘、規則。測試時餵錄好的
 * fixture 與固定時間，斷言回傳的 workbook 與統計；中間的過濾、
 * 去重、細查、組表都是純函式，不各自開測試入口。
 */
import { select } from './select.js';
import { enrich } from './enrich.js';
import { buildWorkbook } from './workbook.js';

/**
 * @param {object} deps
 * @param {import('./contracts.js').PccClient} deps.pcc
 * @param {object} deps.rules            config/rules.json
 * @param {string} [deps.date]           西元 YYYYMMDD；省略則用 clock
 * @param {()=>Date} [deps.clock]
 * @param {(msg:string)=>void} [deps.log]
 */
export async function runDailyReport({ pcc, rules, date, clock = () => new Date(), log = () => {} }) {
  const targetDate = date ?? formatDate(clock());

  const records = await pcc.listByDate(targetDate);
  log(`${targetDate}：取得 ${records.length} 筆公告`);

  const { selected, excluded } = select(records, rules);
  log(`命中 ${selected.length} 筆，排除 ${excluded.length} 筆`);

  // 細查只打在已收斂的十幾筆上 —— 全天 N+1 會撞 rate limit。
  // 任何一筆細查失敗都讓它拋出：寧可整份報表不出，也不出一份看起來完整
  // 但少了預算與截止日的表（fail-loud，規格第六節）。
  const enriched = [];
  for (const tender of selected) {
    const { unit_id, job_number } = tender.record;
    const detailRecords = await pcc.tenderDetail(unit_id, job_number);
    enriched.push(enrich(tender, detailRecords));
  }
  log(`細查完成 ${enriched.length} 筆`);

  const workbook = buildWorkbook({ enriched, excluded, date: targetDate, rules });

  return {
    date: targetDate,
    workbook,
    stats: {
      fetched: records.length,
      selected: selected.length,
      excluded: excluded.length,
      corrections: selected.filter((t) => t.isCorrection).length,
      budgetUndisclosed: enriched.filter((e) => !e.budgetPublic).length,
    },
    enriched,
    excluded,
    // 規格：當日無符合標案時仍寄空清單通知
    isEmpty: enriched.length === 0,
  };
}

export function formatDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}
