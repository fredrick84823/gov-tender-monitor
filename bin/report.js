#!/usr/bin/env node
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPccClient } from '../src/pcc-client.js';
import { runDailyReport, formatDate } from '../src/run-daily-report.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const rules = JSON.parse(await readFile(resolve(root, 'config/rules.json'), 'utf8'));
const date = arg('date') ?? formatDate(new Date());
const out = arg('out') ?? resolve(root, `out/公標案查詢-${date}.xlsx`);

const pcc = createPccClient({
  baseUrl: rules.source.baseUrl,
  token: process.env.PCC_API_TOKEN,
});

const result = await runDailyReport({ pcc, rules, date, log: (m) => console.error(m) });

await mkdir(dirname(out), { recursive: true });
await result.workbook.xlsx.writeFile(out);

const { stats } = result;
console.error(
  `\n完成：${date}\n` +
    `  取得公告   ${stats.fetched}\n` +
    `  命中標案   ${stats.selected}（其中更正公告 ${stats.corrections}）\n` +
    `  已排除     ${stats.excluded}\n` +
    `  預算未公開 ${stats.budgetUndisclosed}\n` +
    `  輸出       ${out}`,
);
if (result.isEmpty) console.error('  ※ 本日無符合標案（仍產出空清單）');
