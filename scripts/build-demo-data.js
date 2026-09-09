#!/usr/bin/env node
/**
 * 產出課堂展示網頁用的資料包。
 *
 * 保留一整天的**全部**原始公告（僅精簡到過濾用得到的欄位），讓網頁能真的
 * 從 1787 筆跑到 35 筆；命中與排除的那些另外附上細查結果，才有預算與截止日。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPccClient } from '../src/pcc-client.js';
import { select } from '../src/select.js';
import { enrich } from '../src/enrich.js';

const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url), 'utf8'));
const dates = process.argv.slice(2);
if (!dates.length) {
  console.error('用法：node scripts/build-demo-data.js 20260817 [20260908 ...]');
  process.exit(1);
}

const pcc = createPccClient({ baseUrl: rules.source.baseUrl, token: process.env.PCC_API_TOKEN });
const out = { rules, days: {} };

for (const date of dates) {
  process.stderr.write(`${date}：抓取清單…\n`);
  const records = await pcc.listByDate(date);

  // 精簡到過濾用得到的欄位，其餘丟掉（1.3MB → 約 1/4）
  const slim = records.map((r) => ({
    date: r.date,
    filename: r.filename,
    job_number: r.job_number,
    unit_id: r.unit_id,
    unit_name: r.unit_name,
    brief: { type: r.brief?.type ?? null, title: r.brief?.title ?? null, category: r.brief?.category ?? null },
  }));

  // 細查：命中的與被排除的都要，網頁上調鬆規則時被排除的那些也要有完整欄位
  const { selected, excluded } = select(records, rules);
  const needDetail = [...selected.map((t) => t.record), ...excluded.map((x) => x.record)];
  process.stderr.write(`  命中 ${selected.length}、排除 ${excluded.length}，細查 ${needDetail.length} 筆…\n`);

  const details = {};
  for (const [i, r] of needDetail.entries()) {
    const history = await pcc.tenderDetail(r.unit_id, r.job_number);
    const tender = { record: r, matchedPaths: [], matchedGroups: [], categoryCode: null, isCorrection: false, tenderUrl: '' };
    const e = enrich(tender, history);
    details[r.filename] = {
      budget: e.budget, budgetPublic: e.budgetPublic, budgetBand: e.budgetBand,
      deadline: e.deadline, announcedOn: e.announcedOn, tenderMethod: e.tenderMethod,
      category: e.category, pkPmsMain: e.pkPmsMain,
    };
    if ((i + 1) % 10 === 0) process.stderr.write(`    ${i + 1}/${needDetail.length}\n`);
  }

  out.days[date] = { records: slim, details };
  process.stderr.write(`  完成：${slim.length} 筆原始公告、${Object.keys(details).length} 筆細查\n`);
}

mkdirSync(new URL('../web/data', import.meta.url), { recursive: true });
const path = new URL('../web/data/demo-data.json', import.meta.url);
writeFileSync(path, JSON.stringify(out));
const kb = (readFileSync(path).length / 1024).toFixed(0);
console.error(`\n寫入 web/data/demo-data.json（${kb} KB）`);
