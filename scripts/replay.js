/**
 * 離線重播：用已擷取的真實資料當資料源，行為與 PccClient 完全一致。
 *
 * 「可重現」不該依賴網路。同一份輸入必須在任何人的機器上得到同一份輸出，
 * 所以驗證走這條路，不打 API。
 */
import { readFileSync } from 'node:fs';

/** @returns {import('../src/contracts.js').PccClient} */
export function createReplayClient(dataPath = new URL('../web/data/demo-data.json', import.meta.url)) {
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));

  return {
    async listByDate(date) {
      const day = data.days[date];
      if (!day) throw new Error(`重播資料不含 ${date}（有：${Object.keys(data.days).join(', ')}）`);
      return day.records;
    },
    async tenderDetail(unitId, jobNumber) {
      // 擷取時是以 filename 為鍵，這裡反查同一案件的所有公告
      const hits = [];
      for (const day of Object.values(data.days)) {
        for (const r of day.records) {
          if (r.unit_id === unitId && r.job_number === jobNumber && day.details[r.filename]) {
            const d = day.details[r.filename];
            hits.push({
              filename: r.filename,
              date: r.date,
              detail: {
                '採購資料:預算金額': d.budget,
                '採購資料:預算金額是否公開': d.budgetPublic ? '是' : '否\n預算金額涉及商業機密',
                '採購資料:採購金額級距': d.budgetBand,
                '領投開標:截止投標': d.deadline,
                '招標資料:公告日': d.announcedOn,
                '招標資料:招標方式': d.tenderMethod,
                '採購資料:標的分類': d.category,
                pkPmsMain: d.pkPmsMain,
              },
            });
          }
        }
      }
      return hits;
    },
  };
}
