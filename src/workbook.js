/**
 * Excel 產出 —— 版型完全對齊客戶提供的實際範本 gov_tenders_20260817.xlsx。
 *
 * 範本與 PRD 文字描述有數處出入，一律以範本為準（見 docs/spec-gaps.md）：
 *   - 單一分頁，不是「一大類一分頁」
 *   - 一列一筆，不是「兩列一筆」
 *   - 依「搜尋路徑」分區（大類搜尋 + A/B/C/D 組關鍵字），不是依標的分類分頁
 *   - 斑馬紋交替底色，沒有關鍵字色碼
 *   - 日期一律西元 ISO
 */
import ExcelJS from 'exceljs';
import { rocToIso, listDateToIso } from './dates.js';

// 品牌色，取自範本
const BRAND = 'FF873222';      // 標題列與分區橫幅
const HEADER = 'FF66272A';     // 表頭
const ZEBRA = 'FFF7F2F0';      // 斑馬列
const TEXT = 'FF333333';
const LINK = 'FF0563C1';
const MUTED = 'FF888888';
const CJK = { name: 'Microsoft JhengHei', family: 2, charset: 136 };
const NUM = { name: 'Arial', family: 2 };   // 範本的日期欄用 Arial

const COLUMNS = [
  { header: '公告日期', width: 23.25 },
  { header: '機關名稱', width: 50.125 },
  { header: '標案名稱', width: 60.125 },
  { header: '截止投標', width: 22 },
  { header: '預算金額', width: 14 },
  { header: '標的分類', width: 41.75 },
];

const UNDISCLOSED = '未公開';

/** 官網連結：範本用 pkPmsMain，拿不到時退回由 date + filename 組出的公開連結 */
function linkFor(e) {
  if (e.pkPmsMain) {
    return `https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pkPmsMain=${e.pkPmsMain}`;
  }
  return e.tender.tenderUrl;
}

function fillRow(row, argb) {
  if (!argb) return;
  row.eachCell({ includeEmpty: true }, (c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  });
}

function bandRow(ws, text, { size, height }) {
  const row = ws.addRow([text]);
  ws.mergeCells(`A${row.number}:F${row.number}`);
  row.height = height;
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true, size, color: { argb: 'FFFFFFFF' }, ...CJK };
    c.alignment = { vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
  });
  return row;
}

function headerRow(ws) {
  const row = ws.addRow(COLUMNS.map((c) => c.header));
  row.height = 19.95;
  row.eachCell({ includeEmpty: true }, (c) => {
    c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, ...CJK };
    c.alignment = { vertical: 'middle' };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER } };
  });
  return row;
}

/** 一列一筆 */
function tenderRow(ws, e, zebra) {
  const { tender } = e;
  const title = (tender.isCorrection ? '【更正】' : '') + tender.record.brief.title;
  const row = ws.addRow([
    listDateToIso(tender.record.date) ?? UNDISCLOSED,
    tender.record.unit_name ?? UNDISCLOSED,
    { text: title, hyperlink: linkFor(e) },
    rocToIso(e.deadline) ?? UNDISCLOSED,
    e.budgetPublic ? e.budget ?? UNDISCLOSED : UNDISCLOSED,   // 未公開絕不補 0
    e.category ?? UNDISCLOSED,
  ]);
  row.height = 28.8;
  row.eachCell({ includeEmpty: true }, (c, n) => {
    const isDate = n === 1 || n === 4;
    c.font = { size: 11, color: { argb: TEXT }, ...(isDate ? NUM : CJK) };
    c.alignment = { vertical: 'middle' };
    c.border = { bottom: { style: 'thin', color: { argb: 'FFE8E0DC' } } };
  });
  const link = row.getCell(3);
  link.font = { underline: true, size: 11, color: { argb: LINK }, ...CJK };
  link.alignment = { vertical: 'middle', wrapText: true };
  if (zebra) fillRow(row, ZEBRA);
  return row;
}

/** 一筆標案屬於哪些區段。命中多組就在每一區都出現一次（範本即如此）。 */
function sectionsFor(e, rules) {
  const ids = [];
  if (e.tender.matchedPaths.includes('A')) ids.push('CATEGORY');
  for (const g of e.tender.matchedGroups) ids.push(g);
  return ids;
}

function sectionTitle(id, rules, count) {
  if (id === 'CATEGORY') {
    const codes = rules.categories.map((c) => c.code).join('/');
    return `【大類搜尋】標的分類 ${codes} — ${count} 筆`;
  }
  const g = rules.keywordGroups.find((x) => x.id === id);
  return `【${id}組關鍵字】${g.keywords.join('/')} — ${count} 筆`;
}

