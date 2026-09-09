# 006. 只開一個測試接縫

**狀態**：已實作　**決策者**：使用者同意（實作前先對焦）

## 背景

專案從空目錄開始，沒有既有接縫。過濾、去重、細查、組表可以各自開測試入口，
也可以只開一個。

## 決策

唯一接縫是 `runDailyReport({ pcc, clock, mailer, config })`。
所有外部世界都從參數注入：資料源、時鐘、規則。中間的 `select`、`enrich`、
`buildWorkbook` 都是純函式，不各自開測試入口。

```
runDailyReport({ pcc, rules, date, clock })
      ├─ pcc    : 資料源（測試餵 fixture）
      ├─ clock  : 決定「今天」（測試固定時間）
      └─ rules  : 規則（測試給小組假資料）
      ↓ { workbook, stats, enriched, excluded }
```

## 理由

38 條排除清單是「會一直被改」的東西。若每個模組各開測試入口，每次改規則都要改
多處測試結構。只開一個接縫，改規則時只需要加 fixture 案例。

## 後果

- 純函式仍有各自的單元測試（`select.test.js`、`enrich.test.js`），但那是為了
  釘住個別規則的行為，不是系統的測試入口。
- 89 條測試中，8 條打在這個接縫上，其餘釘個別規則與版型。
- 細查失敗會讓整個 `runDailyReport` 拋出 —— 因為只有一個入口，這個行為只需要
  在一個地方保證（見 ADR 010）。
