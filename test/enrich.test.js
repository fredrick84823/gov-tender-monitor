import { describe, it, expect } from 'vitest';
import { enrich, field, pickAnnouncement, parseBudget, isBudgetPublic } from '../src/enrich.js';

const tender = (filename = 'TIQ-1-70000000') => ({
  record: { filename, unit_id: '3.5.48', job_number: 'JOB1', unit_name: '機關', brief: { type: '公開招標公告', title: '案', category: '勞務類871-廣告服務' } },
  matchedPaths: ['A'], matchedGroups: [], categoryCode: '871', isCorrection: false, tenderUrl: 'http://x',
});

describe('field：區塊前綴隨公告類型而異，只比對欄位名', () => {
  it('吃得到招標類的 採購資料: 前綴', () => {
    expect(field({ '採購資料:標案名稱': 'A案' }, '標案名稱')).toBe('A案');
  });
  it('吃得到決標類的 已公告資料: 前綴', () => {
    expect(field({ '已公告資料:標案名稱': 'B案' }, '標案名稱')).toBe('B案');
  });
  it('欄位不存在回 null，不回 undefined 也不炸', () => {
    expect(field({}, '預算金額')).toBeNull();
    expect(field(null, '預算金額')).toBeNull();
  });
  it('空字串視同沒有', () => {
    expect(field({ '採購資料:預算金額': '' }, '預算金額')).toBeNull();
  });
});

describe('預算金額：絕不補 0', () => {
  it('"1,000,000元" 解析成數字', () => {
    expect(parseBudget('1,000,000元')).toBe(1000000);
  });
  it('null 就是 null，不是 0', () => {
    expect(parseBudget(null)).toBeNull();
  });
  it('無數字內容回 null，不是 0', () => {
    expect(parseBudget('未公開')).toBeNull();
  });
  it('「否\\n預算金額涉及商業機密」是多行字串，不能用 === "否" 比對', () => {
    expect(isBudgetPublic('否\n預算金額涉及商業機密')).toBe(false);
    expect(isBudgetPublic('是')).toBe(true);
    expect(isBudgetPublic(null)).toBe(true);
  });
  it('未公開時預算一律留空，不落入表格變成 0', () => {
    const e = enrich(tender(), [{ filename: 'TIQ-1-70000000', date: 20260908, detail: {
      '採購資料:預算金額': null,
      '採購資料:預算金額是否公開': '否\n預算金額涉及商業機密',
      '採購資料:採購金額級距': '公告金額以上未達查核金額',
    } }]);
    expect(e.budget).toBeNull();
    expect(e.budgetAmount).toBeNull();
    expect(e.budgetPublic).toBe(false);
    expect(e.budgetBand).toBe('公告金額以上未達查核金額'); // 粗略級距仍保留
  });
});

describe('pickAnnouncement：detail 回傳整個案子的公告史，沒有「目前這筆」標記', () => {
  const history = [
    { filename: 'TIQ-11-71107895', date: 20260907, detail: { '採購資料:預算金額': '100元' } },
    { filename: 'TIQ-12-71107895', date: 20260908, detail: { '採購資料:預算金額': '200元' } },
  ];
  it('優先取 filename 相符的那筆 —— 更正公告要拿到更正後的值', () => {
    expect(pickAnnouncement(history, 'TIQ-12-71107895').detail['採購資料:預算金額']).toBe('200元');
    expect(pickAnnouncement(history, 'TIQ-11-71107895').detail['採購資料:預算金額']).toBe('100元');
  });
  it('對不上就取日期最新的', () => {
    expect(pickAnnouncement(history, '不存在').date).toBe(20260908);
  });
  it('空歷史回 null', () => {
    expect(pickAnnouncement([], 'x')).toBeNull();
  });
});

describe('參考資料公告：detail 幾乎是空的', () => {
  it('三個欄位全為 null，但不會炸也不會假造數值', () => {
    const e = enrich(tender(), [{ filename: 'TIQ-1-70000000', date: 20260908, detail: { '標案內容:標案名稱': '徵求案' } }]);
    expect(e.budget).toBeNull();
    expect(e.deadline).toBeNull();
    expect(e.announcedOn).toBeNull();
  });
});
