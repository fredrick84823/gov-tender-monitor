#!/usr/bin/env node
/**
 * 實驗腳本：openfun API vs 官網爬蟲，同一批標案的資料完整度比較。
 *
 * 這是「實驗等級」的程式，不是生產程式：
 *   - HTML 解析用 regex，沒有 DOM parser、沒有新增依賴（刻意如此，見結論）。
 *   - 解析規則綁在官網的呈現屬性上（class="T11b" / class="newstop" / bgcolor），
 *     只要官網改版就會壞。生產程式不該長這樣。
 *   - 只跑一天（20260817）的 10 筆樣本，不做長期穩定度觀測。
 *
 * 用法：
 *   node scripts/experiment-scraper.js            # 直接抓官網（會撞到驗證碼牆）
 *   node scripts/experiment-scraper.js --json out.json
 *   node scripts/experiment-scraper.js --html-dir <dir>
 *       <dir>/<filename>.html 若存在就用本地檔案取代線上抓取。
 *       這是為了讓「驗證碼已由人工解過」的那幾頁也能進入欄位比對——
 *       本腳本刻意*不*內建驗證碼破解，只記錄牆的存在與配額。
 *
 * 產出：每筆標案在兩個資料源各欄位的 present / absent / value，
 *       以及每次請求的延遲、每個 URL 的最終落點與封鎖型態。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPccClient, DEFAULT_USER_AGENT } from '../src/pcc-client.js';
import { field, pickAnnouncement } from '../src/enrich.js';
import { select } from '../src/select.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const DAY = '20260817';

/**
 * 樣本：這 10 筆全部來自 select() 對 demo-data 的實際輸出（腳本會驗證），
 * 刻意涵蓋 5 種公告類型、871、96、更正公告、公開徵求參考資料公告。
 */
const SAMPLE_FILENAMES = [
  'TIQ-3-71094270', // 勞務類871 廣告服務，經公開評選限制性招標
  'TIQ-11-71094411', // 勞務類871 廣告服務，公開取得報價單或企劃書
  'TIQ-3-71094146', // 勞務類96，經公開評選限制性招標（SXSW）
  'TIQ-3-71094380', // 勞務類96，經公開評選限制性招標（重陽敬老）
  'TIQ-4-71092352', // 勞務類96，*更正公告*
  'TIQ-4-71093670', // 勞務類911，*更正公告*
  'PPW-1-70112755', // *公開徵求廠商提供參考資料公告*（無分類）
  'PPW-1-70112890', // *公開徵求廠商提供參考資料公告*（無分類）
  'TIQ-1-71094256', // 勞務類879，公開招標公告
  'TIQ-11-71094130', // 勞務類911，公開取得報價單或企劃書
];

/** 要比較的 10 個欄位，順序即報表順序 */
const FIELDS = [
  '標的分類',
  '採購性質',
  '預算金額',
  '預算金額是否公開',
  '截止投標',
  '公告日',
  '招標方式',
  '機關聯絡人',
  '履約地點',
  '履約期限',
];

/**
 * 各欄位在官網 HTML 上實際使用的標籤名（含同義寫法）。
 * API 的 key 是 `區塊:欄位`，用 enrich.js 的 field() 以尾段比對；
 * 官網則是純文字標籤，兩邊的標籤字面不完全一致，故分開列。
 */
const HTML_LABELS = {
  標的分類: ['標的分類'],
  採購性質: ['採購性質', '財物採購性質'],
  預算金額: ['預算金額'],
  預算金額是否公開: ['預算金額是否公開'],
  截止投標: ['截止投標', '收件截止時間'],
  公告日: ['公告日', '公告日期'],
  招標方式: ['招標方式'],
  機關聯絡人: ['聯絡人'],
  履約地點: ['履約地點'],
  履約期限: ['履約期限'],
};

/** API 端同一欄位的候選 key 尾段（機關聯絡人在 detail 裡叫「聯絡人」） */
const API_LABELS = {
  標的分類: ['標的分類'],
  採購性質: ['採購性質', '財物採購性質'],
  預算金額: ['預算金額'],
  預算金額是否公開: ['預算金額是否公開'],
  截止投標: ['截止投標', '收件截止時間'],
  公告日: ['公告日', '公告日期'],
  招標方式: ['招標方式'],
  機關聯絡人: ['聯絡人'],
  履約地點: ['履約地點'],
  履約期限: ['履約期限'],
};

