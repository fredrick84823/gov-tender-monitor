---
date: 2026-09-09T15:58:07+08:00
git_commit: 48e243d6239310aa8c38052b901771d3e7aaf777
branch: main
repository: gov-tender-monitor
topic: "公標網政府標案每日監控 — 課程作業兩任務與展示網頁"
tags: [implementation, pcc-api, xlsx, skill-packaging, artifact, classroom-demo]
status: complete
last_updated: 2026-09-09
---

# Handoff: 公標網（政府標案每日監控）— AI 培訓課程作業

## Task(s)

三塊工作，全部完成，但有未結的尾巴（見 Action Items）。

**任務一 · 產出 Excel** — **完成**。`npm run report -- --date 20260817` 從政府採購網
取得當日全部公告，過濾去重後產出對齊客戶範本的 xlsx。89 條測試全過。

**任務二 · 可搬到別人機器** — **完成**。`setup.sh` / `doctor.js` / `verify.js`
＋ 打包成 Claude Code skill 與 plugin（兩條安裝路徑都實測從 GitHub 安裝成功）。

**課堂展示網頁** — **完成並已發布**。
https://claude.ai/code/artifact/834574da-1aa9-4408-aaec-1eca26474c9c
（**目前是私有的**，同學打不開，見 Action Items 第 1 項）

**明確不做**：寄信、排程實作。排程只做可行性評估與文件化（ADR 011）。

## Critical References

- `docs/adr/README.md` — 14 則決策索引，第二欄是「決策者」，先讀這個
- `docs/requirements.md` — 客戶定案規格（已去識別化）
- `docs/client-questions.md` — 8 題待客戶拍板，**尚未送出給客戶**

## Recent Changes

過濾核心的順序是刻意的，每一步都在減少後面的工作量：

- `src/select.js:52` 公告類型白名單（10 種）—— 1787 → 897，先砍掉最多
- `src/select.js:58` 路 A 標的分類命中（限勞務類）
- `src/select.js:64` 路 B 關鍵字；**分類為 null 時放行**（ADR 003）
- `src/select.js:72` 以 `filename` 去重 —— **不是**規格寫的 `unit_id + job_number`（ADR 002）
- `src/select.js:76` 38 條排除清單，**放最後**，才知道誰被哪條擋下（ADR 004）
- `src/run-daily-report.js:35` 細查只打在收斂後的 35 筆上（ADR 009）
- `src/workbook.js:124` 單一分頁、依搜尋路徑分區 —— 照客戶範本，非規格文字（ADR 005）
- `scripts/build-web.js:110` 佔位偵測改看佔位文字本身，不只看實驗檔存不存在

## Learnings

**規格有三處實質錯誤，都已修正並寫成 ADR：**

1. **去重鍵是錯的。** `unit_id + job_number` 是案件鍵，原公告與更正公告共用同一組值。
   照規格實作會把每筆更正公告都當重複丟掉，客戶因此收不到截止日延期。
2. **有一種指定的公告類型 API 給不出任何欄位。** 「公開徵求廠商提供參考資料公告」
   的 `brief.category` 是 `null`，細查也只有 15~18 個欄位。實測顯示這型在客戶自己的
   範本裡是 **0 筆** —— 規格白名單收了一個客戶實際從沒收過的類型。
3. **輸出版型與規格文字五處衝突。** 以客戶範本為準。但**範本本身的排除清單是舊版**，
   所以範本的版型可能也已過時 —— 這是客戶問題清單第 3 題。

**排除清單會靜默誤殺，而且真實案例比虛構的更有力。**
8/17 那天【畢業紀念冊】擋掉 3 筆，**全部是路 A 命中** —— 政府自己把標的分類編為
871 廣告服務 / 875 攝影服務，然後排除清單因為標題四個字否決了它們。
**排除清單正在推翻政府的官方分類。** 這是「已排除」分區存在才看得見的。
（我先前舉的「活動中心啟用晚會宣傳影片製作」是虛構的；那天真實被「活動中心」
擋下的是一個整修工程，擋得正確。）

**排除詞之間有重疊。** 關掉 3 條校外教學排除詞，那 3 條擋下 16 筆，但只有 12 筆
進入命中 —— 另外 4 筆被清單裡其他詞同時擋著。關掉一條不等於放行它擋的全部。

**爬蟲在這個需求下不可行，原因不是欄位完整度。** 官方詳情頁有撲克牌圖形驗證碼，
**無條件出現**（同 URL 6 秒間隔冷抓 5 次，5 次全被擋）。可解但是通行費：解一次約看
6~7 頁，credit 綁 IP 不在 cookie。每天 35 筆要人工解 5~6 次，而需求是無人排程。
且 **WAF 對 headless 瀏覽器比對 curl 更嚴**（Playwright 拿到 Attack ID 20000051，
同 IP 同時 curl 卻通）。反直覺，值得記住。

**但鏡像沒有失真** —— 進得去的 8 筆、8 欄位，84 組配對、語意差異 0 筆，爬蟲獨有欄位為零。
這把依賴非官方鏡像的風險從「資料可能不對」降為「服務可能中斷」。

**ground truth 必須來自實作之外。** 用自己的實作產生期望值只能驗證「程式沒變」，
不能驗證「程式正確」。客戶手動查出來的那份 Excel 是唯一的外部基準（ADR 007）。