/**
 * @param {{enriched:import('./contracts.js').Enriched[],excluded:import('./contracts.js').Excluded[],date:string,rules:object,generatedAt?:Date}} args
 * @returns {ExcelJS.Workbook}
 */
export function buildWorkbook({ enriched = [], excluded = [], date, rules, generatedAt = new Date() } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'gov-tender-monitor';
  const isoDate = listDateToIso(date) ?? String(date);
  const ws = wb.addWorksheet(`標案日報 ${date}`, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
  });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  // 標題：共 N 筆 是「去重後的標案數」，區段加總會大於它（一案可跨多區）
  bandRow(ws, `政府採購網標案日報 — ${isoDate}（共 ${enriched.length} 筆）`, { size: 14, height: 28.05 });

  const order = ['CATEGORY', ...rules.keywordGroups.map((g) => g.id)];
  const buckets = new Map(order.map((id) => [id, []]));
  for (const e of enriched) {
    for (const id of sectionsFor(e, rules)) buckets.get(id)?.push(e);
  }

  let first = true;
  for (const id of order) {
    const rows = buckets.get(id);
    if (!rows.length) continue;
    if (!first) ws.addRow([]);
    first = false;
    bandRow(ws, sectionTitle(id, rules, rows.length), { size: 12, height: 22.05 });
    headerRow(ws);
    rows.forEach((e, i) => tenderRow(ws, e, i % 2 === 1));
  }

  if (!enriched.length) {
    bandRow(ws, '本日無符合標案', { size: 12, height: 22.05 });
    const note = ws.addRow(['已完成當日查詢，無任何標案符合搜尋規則。']);
    ws.mergeCells(`A${note.number}:F${note.number}`);
    note.getCell(1).font = { italic: true, size: 11, color: { argb: MUTED }, ...CJK };
  }

  // 已排除區 —— 不在客戶範本裡，是本專案刻意加的漏報安全網。
  // 排除清單是純字串比對，「台中市OO活動中心啟用晚會宣傳影片製作」會被
  //「活動中心」擋掉。留在這裡，客戶抽查得到，誤殺才有機會被發現。
  if (excluded.length) {
    ws.addRow([]);
    bandRow(ws, `【已排除】被排除關鍵字擋下 — ${excluded.length} 筆（供抽查，確認沒有誤殺）`, { size: 12, height: 22.05 });
    const head = ws.addRow(['公告日期', '機關名稱', '標案名稱', '被哪一條擋下', '原本命中', '公告類型']);
    head.height = 19.95;
    head.eachCell({ includeEmpty: true }, (c) => {
      c.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, ...CJK };
      c.alignment = { vertical: 'middle' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER } };
    });

    const sorted = [...excluded].sort(
      (a, b) => a.exclusionTerm.localeCompare(b.exclusionTerm, 'zh-Hant') ||
        a.record.brief.title.localeCompare(b.record.brief.title, 'zh-Hant'),
    );
    sorted.forEach((x, i) => {
      const row = ws.addRow([
        listDateToIso(x.record.date) ?? UNDISCLOSED,
        x.record.unit_name ?? UNDISCLOSED,
        { text: x.record.brief.title, hyperlink: x.tenderUrl },
        x.exclusionTerm,
        x.matchedGroups.length ? x.matchedGroups.map((g) => `${g}組`).join('、') : '標的分類',
        x.record.brief.type,
      ]);
      row.height = 28.8;
      row.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = { size: 11, color: { argb: TEXT }, ...(n === 1 ? NUM : CJK) };
        c.alignment = { vertical: 'middle' };
        c.border = { bottom: { style: 'thin', color: { argb: 'FFE8E0DC' } } };
      });
      const link = row.getCell(3);
      link.font = { underline: true, size: 11, color: { argb: LINK }, ...CJK };
      link.alignment = { vertical: 'middle', wrapText: true };
      if (i % 2 === 1) fillRow(row, ZEBRA);
    });
  }

  ws.addRow([]);
  const footer = ws.addRow([
    `資料來源：政府電子採購網（每日公告）｜產出時間：${generatedAt.toISOString()}｜點擊標案名稱可開啟官網原文`,
  ]);
  ws.mergeCells(`A${footer.number}:F${footer.number}`);
  footer.eachCell({ includeEmpty: true }, (c) => {
    c.font = { size: 9, color: { argb: MUTED }, ...CJK };
  });

  return wb;
}

export default buildWorkbook;