const REDIRECT_PUBLIC = 'https://web.pcc.gov.tw/prkms/tender/common/noticeDate/redirectPublic';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 樣本挑選

function loadSample() {
  const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/data/demo-data.json'), 'utf8'));
  const rules = demo.rules ?? JSON.parse(fs.readFileSync(path.join(ROOT, 'config/rules.json'), 'utf8'));
  const day = demo.days[DAY];
  if (!day) throw new Error(`demo-data 沒有 ${DAY} 這天`);

  const { selected } = select(day.records, rules);
  const byFilename = new Map(selected.map((s) => [s.record.filename, s]));

  const sample = SAMPLE_FILENAMES.map((fn) => {
    const hit = byFilename.get(fn);
    // fail-loud：樣本必須真的是 pipeline 選出來的，否則實驗前提不成立
    if (!hit) throw new Error(`樣本 ${fn} 不在 select() 的輸出裡（共 ${selected.length} 筆）`);
    return hit;
  });

  return { sample, selectedCount: selected.length };
}

// ---------------------------------------------------------------- API 端

/** 從 API detail 取欄位；回傳 { status, value } */
function fromApiDetail(detail, names) {
  for (const name of names) {
    const v = field(detail, name);
    if (v != null && String(v).trim() !== '') return { status: 'present', value: String(v) };
  }
  return { status: 'absent', value: null };
}

async function runApiSide(sample) {
  // pcc-client 會把請求序列化並保證 1 req/s 的間隔，所以「呼叫到回來」的時間
  // 裡面包含排隊等待。要跟爬蟲端公平比較，必須單獨量純 HTTP 往返，
  // 故在這裡包一層 fetch 計時器。
  let lastHttpMs = null;
  const timedFetch = async (url, init) => {
    const t = performance.now();
    try {
      return await globalThis.fetch(url, init);
    } finally {
      lastHttpMs = Math.round(performance.now() - t);
    }
  };

  const client = createPccClient({ fetch: timedFetch });
  const results = [];

  for (const item of sample) {
    const { unit_id: unitId, job_number: jobNumber, filename } = item.record;
    lastHttpMs = null;
    const t0 = performance.now();
    let records = null;
    let error = null;
    try {
      records = await client.tenderDetail(unitId, jobNumber);
    } catch (e) {
      error = e.message;
    }
    const ms = Math.round(performance.now() - t0);
    const httpMs = lastHttpMs;

    const chosen = records ? pickAnnouncement(records, filename) : null;
    const detail = chosen?.detail ?? null;
    const fields = {};
    for (const f of FIELDS) fields[f] = fromApiDetail(detail, API_LABELS[f]);

    results.push({
      filename,
      unitId,
      jobNumber,
      ms,       // 含 throttle 排隊
      httpMs,   // 純 HTTP 往返
      error,
      // API 一次 call 回傳整個案子的公告史，這是它的獨有能力
      announcementCount: records?.length ?? 0,
      matchedExactAnnouncement: Boolean(records?.some((r) => r.filename === filename)),
      detailKeyCount: detail ? Object.keys(detail).length : 0,
      detailKeys: detail ? Object.keys(detail) : [],
      fetchedAt: detail?.fetched_at ?? null,
      pkPmsMain: detail?.pkPmsMain ?? null,
      fields,
    });
  }

  return results;
}

// ---------------------------------------------------------------- 爬蟲端

/** 官網公開入口，不需要先打 API 就能組出來 */
function publicUrlFor(record) {
  return `${REDIRECT_PUBLIC}?ds=${record.date}&fn=${encodeURIComponent(record.filename)}.xml`;
}

/**
 * 抓一頁官網 HTML，手動跟 redirect 以便記錄整條 303 鏈。
 * @returns {Promise<{html:string|null, chain:string[], finalUrl:string|null,
 *                    status:number|null, ms:number, error:string|null}>}
 */
