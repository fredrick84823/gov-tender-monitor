/**
 * 版型斷言全部對照客戶提供的實際範本 gov_tenders_20260817.xlsx。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../src/workbook.js';

const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url), 'utf8'));

const enriched = ({ title, groups = [], paths = ['A'], correction = false, budget = '400,000元', budgetPublic = true, deadline = '115/08/21 17:00', category = '勞務類871-廣告服務', pkPmsMain = 'NzEzMDM0MjE' } = {}) => ({
  tender: {
    record: { date: 20260817, filename: 'TIQ-1-71098844', job_number: 'J1', unit_id: '3.5.48', unit_name: '財政部北區國稅局桃園分局', brief: { type: correction ? '公開招標更正公告' : '公開招標公告', title, category } },
    matchedPaths: paths, matchedGroups: groups, categoryCode: '871', isCorrection: correction,
    tenderUrl: 'https://web.pcc.gov.tw/prkms/tender/common/noticeDate/redirectPublic?ds=20260817&fn=TIQ-1-71098844.xml',
  },
  budget, budgetAmount: 400000, budgetPublic, budgetBand: null, deadline, announcedOn: null, tenderMethod: null, category, pkPmsMain,
});

const sheet = (wb) => wb.worksheets[0];
const textOf = (c) => (c.value && typeof c.value === 'object' ? c.value.text ?? c.value.richText?.map((t) => t.text).join('') : c.value);
const rowTexts = (ws, r) => ws.getRow(r).values.slice(1).map((v) => (v && typeof v === 'object' ? v.text : v));

describe('版型骨架', () => {
  const wb = buildWorkbook({ enriched: [enriched({ title: '宣導活動委外服務採購案' })], excluded: [], date: '20260817', rules });
  const ws = sheet(wb);

  it('單一分頁，命名為「標案日報 YYYYMMDD」', () => {
    expect(wb.worksheets).toHaveLength(1);
    expect(ws.name).toBe('標案日報 20260817');
  });
  it('隱藏格線', () => {
    expect(ws.views[0].showGridLines).toBe(false);
  });
  it('六欄，欄寬照範本', () => {
    expect(ws.columns.map((c) => c.width)).toEqual([23.25, 50.125, 60.125, 22, 14, 41.75]);
  });
  it('R1 標題含日期與去重後總筆數，白字 14pt 粗體襯品牌色', () => {
    expect(textOf(ws.getRow(1).getCell(1))).toBe('政府採購網標案日報 — 2026-08-17（共 1 筆）');
    const f = ws.getRow(1).getCell(1).font;
    expect(f).toMatchObject({ bold: true, size: 14, name: 'Microsoft JhengHei' });
    expect(ws.getRow(1).getCell(1).fill.fgColor.argb).toBe('FF873222');
  });
  it('表頭六個欄名與範本一致', () => {
    expect(rowTexts(ws, 3)).toEqual(['公告日期', '機關名稱', '標案名稱', '截止投標', '預算金額', '標的分類']);
    expect(ws.getRow(3).getCell(1).fill.fgColor.argb).toBe('FF66272A');
  });
  it('頁尾註明資料來源與產出時間', () => {
    const last = ws.getRow(ws.rowCount).getCell(1);
    expect(textOf(last)).toMatch(/^資料來源：政府電子採購網（每日公告）｜產出時間：.+｜點擊標案名稱可開啟官網原文$/);
    expect(last.font).toMatchObject({ size: 9, color: { argb: 'FF888888' } });
  });
});

describe('資料列', () => {
  const wb = buildWorkbook({ enriched: [enriched({ title: '宣導活動委外服務採購案' })], excluded: [], date: '20260817', rules });
  const ws = sheet(wb);

  it('一列一筆，六欄如範本', () => {
    expect(rowTexts(ws, 4)).toEqual(['2026-08-17', '財政部北區國稅局桃園分局', '宣導活動委外服務採購案', '2026-08-21 17:00', '400,000元', '勞務類871-廣告服務']);
  });
  it('民國轉西元：115/08/21 17:00 → 2026-08-21 17:00', () => {
    expect(rowTexts(ws, 4)[3]).toBe('2026-08-21 17:00');
  });
  it('標案名稱是超連結，用範本的 pkPmsMain 形式', () => {
    expect(ws.getRow(4).getCell(3).value.hyperlink).toBe('https://web.pcc.gov.tw/tps/QueryTender/query/searchTenderDetail?pkPmsMain=NzEzMDM0MjE');
    expect(ws.getRow(4).getCell(3).font).toMatchObject({ underline: true, color: { argb: 'FF0563C1' } });
  });
  it('沒有 pkPmsMain 時退回公開連結，不會留空', () => {
    const w = buildWorkbook({ enriched: [enriched({ title: '參考資料徵求案', pkPmsMain: null })], excluded: [], date: '20260817', rules });
    expect(sheet(w).getRow(4).getCell(3).value.hyperlink).toContain('redirectPublic?ds=20260817');
  });
  it('日期欄用 Arial，中文欄用微軟正黑體', () => {
    expect(ws.getRow(4).getCell(1).font.name).toBe('Arial');
    expect(ws.getRow(4).getCell(2).font.name).toBe('Microsoft JhengHei');
  });
  it('第二筆起交替斑馬底色', () => {
    const w = buildWorkbook({ enriched: [enriched({ title: 'A案' }), enriched({ title: 'B案' })], excluded: [], date: '20260817', rules });
    expect(sheet(w).getRow(4).getCell(1).fill?.fgColor).toBeUndefined();
    expect(sheet(w).getRow(5).getCell(1).fill.fgColor.argb).toBe('FFF7F2F0');
  });
});

describe('資料誠實', () => {
  it('預算未公開印「未公開」，不是 0 也不是空白', () => {
    const wb = buildWorkbook({ enriched: [enriched({ title: '案', budget: null, budgetPublic: false })], excluded: [], date: '20260817', rules });
    expect(rowTexts(sheet(wb), 4)[4]).toBe('未公開');
  });
  it('截止投標抓不到也印「未公開」', () => {
    const wb = buildWorkbook({ enriched: [enriched({ title: '案', deadline: null })], excluded: [], date: '20260817', rules });
    expect(rowTexts(sheet(wb), 4)[3]).toBe('未公開');
  });
  it('參考資料公告三欄皆空時仍成列，不假造數值', () => {
    const wb = buildWorkbook({ enriched: [enriched({ title: '徵求參考資料案', deadline: null, budget: null, budgetPublic: false, category: null, paths: [], groups: ['A'] })], excluded: [], date: '20260817', rules });
    expect(rowTexts(sheet(wb), 4).slice(3)).toEqual(['未公開', '未公開', '未公開']);
  });
});

describe('分區', () => {
  it('依搜尋路徑分區，橫幅列出該區的關鍵字與筆數', () => {
    const wb = buildWorkbook({
      enriched: [enriched({ title: '大類案', paths: ['A'], groups: [] }), enriched({ title: '數位社群案', paths: ['B'], groups: ['B'] })],
      excluded: [], date: '20260817', rules,
    });
    const banners = [];
    sheet(wb).eachRow((row) => { const v = textOf(row.getCell(1)); if (typeof v === 'string' && v.startsWith('【')) banners.push(v); });
    expect(banners[0]).toBe('【大類搜尋】標的分類 871/875/879/96 — 1 筆');
    expect(banners[1]).toBe('【B組關鍵字】數位/網路/社群/新媒體 — 1 筆');
  });

  it('一案命中多組就在每一區各出現一次（範本即如此），但總筆數只算一次', () => {
    const wb = buildWorkbook({ enriched: [enriched({ title: '客家音樂節數位廣告投放', paths: ['B'], groups: ['A', 'B', 'C'] })], excluded: [], date: '20260817', rules });
    const ws = sheet(wb);
    let appearances = 0;
    ws.eachRow((row) => { if (textOf(row.getCell(3)) === '客家音樂節數位廣告投放') appearances += 1; });
    expect(appearances).toBe(3);
    expect(textOf(ws.getRow(1).getCell(1))).toContain('共 1 筆');
  });

  it('空的區段不會留下空橫幅', () => {
    const wb = buildWorkbook({ enriched: [enriched({ title: '大類案', paths: ['A'], groups: [] })], excluded: [], date: '20260817', rules });
    const banners = [];
    sheet(wb).eachRow((row) => { const v = textOf(row.getCell(1)); if (typeof v === 'string' && v.startsWith('【')) banners.push(v); });
    expect(banners).toHaveLength(1);
  });
});

describe('更正公告', () => {
  it('標案名稱前綴【更正】，連結仍在', () => {
    const wb = buildWorkbook({ enriched: [enriched({ title: '媒體宣傳案', correction: true })], excluded: [], date: '20260817', rules });
    const cell = sheet(wb).getRow(4).getCell(3);
    expect(cell.value.text).toBe('【更正】媒體宣傳案');
    expect(cell.value.hyperlink).toBeTruthy();
  });
});

describe('已排除區（本專案加的漏報安全網，不在客戶範本內）', () => {
  const excluded = [
    { record: { date: 20260817, filename: 'F1', unit_name: '台中市政府', brief: { type: '公開招標公告', title: '台中市OO活動中心啟用晚會宣傳影片製作' } }, exclusionTerm: '活動中心', matchedGroups: ['A', 'C'], tenderUrl: 'http://x/1' },
    { record: { date: 20260817, filename: 'F2', unit_name: '某國小', brief: { type: '公開招標公告', title: '校外教學活動遊覽車租賃' } }, exclusionTerm: '校外教學', matchedGroups: ['C'], tenderUrl: 'http://x/2' },
    { record: { date: 20260817, filename: 'F3', unit_name: '某鄉公所', brief: { type: '公開招標公告', title: '安康活動中心週年慶演唱會' } }, exclusionTerm: '活動中心', matchedGroups: ['C'], tenderUrl: 'http://x/3' },
  ];
  const wb = buildWorkbook({ enriched: [enriched({ title: '正常案' })], excluded, date: '20260817', rules });
  const ws = sheet(wb);
  const find = (t) => { let n = 0; ws.eachRow((row) => { if (textOf(row.getCell(3)) === t) n = row.number; }); return n; };

  it('有標題橫幅說明用途', () => {
    let banner = '';
    ws.eachRow((row) => { const v = textOf(row.getCell(1)); if (typeof v === 'string' && v.startsWith('【已排除】')) banner = v; });
    expect(banner).toBe('【已排除】被排除關鍵字擋下 — 3 筆（供抽查，確認沒有誤殺）');
  });
  it('每筆標明被哪一條擋下、原本會命中哪幾組', () => {
    const r = find('台中市OO活動中心啟用晚會宣傳影片製作');
    expect(rowTexts(ws, r)).toEqual(['2026-08-17', '台中市政府', '台中市OO活動中心啟用晚會宣傳影片製作', '活動中心', 'A組、C組', '公開招標公告']);
  });
  it('依排除詞分組排序，同一條詞的受害者排在一起', () => {
    const a = find('台中市OO活動中心啟用晚會宣傳影片製作');
    const b = find('安康活動中心週年慶演唱會');
    const other = find('校外教學活動遊覽車租賃');
    expect(Math.abs(a - b)).toBe(1);                       // 兩筆「活動中心」相鄰
    expect(Math.max(a, b)).toBeLessThan(other);            // 另一條排除詞的自成一群
  });
  it('標案名稱仍可點回官網，客戶抽查才查得下去', () => {
    expect(ws.getRow(find('校外教學活動遊覽車租賃')).getCell(3).value.hyperlink).toBe('http://x/2');
  });
});

describe('空的一天', () => {
  it('仍產出可讀的檔案並註明無符合標案（send_when_empty）', () => {
    const wb = buildWorkbook({ enriched: [], excluded: [], date: '20260817', rules });
    const ws = sheet(wb);
    expect(textOf(ws.getRow(1).getCell(1))).toContain('共 0 筆');
    expect(textOf(ws.getRow(2).getCell(1))).toBe('本日無符合標案');
  });
});

describe('真實檔案往返', () => {
  it('寫成 .xlsx 再讀回來，值、連結、底色、字型都還在', async () => {
    const path = join(tmpdir(), `gov-${Date.now()}.xlsx`);
    const wb = buildWorkbook({ enriched: [enriched({ title: '宣導案' }), enriched({ title: '第二案' })], excluded: [], date: '20260817', rules });
    await wb.xlsx.writeFile(path);

    const back = new ExcelJS.Workbook();
    await back.xlsx.readFile(path);
    const ws = back.worksheets[0];
    expect(ws.name).toBe('標案日報 20260817');
    expect(ws.getRow(4).getCell(3).value.hyperlink).toContain('pkPmsMain');
    expect(ws.getRow(5).getCell(1).fill.fgColor.argb).toBe('FFF7F2F0');
    expect(ws.getRow(4).getCell(2).font.name).toBe('Microsoft JhengHei');
  });
});
