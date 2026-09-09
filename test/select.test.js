import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { select, parseCategory, findExclusion, tenderUrlFor } from '../src/select.js';

const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url), 'utf8'));

let seq = 0;
const rec = ({ type = '公開招標公告', title, category = '勞務類871-廣告服務', filename, job_number = 'JOB1', unit_id = '3.5.48' } = {}) => ({
  date: 20260908,
  filename: filename ?? `TIQ-${++seq}-70000000`,
  job_number,
  unit_id,
  unit_name: '測試機關',
  brief: { type, title, category },
});

describe('parseCategory', () => {
  it('讀得懂 list 的破折號格式', () => {
    expect(parseCategory('勞務類871-廣告服務')).toEqual({ nature: '勞務類', code: '871', name: '廣告服務' });
  });
  it('讀得懂決標公告 detail 的角括號格式', () => {
    expect(parseCategory('<工程類>5139其他土木工程')).toEqual({ nature: '工程類', code: '5139', name: '其他土木工程' });
  });
  it('96 大類沒有子層級，code 就是 96', () => {
    expect(parseCategory('勞務類96-娛樂,文化,體育服務').code).toBe('96');
  });
  it('null 分類不會炸（參考資料公告就是 null）', () => {
    expect(parseCategory(null)).toBeNull();
  });
});

describe('公告類型白名單', () => {
  it('收 10 種招標類', () => {
    const records = rules.announcementTypes.map((type) => rec({ type, title: '廣告服務案' }));
    expect(select(records, rules).selected).toHaveLength(10);
  });
  it('決標／無法決標／定期彙送一律不收', () => {
    const records = ['決標公告', '無法決標公告', '定期彙送', '財物變賣公告', '拒絕往來廠商名單公告']
      .map((type) => rec({ type, title: '廣告服務案' }));
    expect(select(records, rules).selected).toHaveLength(0);
  });
});

describe('路 A：標的分類', () => {
  it.each(['871', '875', '879', '96'])('命中 %s 大類，即使標題毫無關鍵字', (code) => {
    const r = rec({ title: '無關字眼的案子', category: `勞務類${code}-某某服務` });
    const { selected } = select([r], rules);
    expect(selected).toHaveLength(1);
    expect(selected[0].matchedPaths).toEqual(['A']);
    expect(selected[0].categoryCode).toBe(code);
  });
  it('工程類 871 不算命中（限勞務類）', () => {
    expect(select([rec({ title: '無關字眼的案子', category: '工程類871-廣告服務' })], rules).selected).toHaveLength(0);
  });
  it('勞務類但非指定大類，也非關鍵字，不收', () => {
    expect(select([rec({ title: '無關字眼的案子', category: '勞務類5139-其他' })], rules).selected).toHaveLength(0);
  });
});

describe('路 B：關鍵字', () => {
  it('標題含關鍵字即命中，記錄組別', () => {
    const r = rec({ title: '客家音樂節數位廣告投放', category: '勞務類5139-其他' });
    const { selected } = select([r], rules);
    expect(selected[0].matchedPaths).toEqual(['B']);
    expect(selected[0].matchedGroups).toEqual(['A', 'B', 'C']); // 廣告 / 數位 / 音樂節
  });
  it('分類為 null 的公告仍走關鍵字（否則整類參考資料公告漏報）', () => {
    const r = rec({ type: '公開徵求廠商提供參考資料公告', title: '媒體宣傳案', category: null });
    const { selected } = select([r], rules);
    expect(selected).toHaveLength(1);
    expect(selected[0].categoryCode).toBeNull();
  });
  it('工程類標題含「媒體」不收（限勞務類）', () => {
    expect(select([rec({ title: '電子媒體機房修繕', category: '工程類5139-其他' })], rules).selected).toHaveLength(0);
  });
});

describe('排除清單', () => {
  it('擋掉學校校外教學這類雜訊', () => {
    const { selected, excluded } = select([rec({ title: '本校校外教學活動遊覽車租賃' })], rules);
    expect(selected).toHaveLength(0);
    expect(excluded[0].exclusionTerm).toBe('校外教學');
  });

  it('會誤殺真正想要的案子 —— 這正是「已排除」分頁存在的理由', () => {
    const r = rec({ title: '台中市OO活動中心啟用晚會宣傳影片製作' });
    const { selected, excluded } = select([r], rules);
    expect(selected).toHaveLength(0);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].exclusionTerm).toBe('活動中心');
    // 被擋下時仍保留它原本會命中的組別，客戶抽查時看得出這筆有多可惜
    expect(excluded[0].matchedGroups).toEqual(expect.arrayContaining(['A', 'C']));
  });

  it('排除的案子不會消失，一定進 excluded', () => {
    const records = rules.titleExclusions.map((term) => rec({ title: `${term}廣告案` }));
    const { selected, excluded } = select(records, rules);
    expect(selected).toHaveLength(0);
    expect(excluded).toHaveLength(rules.titleExclusions.length);
  });
});

describe('去重與更正公告', () => {
  it('用 filename 去重，同一筆公告重複出現只留一次', () => {
    const r = rec({ title: '廣告服務案', filename: 'TIQ-1-71107895' });
    expect(select([r, { ...r }], rules).selected).toHaveLength(1);
  });

  it('原公告與更正公告共用 unit_id+job_number，但兩者都必須留下', () => {
    const original = rec({ filename: 'TIQ-11-71107895', job_number: 'BTRC11503042E', unit_id: '2.1', title: '媒體宣傳案' });
    const correction = rec({ filename: 'TIQ-12-71107895', job_number: 'BTRC11503042E', unit_id: '2.1', title: '媒體宣傳案', type: '公開招標更正公告' });
    const { selected } = select([original, correction], rules);
    expect(selected).toHaveLength(2);
    expect(selected.map((t) => t.isCorrection)).toEqual([false, true]);
  });
});

describe('官網連結', () => {
  it('由 date + filename 直接組出，不需細查', () => {
    const r = rec({ title: '廣告案', filename: 'TIQ-1-71098844' });
    expect(tenderUrlFor(r, rules)).toBe(
      'https://web.pcc.gov.tw/prkms/tender/common/noticeDate/redirectPublic?ds=20260908&fn=TIQ-1-71098844.xml',
    );
  });
});