async function fetchOfficialPage(url) {
  const headers = {
    'User-Agent': DEFAULT_USER_AGENT,
    Accept: 'text/html,application/xhtml+xml',
    'Accept-Language': 'zh-TW,zh;q=0.9',
  };
  const chain = [];
  let current = url;
  const t0 = performance.now();

  try {
    for (let hop = 0; hop < 6; hop += 1) {
      const res = await fetch(current, { headers, redirect: 'manual' });
      chain.push(`${res.status} ${current}`);
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) break;
        current = new URL(loc, current).toString();
        continue;
      }
      const html = await res.text();
      return {
        html,
        chain,
        finalUrl: current,
        status: res.status,
        ms: Math.round(performance.now() - t0),
        error: null,
      };
    }
    return {
      html: null,
      chain,
      finalUrl: current,
      status: null,
      ms: Math.round(performance.now() - t0),
      error: 'redirect 超過 6 跳',
    };
  } catch (e) {
    return {
      html: null,
      chain,
      finalUrl: current,
      status: null,
      ms: Math.round(performance.now() - t0),
      error: e.message,
    };
  }
}

/** 判斷這頁到底是標案內容、驗證碼牆、還是 WAF 封鎖頁 */
function classifyPage(html) {
  if (html == null) return 'fetch-failed';
  if (html.includes('Web Page Blocked')) return 'waf-blocked';
  if (html.includes('驗證碼檢核')) return 'captcha';
  if (html.includes('標案名稱') || html.includes('標案案號')) return 'content';
  return 'unknown';
}

const stripTags = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\r]+/g, ' ')
    .trim();

/**
 * 實驗等級的表格解析。
 *
 * 官網同時存在兩代頁面，欄位表格的 class 慣例完全不同，實測到三組：
 *   二代 /prkms/…/viewDetail        ：<td class="T11b">標籤</td><td class="newstop">值</td>
 *   三代 /tps/…/historyTenderDetail ：<td class="tbg_1">標籤</td><td class="tbg_2">值</td>
 *                                     <td class="tbg_4">標籤</td><td class="tbg_4R">值</td>
 * 也就是說「標籤/值」的判定完全綁在純呈現用的 class 名稱上。
 * 這就是爬蟲路線最脆弱的地方：官網改一次版型，這裡就全滅。
 *
 * @returns {Map<string,string>} 標籤 -> 值
 */
const LABEL_CLASS = /class="[^"]*\b(?:T11b|tbg_\d+)\b/;
const VALUE_CLASS = /class="[^"]*\b(?:newstop|tbg_2|tbg_\d+R)\b/;

function parseLabelValuePairs(html) {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
  const cells = [];
  const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
  let m;
  while ((m = cellRe.exec(body)) !== null) {
    cells.push({ attrs: m[2], text: stripTags(m[3]) });
  }

  const out = new Map();
  for (let i = 0; i < cells.length - 1; i += 1) {
    const label = cells[i];
    if (!LABEL_CLASS.test(label.attrs)) continue;
    // 標籤必須是短的單行文字，否則就是值被誤判成標籤
    if (!label.text || label.text.length > 30 || label.text.includes('\n')) continue;
    const value = cells[i + 1];
    if (!VALUE_CLASS.test(value.attrs)) continue;
    if (!out.has(label.text)) out.set(label.text, value.text);
  }
  return out;
}

function fromHtmlPairs(pairs, names) {
  for (const name of names) {
    if (pairs.has(name)) {
      const v = pairs.get(name);
      if (v && v.trim() !== '') return { status: 'present', value: v };
      return { status: 'empty', value: '' };
    }
  }
  return { status: 'absent', value: null };
}

