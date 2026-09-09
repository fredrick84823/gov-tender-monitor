#!/usr/bin/env node
/**
 * 產出 web/dist/index.html —— 一個自帶資料、可直接發布成 claude.ai Artifact 的單檔頁面。
 *
 * 這支腳本刻意「只搬不改」：把 src/dates.js、src/select.js、src/workbook.js 的原始碼
 * 原封不動嵌進頁面，只拆掉瀏覽器不認的 ESM 語法（export / import）。
 *
 * 為什麼是嵌入而不是重寫一份瀏覽器版？
 *   因為重寫的那一份沒有測試。嵌入的這一份，跑的就是 89 條測試固定行為的同一段程式碼——
 *   頁面上的漏斗數字若與 test/ 對不上，那是這裡有 bug，不是頁面「示意」得不夠像。
 *   ExcelJS 由 CDN 提供 window.ExcelJS，所以 import 那行拆掉後語意不變。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = (...xs) => path.join(root, ...xs);

const PIPELINE_SOURCES = ['src/dates.js', 'src/select.js', 'src/workbook.js'];

/** 只拆 ESM 語法，其餘一個字元都不動。回傳 { code, stripped[] } */
function stripModuleSyntax(source, label) {
  const stripped = [];
  const lines = source.split('\n');
  const kept = [];

  for (const line of lines) {
    // import ... from './dates.js' / import ExcelJS from 'exceljs'
    if (/^\s*import\s.+from\s+['"].+['"];?\s*$/.test(line)) {
      stripped.push({ file: label, kind: 'import', text: line.trim() });
      continue;
    }
    // export default buildWorkbook;
    if (/^\s*export\s+default\s+/.test(line)) {
      stripped.push({ file: label, kind: 'export default', text: line.trim() });
      continue;
    }
    // export {};
    if (/^\s*export\s*\{[^}]*\}\s*;?\s*$/.test(line)) {
      stripped.push({ file: label, kind: 'export list', text: line.trim() });
      continue;
    }
    // export function foo(...) → function foo(...)
    const named = /^(\s*)export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/.exec(line);
    if (named) {
      stripped.push({ file: label, kind: 'export keyword', text: line.trim() });
      kept.push(line.replace(/^(\s*)export\s+/, '$1'));
      continue;
    }
    kept.push(line);
  }

  return { code: kept.join('\n'), stripped };
}

function buildPipeline() {
  const chunks = [];
  const stripped = [];
  for (const rel of PIPELINE_SOURCES) {
    const source = fs.readFileSync(p(rel), 'utf8');
    const out = stripModuleSyntax(source, rel);
    stripped.push(...out.stripped);
    chunks.push(
      `// ─────────────────────────────────────────────────────────────────────────\n` +
        `// ${rel} —— 由 scripts/build-web.js 原樣嵌入（只拆 ESM 語法，邏輯與註解未改）\n` +
        `// ─────────────────────────────────────────────────────────────────────────\n` +
        out.code,
    );
  }
  return { code: chunks.join('\n\n'), stripped };
}

function main() {
  const templatePath = p('web/index.template.html');
  const dataPath = p('web/data/demo-data.json');
  const outPath = p('web/dist/index.html');

  const template = fs.readFileSync(templatePath, 'utf8');
  const { code, stripped } = buildPipeline();
  const data = fs.readFileSync(dataPath, 'utf8');

  for (const marker of ['/*__PIPELINE__*/', '<!--__DATA__-->']) {
    if (!template.includes(marker)) {
      throw new Error(`樣板缺少置換標記 ${marker}（${templatePath}）`);
    }
  }

  // </script> 出現在 JSON 字串裡會提前關掉 script 標籤，這是唯一必須動的字元
  const safeData = data.replace(/<\/script/gi, '<\\/script');
  const dataBlock = `<script type="application/json" id="demo-data">\n${safeData}\n</script>`;

  const html = template
    .replace('/*__PIPELINE__*/', () => code)
    .replace('<!--__DATA__-->', () => dataBlock);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);

  // ── 摘要 ────────────────────────────────────────────────────────────────
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`嵌入管線原始碼：${PIPELINE_SOURCES.join('、')}  →  ${kb(code.length)}`);
  console.log(`拆掉的 ESM 語法共 ${stripped.length} 行：`);
  for (const s of stripped) {
    console.log(`  ${s.file.padEnd(16)} [${s.kind}]  ${s.text}`);
  }
  console.log(`嵌入示範資料：web/data/demo-data.json  →  ${kb(data.length)}`);
  console.log(`寫出：web/dist/index.html  →  ${kb(html.length)}`);

  // ③(a) 的資料源實驗還在進行中；檔案一旦就位就提醒操作者這頁還掛著佔位文字
  const expPath = p('docs/experiments/api-vs-scraper.md');
  if (fs.existsSync(expPath)) {
    console.warn('注意：docs/experiments/api-vs-scraper.md 已存在，但頁面 ③(a) 仍是佔位文字 —— 需人工把實驗結論寫進 web/index.template.html');
  } else {
    console.log('待補：docs/experiments/api-vs-scraper.md 尚不存在，③(a) 維持明確標示的佔位區塊');
  }

  for (const tag of ['<!doctype', '<html', '<head', '<body']) {
    if (html.toLowerCase().includes(tag)) {
      console.warn(`警告：產出含 Artifact 不允許的標籤 ${tag}`);
    }
  }
}

main();
