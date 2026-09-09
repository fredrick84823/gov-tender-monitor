# 011. 排程交給作業系統，不用 Claude Code 的排程機制

**狀態**：已文件化（不實作，課堂 demo 範圍）　**決策者**：我（查證官方文件後）

## 背景

規格第五節：每日 16:10 搜尋，18:30 前 Email。使用者詢問能否用 Claude Code 的
本機排程機制（slash command、`/loop`、cron 工具）驅動。

## 決策

排程交給作業系統（cron / launchd）直接呼叫 `npm run report`。
Claude Code 不在排程路徑上。

## 理由

逐一查證每種機制，全部有致命條件不成立：

| 機制 | 失效點 |
|---|---|
| `/loop` | session 內計時器。終端機關掉就停。16:10 筆電在睡 → 不執行，**也不報錯** |
| `CronCreate` | 工具規格明寫 session-only、in-memory、7 天自動失效。`durable` 參數存在但標示無效 |
| `/schedule` routines | 唯一能持久的，但跑在雲端、每次重新 clone repo → xlsx 落在雲端不在本機磁碟，也讀不到未 commit 的收件人清單 |
| hooks | 30 幾種事件**沒有一個是時間驅動的**。`Setup` 只在 `--init-only` 觸發 |
| 自訂 slash command | 只在訊息開頭被辨識 —— 只有人打字才會觸發 |
| `claude -p` headless | 官方支援，可放進 cron，但真正在排程的是 cron。且長效 token 效期一年，到期後排程開始失敗 |

更根本的原因：**這條管線裡沒有 LLM**。`select`、`enrich`、`buildWorkbook`
都是純函式，89 條測試固定其行為。給定同一天的輸入，輸出必然相同。
沒有需要判斷的環節，也就沒有讓模型參與的理由。

## 後果

```cron
10 16 * * 1-5  cd /path/to/gov-tender-monitor && npm run report
```

準時、檔案落本機、失敗有非零 exit code、無憑證過期、零 LLM 成本。
「那台機器要開著」這個前提，上面每一種 Claude Code 機制同樣需要，
只是它們還額外要求終端機開著、session 活著、且在 7 天內。

完整查證見 `docs/scheduling-feasibility.md`。
