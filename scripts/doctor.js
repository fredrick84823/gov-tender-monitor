#!/usr/bin/env node
/**
 * 環境檢查。列出這台機器上每一項前提是否成立，不成立時直接說怎麼修。
 *
 * 檢查項目都是實際踩過的坑，不是形式：Cloudflare 會擋預設 User-Agent、
 * 匿名呼叫有速率限制、Excel 的中文字型在非 Windows 機器上可能沒有對應。
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const rules = JSON.parse(readFileSync(new URL('../config/rules.json', import.meta.url), 'utf8'));
const results = [];
const add = (level, name, detail, fix) => results.push({ level, name, detail, fix });

// ── Node 版本 ────────────────────────────────────────────────────────────
const major = Number(process.versions.node.split('.')[0]);
if (major >= 20) add('ok', 'Node.js', `v${process.versions.node}`);
else add('fail', 'Node.js', `v${process.versions.node} 過舊`, '安裝 Node 20 以上（建議用 nvm：nvm install 22）');

// ── 相依套件 ─────────────────────────────────────────────────────────────
try {
  await import('exceljs');
  add('ok', '相依套件', 'exceljs 已安裝');
} catch {
  add('fail', '相依套件', 'exceljs 找不到', '執行 npm ci');
}

// ── 寫入權限 ─────────────────────────────────────────────────────────────
try {
  mkdirSync('out', { recursive: true });
  writeFileSync('out/.doctor-probe', 'x');
  rmSync('out/.doctor-probe');
  add('ok', '輸出目錄', 'out/ 可寫入');
} catch (e) {
  add('fail', '輸出目錄', `out/ 無法寫入：${e.message}`, '檢查目錄權限');
}

// ── 時區 ─────────────────────────────────────────────────────────────────
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
if (tz === 'Asia/Taipei') add('ok', '時區', tz);
else add('warn', '時區', `${tz}（非 Asia/Taipei）`, '不指定 --date 時「今天」的判定會偏移；排程請設 TZ=Asia/Taipei');

// ── 中文字型 ─────────────────────────────────────────────────────────────
// Excel 產出指定「Microsoft JhengHei」。字型不在本機時，Excel 會替換，
// 版面會略有差異，但內容不受影響 —— 所以是 warn 而非 fail。
let fontFound = false;
try {
  const list = execSync('fc-list 2>/dev/null || system_profiler SPFontsDataType 2>/dev/null || true', {
    encoding: 'utf8', timeout: 15000,
  });
  fontFound = /JhengHei|正黑/i.test(list);
} catch { /* 找不到字型工具就當作查不到 */ }
if (fontFound) add('ok', '中文字型', '找到微軟正黑體');
else add('warn', '中文字型', '本機沒有微軟正黑體', '產出的 Excel 內容正確，但在這台機器上開啟時字型會被替換。實際收件人（Windows + Office）看到的才是正確版面');

// ── API 連通性 ───────────────────────────────────────────────────────────
const { createPccClient } = await import('../src/pcc-client.js');
const pcc = createPccClient({ baseUrl: rules.source.baseUrl, token: process.env.PCC_API_TOKEN });
try {
  const t0 = Date.now();
  const records = await pcc.listByDate('20260817');
  const ms = Date.now() - t0;
  if (records.length > 500) add('ok', '採購網 API', `連通，取得 ${records.length} 筆（${ms}ms）`);
  else add('warn', '採購網 API', `連通但只取得 ${records.length} 筆`, '該日資料可能不完整，換一天再試');
} catch (e) {
  const msg = String(e.message);
  if (/HTTP 403/.test(msg)) {
    add('fail', '採購網 API', 'HTTP 403 —— Cloudflare 擋下了這個請求', '通常是 User-Agent 被擋。確認 src/pcc-client.js 的 User-Agent 未被改動');
  } else if (/HTTP 429/.test(msg)) {
    add('warn', '採購網 API', '速率限制中（429）', '等約 30 秒再試。若經常發生，向開放文化基金會申請 token 並設定 PCC_API_TOKEN');
  } else {
    add('fail', '採購網 API', msg.slice(0, 160), '檢查網路與 Proxy 設定');
  }
}

// ── Token ────────────────────────────────────────────────────────────────
if (process.env.PCC_API_TOKEN) add('ok', 'API token', '已設定（不受匿名速率限制）');
else add('warn', 'API token', '未設定，以匿名身分呼叫', '每日單次查詢通常無妨。若要更穩定，設定環境變數 PCC_API_TOKEN');

// ── 離線重播資料 ─────────────────────────────────────────────────────────
try {
  const { createReplayClient } = await import('./replay.js');
  const recs = await createReplayClient().listByDate('20260817');
  add('ok', '離線驗證資料', `20260817 共 ${recs.length} 筆，可執行 npm run verify`);
} catch (e) {
  add('warn', '離線驗證資料', e.message.slice(0, 120), '執行 node scripts/build-demo-data.js 20260817 重新擷取');
}

// ── 輸出 ─────────────────────────────────────────────────────────────────
const icon = { ok: '✓', warn: '!', fail: '✗' };
const pad = Math.max(...results.map((r) => [...r.name].length * 1.6));
console.log('\n環境檢查\n');
for (const r of results) {
  const name = r.name + ' '.repeat(Math.max(0, pad - [...r.name].length * 1.6));
  console.log(`  ${icon[r.level]} ${name}  ${r.detail}`);
  if (r.fix && r.level !== 'ok') console.log(`      → ${r.fix}`);
}
const fails = results.filter((r) => r.level === 'fail').length;
const warns = results.filter((r) => r.level === 'warn').length;
console.log(`\n${fails ? `✗ ${fails} 項必須修正` : '✓ 所有必要項目通過'}${warns ? `，${warns} 項提醒` : ''}\n`);
process.exit(fails ? 1 : 0);