async function runScraperSide(sample, { intervalMs = 1100, htmlDir = null } = {}) {
  const results = [];
  for (const item of sample) {
    const url = publicUrlFor(item.record);
    const cached = htmlDir ? path.join(htmlDir, `${item.record.filename}.html`) : null;
    const useCache = cached && fs.existsSync(cached);

    const page = useCache
      ? {
          html: fs.readFileSync(cached, 'utf8'),
          chain: [`(local) ${cached}`],
          finalUrl: null,
          status: null,
          ms: null,
          error: null,
        }
      : await fetchOfficialPage(url);
    const kind = classifyPage(page.html);
    const pairs = kind === 'content' ? parseLabelValuePairs(page.html) : new Map();

    const fields = {};
    for (const f of FIELDS) {
      fields[f] =
        kind === 'content'
          ? fromHtmlPairs(pairs, HTML_LABELS[f])
          : { status: `blocked:${kind}`, value: null };
    }

    results.push({
      filename: item.record.filename,
      url,
      chain: page.chain,
      finalUrl: page.finalUrl,
      httpStatus: page.status,
      bytes: page.html?.length ?? 0,
      ms: page.ms,
      error: page.error,
      kind,
      // 這頁的 HTML 是線上直抓，還是人工解過驗證碼後留下的存檔
      origin: useCache ? 'captcha-solved-session (local file)' : 'live fetch',
      parsedLabels: [...pairs.keys()],
      fields,
    });

    if (!useCache) await sleep(intervalMs); // 有禮貌：約 1 req/s，序列化
  }
  return results;
}

// ---------------------------------------------------------------- 驗證碼牆探測

/**
 * 探測官網驗證碼牆是不是「速率觸發」還是「無條件」：
 * 同一個 URL 連抓 n 次，中間間隔 gapMs，回報每次落到哪種頁面。
 * 這裡刻意不帶 cookie（每次都是冷 session），也刻意不解驗證碼。
 */
async function probeWall(url, { n = 5, gapMs = 6000 } = {}) {
  const seen = [];
  for (let i = 0; i < n; i += 1) {
    const page = await fetchOfficialPage(url);
    seen.push({ i: i + 1, kind: classifyPage(page.html), ms: page.ms, bytes: page.html?.length ?? 0 });
    if (i < n - 1) await sleep(gapMs);
  }
  return seen;
}

// ---------------------------------------------------------------- 報表

const P = (r) => Object.values(r.fields).filter((f) => f.status === 'present').length;

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: s[0],
    median: s[Math.floor((s.length - 1) / 2)],
    max: s[s.length - 1],
    mean: Math.round(sum / s.length),
    total: sum,
  };
}

