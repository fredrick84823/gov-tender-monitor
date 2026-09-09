#!/usr/bin/env node
/**
 * 一次性 fixture 擷取腳本：打真的 openfun API，寫出測試用 fixture。
 *
 *   node scripts/capture-fixtures.js [YYYYMMDD]
 *
 * 產出：
 *   test/fixtures/listbydate-<date>.json      整天的原始清單（~2MB，刻意保留全量）
 *   test/fixtures/tender-detail-samples.json  少量真實 detail，key 為 "{unit_id}|{job_number}"
 *
 * 速率限制由 pcc-client 的 throttle 負責，這裡只要不亂開並行即可。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPccClient } from '../src/pcc-client.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'test', 'fixtures');

const DATE = process.argv[2] ?? '20260908';
const MAX_DETAIL_FETCHES = 60;

const client = createPccClient({
  token: process.env.PCC_TOKEN || null,
  minIntervalMs: Number(process.env.PCC_MIN_INTERVAL_MS ?? 1200),
});

/** 已抓過的 detail，避免重複打 API。 */
const cache = new Map();
let fetches = 0;

async function detailOf(record) {
  const key = `${record.unit_id}|${record.job_number}`;
  if (cache.has(key)) return cache.get(key);
  if (fetches >= MAX_DETAIL_FETCHES) throw new Error('detail fetch budget exhausted');
  fetches += 1;
  const records = await client.tenderDetail(record.unit_id, record.job_number);
  cache.set(key, records);
  return records;
}

const type = (r) => r?.brief?.type ?? '';
const category = (r) => r?.brief?.category ?? '';
const isTenderNotice = (r) => /招標公告|報價單或企劃書/.test(type(r));

/** 從 detail 歷程裡挑出「最像招標公告」的那一筆的 detail 物件。 */
function pickDetail(history) {
  const withKeys = history.filter((h) => h?.detail && Object.keys(h.detail).length);
  return (
    withKeys.find((h) => '採購資料:預算金額' in h.detail)?.detail ??
    withKeys.at(-1)?.detail ??
    {}
  );
}

/**
 * 依序試候選，找到第一個滿足 predicate 的，回傳 { label, record, history }。
 */
async function findCase(label, candidates, predicate, limit = 12) {
  for (const record of candidates.slice(0, limit)) {
    let history;
    try {
      history = await detailOf(record);
    } catch (err) {
      console.warn(`  ! ${record.unit_id}|${record.job_number}: ${err.message}`);
      continue;
    }
    if (predicate(pickDetail(history), history, record)) return { label, record, history };
  }
  return null;
}

async function main() {
  await fs.mkdir(FIXTURES, { recursive: true });

  console.log(`[1/3] listbydate ${DATE} …`);
  const records = await client.listByDate(DATE);
  const listPath = path.join(FIXTURES, `listbydate-${DATE}.json`);
  await fs.writeFile(listPath, JSON.stringify({ records }));
  const bytes = (await fs.stat(listPath)).size;
  console.log(`      ${records.length} records -> ${listPath} (${(bytes / 1e6).toFixed(2)} MB)`);

  console.log('[2/3] 挑樣本並抓 detail（throttled）…');

  const cat871 = records.filter((r) => category(r).startsWith('勞務類871'));
  const cat96 = records.filter((r) => category(r).startsWith('勞務類96'));
  const labour = records.filter((r) => category(r).startsWith('勞務類') && isTenderNotice(r));
  // 未公開預算的多半是限制性招標／公開評選，排前面可少打幾次 API
  const labourHiddenFirst = [
    ...labour.filter((r) => /限制性招標/.test(type(r))),
    ...labour.filter((r) => !/限制性招標/.test(type(r))),
  ];
  const corrections = records.filter((r) => /更正公告$/.test(type(r)) && isTenderNotice(r));
  const reference = records.filter((r) => type(r) === '公開徵求廠商提供參考資料公告');
  const awards = records.filter((r) => type(r) === '決標公告');

  const wanted = [
    [
      'a) 勞務類871 招標公告 + 預算金額公開',
      [...cat871.filter(isTenderNotice), ...cat871],
      (d) => d['採購資料:預算金額'] != null && String(d['採購資料:預算金額']).trim() !== '',
    ],
    [
      'b) 預算金額 null 且「預算金額是否公開」以「否」開頭',
      labourHiddenFirst,
      (d) =>
        (d['採購資料:預算金額'] == null || String(d['採購資料:預算金額']).trim() === '') &&
        String(d['採購資料:預算金額是否公開'] ?? '').startsWith('否'),
      45,
    ],
    ['c) 更正公告（歷程同時含原始公告與更正）', corrections, (_d, history) => history.length >= 2],
    [
      'd) 公開徵求廠商提供參考資料公告（detail 極簡）',
      reference,
      (d) => Object.keys(d).length > 0 && !('採購資料:預算金額' in d),
    ],
    ['e) 勞務類96', [...cat96.filter(isTenderNotice), ...cat96], () => true],
    [
      'f) 決標公告（key 前綴為 已公告資料:）',
      awards,
      (_d, history) =>
        history.some((h) => Object.keys(h?.detail ?? {}).some((k) => k.startsWith('已公告資料:'))),
    ],
  ];

  const picked = [];
  for (const [label, candidates, predicate, limit] of wanted) {
    const hit = await findCase(label, candidates, predicate, limit);
    if (!hit) {
      console.warn(`  x ${label}: 找不到（候選 ${candidates.length} 筆）`);
      continue;
    }
    picked.push(hit);
    console.log(
      `  ok ${label}\n      ${hit.record.unit_id}|${hit.record.job_number}\n` +
        `      ${hit.record.unit_name} / ${hit.record.brief?.title}\n` +
        `      type=${type(hit.record)} category=${category(hit.record) || '(none)'} ` +
        `history=${hit.history.length} detailKeys=${Object.keys(pickDetail(hit.history)).length}`,
    );
  }

  console.log('[3/3] 寫出 tender-detail-samples.json …');
  const samples = {};
  for (const hit of picked) {
    samples[`${hit.record.unit_id}|${hit.record.job_number}`] = {
      _why: hit.label,
      _list_brief: hit.record.brief,
      unit_name: hit.record.unit_name,
      records: hit.history,
    };
  }
  const samplePath = path.join(FIXTURES, 'tender-detail-samples.json');
  await fs.writeFile(samplePath, JSON.stringify(samples, null, 2));
  console.log(
    `      ${Object.keys(samples).length} cases -> ${samplePath} ` +
      `(${((await fs.stat(samplePath)).size / 1024).toFixed(0)} KB, ${fetches} detail requests)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
