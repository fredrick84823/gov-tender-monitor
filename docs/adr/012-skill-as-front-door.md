# 012. skill 定位為操作前門，不是交付機制

**狀態**：已實作　**決策者**：使用者接受（我提出限制後）

## 背景

任務二要讓別人能在自己機器上跑。使用者提出包裝成 skill，用
`npx skills add …` 安裝，內含 `setup.sh` 確保套件裝好。

查證結果：

- `npx skills add` **是真的**（npm 套件 `skills` v1.5.25），但發布者是 **Vercel Labs**，
  與 Anthropic 無關。它做的事是 clone repo 並 symlink 到 `~/.claude/skills/`。
- Claude Code **沒有任何安裝時的 hook**。`PostInstall`、`Install`、`PluginInstall`
  都被判定為未知事件。所以 skill 帶的 `setup.sh` **不會自己執行**。

## 決策

同時提供兩條安裝路徑（都實測從 GitHub 安裝成功）：

```bash
npx skills add fredrick84823/gov-tender-monitor
claude plugin marketplace add fredrick84823/gov-tender-monitor
```

但 skill 的職責限定為：**臨時重跑、改規則、回答「這個標案為什麼沒出現」**。
`SKILL.md` 明寫它不排程、不寄信，並要求模型不要自行重算過濾結果。

## 理由

skill 是一段提示詞，它的前提是「有個 agent 正在跑」。而需求是一個截止時間。
兩者不匹配（見 ADR 011）。

但 skill 在**需要判斷**的地方確實有價值：

- 「這個標案為什麼沒出現？」需要逐條檢查公告類型、採購性質、兩條命中路徑、
  38 條排除清單。人做很煩，模型做很快。
- 判斷排除清單是否過寬（例如 ADR 004 提到的畢業紀念冊案例）需要理解
  「標的」與「場地」的差別。這是判斷，不是規則。

## 後果

- `bootstrap.sh` 可重複執行，用三種方式找專案（隨 repo clone、目前工作目錄、
  先前 bootstrap 位置），都找不到才 clone。
- `SKILL.md` 把「這個標案為什麼沒出現」寫成一個四步檢查順序，最後一步指向
  Excel 的「已排除」分區 —— 也就是 ADR 004 的產物。