function report(sample, api, scraper) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  push(`實驗日期資料：${DAY}　樣本 ${sample.length} 筆`);
  push();

  push('== 樣本 ==');
  for (const s of sample) {
    push(
      [
        s.record.filename,
        s.record.brief.type,
        s.record.brief.category || '(無分類)',
        s.record.brief.title.slice(0, 28),
      ].join(' | '),
    );
  }
  push();

  push('== 每筆：欄位命中數 / 延遲 / 爬蟲落點 ==');
  push(
    [
      'filename',
      'API命中',
      'API http ms',
      'API 含排隊 ms',
      'API keys',
      '爬蟲命中',
      '爬蟲 ms',
      'bytes',
      '爬蟲結果',
      '爬蟲 HTML 來源',
    ].join('\t'),
  );
  for (let i = 0; i < sample.length; i += 1) {
    const a = api[i];
    const w = scraper[i];
    push(
      [
        a.filename,
        `${P(a)}/10`,
        a.httpMs,
        a.ms,
        a.detailKeyCount,
        `${P(w)}/10`,
        w.ms,
        w.bytes,
        w.kind,
        w.origin,
      ].join('\t'),
    );
  }
  push();

  push('== 欄位對欄位（present 筆數 / 10）==');
  push(['欄位', 'API', '爬蟲'].join('\t'));
  for (const f of FIELDS) {
    const a = api.filter((r) => r.fields[f].status === 'present').length;
    const w = scraper.filter((r) => r.fields[f].status === 'present').length;
    push([f, a, w].join('\t'));
  }
  push();

  push('== 值有差異的欄位（兩邊都 present 且字串不等）==');
  let diffs = 0;
  for (let i = 0; i < sample.length; i += 1) {
    for (const f of FIELDS) {
      const a = api[i].fields[f];
      const w = scraper[i].fields[f];
      if (a.status === 'present' && w.status === 'present') {
        const na = a.value.replace(/\s+/g, '');
        const nw = w.value.replace(/\s+/g, '');
        if (na !== nw) {
          diffs += 1;
          push(`${api[i].filename} / ${f}`);
          push(`  API   : ${JSON.stringify(a.value)}`);
          push(`  爬蟲  : ${JSON.stringify(w.value)}`);
        }
      }
    }
  }
  if (!diffs) push('（無）');
  push();

  push('== 只是格式不同（去掉所有空白後相同，原始字串不同）==');
  let fmt = 0;
  for (let i = 0; i < sample.length; i += 1) {
    for (const f of FIELDS) {
      const a = api[i].fields[f];
      const w = scraper[i].fields[f];
      if (a.status !== 'present' || w.status !== 'present') continue;
      if (a.value === w.value) continue;
      if (a.value.replace(/\s+/g, '') !== w.value.replace(/\s+/g, '')) continue;
      fmt += 1;
      push(`${api[i].filename} / ${f}`);
      push(`  API   : ${JSON.stringify(a.value)}`);
      push(`  爬蟲  : ${JSON.stringify(w.value)}`);
    }
  }
  if (!fmt) push('（無）');
  push();

  push('== 延遲 (ms) ==');
  push(`API 純 HTTP   : ${JSON.stringify(stats(api.map((r) => r.httpMs)))}`);
  push(`API 含排隊    : ${JSON.stringify(stats(api.map((r) => r.ms)))}`);
  const liveScraper = scraper.filter((r) => r.ms != null);
  push(
    liveScraper.length
      ? `爬蟲 純 HTTP  : ${JSON.stringify(stats(liveScraper.map((r) => r.ms)))} （n=${liveScraper.length}，僅線上直抓的那幾筆）`
      : '爬蟲 純 HTTP  : （本次全部走本地存檔，未量測）',
  );
  push('注意：API「含排隊」包含 pcc-client 的 1 req/s 最小間隔等待；跨源比較要看「純 HTTP」。');
  push('爬蟲端的 ms 是整條 303 鏈（2-3 次 HTTP）的總和，且腳本自己另外 sleep 1100ms，未計入。');
  push();

  push('== 爬蟲 redirect 鏈 ==');
  for (const w of scraper) {
    push(`${w.filename} [${w.kind}]`);
    for (const hop of w.chain) push(`  ${hop}`);
  }
  push();

  push('== 爬蟲解析到的標籤（僅 content 頁）==');
  for (const w of scraper) {
    if (w.kind === 'content') push(`${w.filename}: ${w.parsedLabels.join('、')}`);
  }
  push();

  push('== API detail 的全部 key（用來找「只有一邊有」的欄位）==');
  for (const a of api) {
    push(`${a.filename} (${a.detailKeyCount} keys, ${a.announcementCount} 筆公告史)`);
    push(`  ${a.detailKeys.join('、')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------- main

async function main() {
  const { sample, selectedCount } = loadSample();

  if (process.argv.includes('--probe-wall')) {
    const target = publicUrlFor(sample[0].record);
    process.stderr.write(`探測 ${target}\n`);
    for (const row of await probeWall(target)) {
      process.stdout.write(`第 ${row.i} 次: ${row.kind}\t${row.ms}ms\t${row.bytes} bytes\n`);
    }
    return;
  }

  process.stderr.write(`select() 選出 ${selectedCount} 筆，取樣 ${sample.length} 筆\n`);

  process.stderr.write('--- API 端 ---\n');
  const api = await runApiSide(sample);

  process.stderr.write('--- 爬蟲端 ---\n');
  const dirIdx = process.argv.indexOf('--html-dir');
  const htmlDir = dirIdx !== -1 ? process.argv[dirIdx + 1] : null;
  const scraper = await runScraperSide(sample, { htmlDir });

  const text = report(sample, api, scraper);
  process.stdout.write(`${text}\n`);

  const jsonIdx = process.argv.indexOf('--json');
  if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) {
    fs.writeFileSync(
      process.argv[jsonIdx + 1],
      JSON.stringify({ day: DAY, fields: FIELDS, api, scraper }, null, 2),
    );
  }
}

main().catch((e) => {
  process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
