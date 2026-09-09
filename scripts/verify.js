#!/usr/bin/env node
/**
 * 驗證這台機器產出的 Excel 與黃金檔一致。
 *
 * 「在我的機器上跑得起來」不算交付，「在你的機器上跑出同一份東西」才算。
 * 因此比對的是**內容**（筆數、分區、每一欄的值），不是檔案的位元組
 * ——xlsx 內含建置時間戳，逐位元組相同本來就不可能。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { runDailyReport } from '../src/run-daily-report.js';
import { createReplayClient } from './replay.js';

const DATE = '20260817';
const GOLDEN = new URL('../test/golden/20260817.json', import.meta.url);
const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url), 'utf8'));
const writing = process.argv.includes('--write');

/** 從 workbook 抽出可比對的內容快照 */
function snapshot(workbook) {
  const ws = workbook.worksheets[0];
  const sheet = ws.name;
  const rows = [];
  ws.eachRow((row) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (c) => {
      const v = c.value;
      if (v && typeof v === 'object') {
        cells.push(v.hyperlink ? { text: v.text, link: v.hyperlink } : (v.richText?.map((t) => t.text).join('') ?? null));
      } else {
        cells.push(v ?? null);
      }
    });
    rows.push(cells);
  });
  return { sheet, rows };
}

const result = await runDailyReport({ pcc: createReplayClient(), rules, date: DATE });
const actual = { stats: result.stats, ...snapshot(result.workbook) };

// 產出時間每次都不同，比對前先正規化掉
actual.rows = actual.rows.map((r) =>
  r.map((c) => (typeof c === 'string' ? c.replace(/產出時間：[^｜]+/, '產出時間：<正規化>') : c)),
);

if (writing) {
  writeFileSync(GOLDEN, JSON.stringify(actual, null, 2) + '\n');
  console.log(`已寫入黃金檔：test/golden/20260817.json（${actual.rows.length} 列）`);
  process.exit(0);
}

if (!existsSync(GOLDEN)) {
  console.error('找不到黃金檔。請先執行：npm run verify:update');
  process.exit(1);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

const problems = [];
for (const [k, v] of Object.entries(golden.stats)) {
  if (actual.stats[k] !== v) problems.push(`統計 ${k}：預期 ${v}，實得 ${actual.stats[k]}`);
}
if (actual.sheet !== golden.sheet) problems.push(`分頁名稱：預期 ${golden.sheet}，實得 ${actual.sheet}`);
if (actual.rows.length !== golden.rows.length) {
  problems.push(`列數：預期 ${golden.rows.length}，實得 ${actual.rows.length}`);
}
const n = Math.min(actual.rows.length, golden.rows.length);
for (let i = 0; i < n; i += 1) {
  const a = JSON.stringify(actual.rows[i]);
  const g = JSON.stringify(golden.rows[i]);
  if (a !== g) problems.push(`第 ${i + 1} 列不同\n      預期：${g.slice(0, 160)}\n      實得：${a.slice(0, 160)}`);
}

if (problems.length) {
  console.error(`\n✗ 與黃金檔不一致（${problems.length} 處）：\n`);
  problems.slice(0, 12).forEach((p) => console.error(`  • ${p}`));
  if (problems.length > 12) console.error(`  …另有 ${problems.length - 12} 處`);
  console.error('\n這代表這台機器的產出與基準不同。若是你刻意改了規則或版型，');
  console.error('執行 npm run verify:update 更新黃金檔；否則請回報這份輸出。\n');
  process.exit(1);
}

console.log(`\n✓ 產出與黃金檔完全一致`);
console.log(`  ${DATE}：${actual.stats.fetched} 筆公告 → 命中 ${actual.stats.selected}、排除 ${actual.stats.excluded}`);
console.log(`  分頁「${actual.sheet}」共 ${actual.rows.length} 列，逐欄比對通過\n`);
