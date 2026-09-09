/**
 * 模組介面契約。所有模組都只依賴這裡的形狀，不互相 import 實作。
 *
 * @typedef {object} ListRecord            政府採購網 /api/listbydate 的一筆原始記錄
 * @property {number} date                 西元 YYYYMMDD
 * @property {string} filename             公告唯一鍵，如 "TIQ-11-71107895"
 * @property {string} job_number           標案案號（案件層級，非公告層級）
 * @property {string} unit_id              機關代碼，如 "3.5.48"
 * @property {string} unit_name            機關名稱
 * @property {{type:string,title:string,category:string|null}} brief
 *
 * @typedef {object} Classified            經 select() 判定後的標案
 * @property {ListRecord} record
 * @property {("A"|"B")[]} matchedPaths    命中路徑：A=標的分類、B=關鍵字
 * @property {string[]} matchedGroups      命中的關鍵字組 id，如 ["A","C"]
 * @property {string|null} categoryCode    "871" | "96" | null（參考資料公告無分類）
 * @property {boolean} isCorrection        是否為更正公告
 * @property {string} tenderUrl            官網原文連結
 *
 * @typedef {object} Excluded              被排除清單擋下的標案
 * @property {ListRecord} record
 * @property {string} exclusionTerm        擋下它的那一條排除詞
 * @property {string[]} matchedGroups      原本會命中的關鍵字組（證明它差點入選）
 * @property {string} tenderUrl
 *
 * @typedef {object} SelectResult
 * @property {Classified[]} selected
 * @property {Excluded[]} excluded
 *
 * @typedef {object} Enriched              補上 detail 欄位後的標案
 * @property {Classified} tender
 * @property {string|null} budget          原文字串，如 "1,000,000元"；未公開為 null
 * @property {boolean} budgetPublic        預算金額是否公開
 * @property {string|null} deadline        截止投標，民國格式 "115/09/14 17:00"
 * @property {string|null} announcedOn     公告日，民國格式
 * @property {string|null} tenderMethod    招標方式
 * @property {string|null} procurementNature 採購性質
 *
 * @typedef {object} PccClient             資料源，測試時以 fixture 替身注入
 * @property {(date:string)=>Promise<ListRecord[]>} listByDate
 * @property {(unitId:string,jobNumber:string)=>Promise<object[]>} tenderDetail
 */
export {};
