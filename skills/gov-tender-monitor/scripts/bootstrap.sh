#!/usr/bin/env bash
# 找出（或取得）專案，確認可以運作，印出路徑。可重複執行。
set -euo pipefail

REPO_URL="${GOV_TENDER_REPO:-https://github.com/fredrick84823/gov-tender-monitor.git}"
WORKDIR="${GOV_TENDER_HOME:-$HOME/.gov-tender-monitor}"

find_project() {
  # 1) 已經在專案裡（skill 隨 repo 一起 clone 的情形）
  local here; here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local d="$here"
  while [ "$d" != "/" ]; do
    if [ -f "$d/package.json" ] && grep -q '"gov-tender-monitor"' "$d/package.json" 2>/dev/null; then
      echo "$d"; return 0
    fi
    d="$(dirname "$d")"
  done
  # 2) 目前工作目錄
  if [ -f package.json ] && grep -q '"gov-tender-monitor"' package.json 2>/dev/null; then
    pwd; return 0
  fi
  # 3) 先前 bootstrap 過的位置
  [ -f "$WORKDIR/package.json" ] && { echo "$WORKDIR"; return 0; }
  return 1
}

if ! PROJECT="$(find_project)"; then
  command -v git >/dev/null 2>&1 || { echo "✗ 找不到 git，無法取得專案" >&2; exit 1; }
  echo "▸ 取得專案到 $WORKDIR"
  git clone --depth 1 "$REPO_URL" "$WORKDIR"
  PROJECT="$WORKDIR"
fi

cd "$PROJECT"

command -v node >/dev/null 2>&1 || { echo "✗ 找不到 node。請安裝 Node.js 20 以上" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || { echo "✗ Node 版本過舊（v$(node -p 'process.versions.node')），需要 20 以上" >&2; exit 1; }

if [ ! -d node_modules ]; then
  echo "▸ 安裝相依套件"
  if [ -f package-lock.json ]; then npm ci --silent; else npm install --silent; fi
fi

echo "▸ 驗證產出與基準一致"
node scripts/verify.js

cat <<INFO

專案就緒：$PROJECT

在該目錄下可執行：
  npm run report -- --date 20260817    產出指定日期的 Excel
  npm run doctor                       檢查環境
  npm run verify                       離線比對產出是否與基準一致
INFO
