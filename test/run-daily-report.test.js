/**
 * Seam 測試：整條管線只從這一個入口進去。
 * 資料源是假的，時間是固定的，斷言打在產出的 workbook 與統計上。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { runDailyReport, formatDate } from '../src/run-daily-report.js';

const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url), 'utf8'));

let seq = 0;
const rec = ({ type = '公開招標公告', title, category = '勞務類871-廣告服務', filename, job_number = 'JOB1' } = {}) => ({
  date: 20260908,
  filename: filename ?? `TIQ-${++seq}-70000000`,
  job_number,
  unit_id: '3.5.48',
  unit_name: '測試機關',
  brief: { type, title, category },
});

/** 假資料源：list 給固定一天，detail 依 filename 回對應的公告史 */
const fakePcc = (records, details = {}) => ({
  calls: [],
  async listByDate(date) { this.calls.push(['list', date]); return records; },
  async tenderDetail(unitId, jobNumber) {
    this.calls.push(['detail', unitId, jobNumber]);
    return details[jobNumber] ?? [{ date: 20260908, detail: { '採購資料:預算金額': '500,000元', '領投開標:截止投標': '115/09/14 17:00' } }];
  },
});

describe('runDailyReport', () => {
  it('一天份資料進去，Excel 與統計出來', async () => {
    const pcc = fakePcc([
      rec({ title: '市政宣導廣告託播' }),
      rec({ title: '本校校外教學活動遊覽車租賃' }),
      rec({ type: '決標公告', title: '廣告服務案' }),
    ]);
    const r = await runDailyReport({ pcc, rules, date: '20260908' });

    expect(r.stats).toMatchObject({ fetched: 3, selected: 1, excluded: 1 });
    expect(r.isEmpty).toBe(false);
    // 單一分頁（照客戶範本），已排除是頁內的一個分區
    expect(r.workbook.worksheets.map((w) => w.name)).toEqual(['標案日報 20260908']);
    const banners = [];
    r.workbook.worksheets[0].eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === 'string' && v.startsWith('【已排除】')) banners.push(v);
    });
    expect(banners).toHaveLength(1);
  });

  it('細查只打在已收斂的結果上，不是整天 —— 全天 N+1 會撞 rate limit', async () => {
    const noise = Array.from({ length: 500 }, () => rec({ type: '決標公告', title: '無關案' }));
    const pcc = fakePcc([...noise, rec({ title: '媒體行銷案' })]);
    await runDailyReport({ pcc, rules, date: '20260908' });

    expect(pcc.calls.filter((c) => c[0] === 'detail')).toHaveLength(1);
  });

  it('無符合標案時仍產出空清單（send_when_empty）', async () => {
    const r = await runDailyReport({ pcc: fakePcc([]), rules, date: '20260908' });
    expect(r.isEmpty).toBe(true);
    expect(r.workbook.worksheets.length).toBeGreaterThan(0);
  });

  it('更正公告與原公告都留下，並各自取到自己那筆的細節', async () => {
    const details = { BTRC1: [
      { filename: 'TIQ-11-71107895', date: 20260907, detail: { '領投開標:截止投標': '115/09/20 17:00' } },
      { filename: 'TIQ-12-71107895', date: 20260908, detail: { '領投開標:截止投標': '115/09/30 17:00' } },
    ] };
    const pcc = fakePcc([
      rec({ filename: 'TIQ-11-71107895', job_number: 'BTRC1', title: '媒體宣傳案' }),
      rec({ filename: 'TIQ-12-71107895', job_number: 'BTRC1', title: '媒體宣傳案', type: '公開招標更正公告' }),
    ], details);
    const r = await runDailyReport({ pcc, rules, date: '20260908' });

    expect(r.stats.selected).toBe(2);
    expect(r.stats.corrections).toBe(1);
    // 更正把截止日延到 09/30，那筆必須拿到延後後的日期
    expect(r.enriched.map((e) => e.deadline)).toEqual(['115/09/20 17:00', '115/09/30 17:00']);
  });

  it('預算未公開的筆數如實計入統計，不被當成 0', async () => {
    const details = { J: [{ date: 20260908, detail: { '採購資料:預算金額': null, '採購資料:預算金額是否公開': '否\n預算金額涉及商業機密' } }] };
    const pcc = fakePcc([rec({ title: '廣告案', job_number: 'J' })], details);
    const r = await runDailyReport({ pcc, rules, date: '20260908' });

    expect(r.stats.budgetUndisclosed).toBe(1);
    expect(r.enriched[0].budgetAmount).toBeNull();
  });

  it('細查失敗就整份失敗，不出一份少了欄位卻看似完整的表（fail-loud）', async () => {
    const pcc = fakePcc([rec({ title: '廣告案' })]);
    pcc.tenderDetail = async () => { throw new Error('429 Too Many Requests'); };
    await expect(runDailyReport({ pcc, rules, date: '20260908' })).rejects.toThrow('429');
  });

  it('沒給日期就用注入的時鐘', async () => {
    const pcc = fakePcc([]);
    await runDailyReport({ pcc, rules, clock: () => new Date(2026, 8, 8) });
    expect(pcc.calls[0]).toEqual(['list', '20260908']);
  });
});

describe('formatDate', () => {
  it('補零成西元 YYYYMMDD', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('20260105');
  });
});