**去識別化不是一次性動作，是每次產出後都要重跑的檢查。** 代換完成後，做網頁的
subagent 從 git 歷史撈到代換前的客戶名稱寫進頁面 eyebrow，又被 `git add -A` 一起
push 到已公開的 repo。**是 agent-browser 的視覺驗證抓到的**，純文字檢查抓不到
（因為檢查在網頁存在之前跑）。已把歷史壓成單一 commit 徹底移除。詳見 ADR 014。

**Claude Code 沒有安裝時 hook**，`PostInstall` / `Install` / `PluginInstall` 都是未知事件。
skill 帶的 `setup.sh` 不會自己執行，只能靠 skill 指示模型去跑。

## Artifacts

**核心管線**：`src/contracts.js` `src/dates.js` `src/select.js` `src/enrich.js`
`src/pcc-client.js` `src/workbook.js` `src/run-daily-report.js` `bin/report.js`

**規則**：`config/rules.json`（4 大類 / 10 種公告 / 38 條排除 / 27 關鍵字 4 組）

**測試（89 條）**：`test/select.test.js` `test/enrich.test.js` `test/workbook.test.js`
`test/run-daily-report.test.js` `test/pcc-client.test.js`
`test/golden/20260817.json`（87 列黃金檔）`test/fixtures/*`

**可攜性**：`scripts/setup.sh` `scripts/doctor.js` `scripts/verify.js` `scripts/replay.js`
`scripts/capture-fixtures.js`

**skill / plugin**：`skills/gov-tender-monitor/SKILL.md`
`skills/gov-tender-monitor/scripts/bootstrap.sh`
`.claude-plugin/plugin.json` `.claude-plugin/marketplace.json`

**展示網頁**：`web/index.template.html`（原始，含佔位符）`scripts/build-web.js`
`web/dist/index.html`（產出，440 KB）`web/data/demo-data.json`（512 KB 真實資料）
`scripts/build-demo-data.js`

**文件**：`docs/requirements.md` `docs/spec-gaps.md` `docs/client-questions.md`
`docs/scheduling-feasibility.md` `docs/experiments/api-vs-scraper.md`
`scripts/experiment-scraper.js` `docs/adr/001~014` + `docs/adr/README.md`
`CLAUDE.md` `README.md` `docs/agents/*`

**外部**：GitHub https://github.com/fredrick84823/gov-tender-monitor （**public**）
Artifact https://claude.ai/code/artifact/834574da-1aa9-4408-aaec-1eca26474c9c （**private**）
Slack 草稿 `Dr0C0LCB308Z` in `C0BTWBGF2CF`（#ai工作流種子培訓計劃，**未送出**）

## Action Items & Next Steps

1. **送出 Slack 前必須先把 Artifact 分享出去。** 目前是私有的，同學點進去沒有權限。
   要從網頁的分享選單開放。**這是唯一會讓整份展示失效的阻塞項。**
2. **Slack 草稿要換成精簡版。** 使用者說目前那份講太細，要的是「HTML 裡包含哪些大項目」。
   精簡版已在對話中給過，尚未寫回草稿。Slack 一個 channel 只能有一份草稿，
   要先刪 `Dr0C0LCB308Z` 再建新的。
3. **`docs/client-questions.md` 的 8 題從未送給客戶。** 其中第 1 題（規格缺第三節）、
   第 2 題（16:10 每天漏抓）、第 3 題（範本是否過時）會影響後續實作。
4. **可選：擴大細查範圍。** 目前 `web/data/demo-data.json` 只有預設規則下命中＋排除的
   62 筆有細查資料，學員放寬規則時會看到「未擷取」。若要任意規則都有完整欄位，
   跑 `node scripts/build-demo-data.js 20260817` 並把細查範圍改成全部勞務類
   （8/17 是 221 筆，約 4 分鐘），然後重跑 `build-web.js` 並重新發布。
5. **repo demo 結束後要刪除。** 這是 ADR 014 成立的前提（規則保留原樣未去識別化）。
6. **原計畫還沒做的**：用 `/mattpocock-skills:to-spec` 把規格發成 GitHub issue
   （triage labels 已建好，`docs/agents/issue-tracker.md` 已設定）。
7. **`CONTEXT.md` 不存在**，但 `docs/agents/domain.md` 的約定假設它存在。
   若要續用 mattpocock 那套 skill，可用 `/mattpocock-skills:domain-modeling` 補上。

## Other Notes

**資料源**：`https://pcc-api.openfun.app/api`。舊網址 `pcc.g0v.ronny.tw` 會 301
**且吃掉 path**。匿名速率約 7 秒 10 次，429 **沒有 `Retry-After` 標頭**，只能盲目退避。
`src/pcc-client.js` 已內建節流與退避。設 `PCC_API_TOKEN` 可解除限制（尚未申請）。

**Cloudflare 會 403 預設的 Node User-Agent**，`src/pcc-client.js` 帶瀏覽器 UA，別改掉。

**agent-browser 這台機器上沒有全域安裝**，要用 `npx --no-install agent-browser`。

**驗證命令**：
```
npm test                          89 條測試
npm run verify                    離線重播，逐欄比對 87 列
npm run doctor                    6 項環境檢查
npm run report -- --date 20260817 真實產出（約 1 分 17 秒）
node scripts/build-web.js         重建展示網頁
```

**8/17 的基準數字**（改動規則以外的任何原因導致這些變動，都是 bug）：
`1787 當日公告 → 897 過類型白名單 → 62 兩路命中去重 → 35 命中 / 27 排除`

**客戶身分已去識別化**，但 `config/rules.json` 的規則是客戶原始資料，未替換。
自家公司名稱（`tagtoo_xlsx.js`、`ad-report`）刻意保留。
