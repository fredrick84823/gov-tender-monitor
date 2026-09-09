#!/usr/bin/env bash
# 一鍵安裝。在任何一台新機器上，從零到產出第一份 Excel。
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }

step "檢查 Node.js"
command -v node >/dev/null 2>&1 || die "找不到 node。請先安裝 Node.js 20 以上：https://nodejs.org 或 nvm install 22"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node 版本過舊（目前 v$(node -p 'process.versions.node')），需要 20 以上"
echo "  node v$(node -p 'process.versions.node')"

step "安裝相依套件"
if [ -f package-lock.json ]; then npm ci; else npm install; fi

step "執行測試"
npm test --silent

step "離線驗證產出是否與基準一致"
node scripts/verify.js

step "環境檢查"
node scripts/doctor.js || true   # 提醒不阻斷安裝

cat <<'DONE'

安裝完成。接著可以：

  npm run report -- --date 20260817     產出指定日期的 Excel（會連採購網）
  npm run report                        產出今天的 Excel
  npm run verify                        離線比對產出是否與基準一致
  npm run doctor                        重新檢查環境

輸出檔在 out/ 目錄。

DONE
