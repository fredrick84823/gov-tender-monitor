/**
 * 政府採購網資料源 client（openfun 鏡像 API）。
 *
 * 實作 contracts.js 的 `PccClient`：
 *   - listByDate(date)             -> Promise<ListRecord[]>
 *   - tenderDetail(unitId, jobNum) -> Promise<object[]>
 *
 * 經驗事實（實測，勿「修正」）：
 *   1. base URL 必須是 https://pcc-api.openfun.app/api。
 *      舊的 pcc.g0v.ronny.tw 會 301 且把 path 丟掉。
 *   2. 必須帶瀏覽器樣的 User-Agent，否則 Cloudflare 直接 403。
 *   3. 匿名速率大約是「7 秒內 10 次」，觸發後約 16 秒才恢復。
 *      所以預設把請求序列化並保證最小間隔（1 req/s）。
 *   4. 429 的 response 是 content-type: text/html，沒有 Retry-After、
 *      也沒有 RateLimit-* header，body 才是 JSON。只能盲目退避。
 *   5. fail-loud：非 2xx 且不可重試者一律 throw，錯誤訊息要含 URL 與 status。
 */

const DEFAULT_BASE_URL = 'https://pcc-api.openfun.app/api';

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {object} [options]
 * @param {string} [options.baseUrl]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {(ms:number)=>Promise<void>} [options.sleep]
 * @param {string|null} [options.token]      openfun API token（免速率限制）
 * @param {number} [options.minIntervalMs]   兩次請求之間的最小間隔
 * @param {number} [options.maxAttempts]     含首次嘗試在內的總次數
 * @param {number} [options.baseBackoffMs]   指數退避基數
 * @param {number} [options.maxBackoffMs]    單次退避上限
 * @param {()=>number} [options.random]      jitter 來源，測試可注入
 * @param {string} [options.userAgent]
 * @returns {import('./contracts.js').PccClient & {baseUrl:string}}
 */
export function createPccClient({
  baseUrl = DEFAULT_BASE_URL,
  fetch = globalThis.fetch,
  sleep = defaultSleep,
  token = null,
  minIntervalMs = 1000,
  maxAttempts = 5,
  baseBackoffMs = 2000,
  maxBackoffMs = 60000,
  random = Math.random,
  userAgent = DEFAULT_USER_AGENT,
} = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('createPccClient: no fetch available; inject one via { fetch }');
  }

  const root = String(baseUrl).replace(/\/+$/, '');

  const headers = {
    'User-Agent': userAgent,
    Accept: 'application/json',
    'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // ---- throttle：序列化 + 最小間隔 -------------------------------------
  let chain = Promise.resolve();
  let nextAllowedAt = 0;

  function schedule(task) {
    const run = chain.then(async () => {
      const now = Date.now();
      const wait = nextAllowedAt - now;
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        nextAllowedAt = Date.now() + minIntervalMs;
      }
    });
    // 讓後續請求不受前一個失敗影響，但仍然排在它後面
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function backoffFor(attempt) {
    const exp = Math.min(baseBackoffMs * 2 ** (attempt - 1), maxBackoffMs);
    // full jitter，避免多個 client 同步重試
    return Math.round(exp / 2 + random() * (exp / 2));
  }

  async function readBody(response) {
    try {
      return await response.text();
    } catch {
      return '';
    }
  }

  /** 送出一次請求（已在 throttle 內），含 429/5xx 退避重試。 */
  async function request(url) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        response = await fetch(url, { headers });
      } catch (cause) {
        // 網路層錯誤：視為可重試
        lastError = new Error(`PCC request failed: GET ${url}: ${cause?.message ?? cause}`, {
          cause,
        });
        if (attempt === maxAttempts) throw lastError;
        await sleep(backoffFor(attempt));
        continue;
      }

      const status = response.status;

      if (status >= 200 && status < 300) {
        const text = await readBody(response);
        try {
          return JSON.parse(text);
        } catch (cause) {
          throw new Error(
            `PCC returned non-JSON body: GET ${url} (status ${status}): ` +
              `${text.slice(0, 200)}`,
            { cause },
          );
        }
      }

      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable) {
        // fail-loud：4xx（含 403 Cloudflare、404）立即炸掉
        const body = (await readBody(response)).slice(0, 200);
        throw new Error(`PCC request failed: GET ${url} -> HTTP ${status}. ${body}`);
      }

      const body = (await readBody(response)).slice(0, 200);
      lastError = new Error(
        `PCC request failed: GET ${url} -> HTTP ${status} after ${attempt} attempt(s). ${body}`,
      );
      if (attempt === maxAttempts) throw lastError;
      await sleep(backoffFor(attempt));
    }

    /* c8 ignore next */
    throw lastError ?? new Error(`PCC request failed: GET ${url}`);
  }

  const get = (url) => schedule(() => request(url));

  return {
    baseUrl: root,

    /**
     * 一次拿整天的公告清單（無分頁，約 1800-2400 筆）。
     * @param {string} date 西元 "YYYYMMDD"
     * @returns {Promise<import('./contracts.js').ListRecord[]>}
     */
    async listByDate(date) {
      if (!/^\d{8}$/.test(String(date))) {
        throw new Error(`listByDate: date must be "YYYYMMDD" (西元), got ${JSON.stringify(date)}`);
      }
      const url = `${root}/listbydate?date=${date}`;
      const payload = await get(url);
      const records = payload?.records;
      if (!Array.isArray(records)) {
        throw new Error(`PCC listbydate returned no records array: GET ${url}`);
      }
      return records;
    },

    /**
     * 單一標案的完整公告歷程（1-7 筆，各含 detail）。原樣回傳，不挑。
     * @param {string} unitId
     * @param {string} jobNumber
     * @returns {Promise<object[]>}
     */
    async tenderDetail(unitId, jobNumber) {
      const url =
        `${root}/tender?unit_id=${encodeURIComponent(unitId)}` +
        `&job_number=${encodeURIComponent(jobNumber)}`;
      const payload = await get(url);
      const records = payload?.records;
      if (!Array.isArray(records)) {
        throw new Error(`PCC tender returned no records array: GET ${url}`);
      }
      return records;
    },
  };
}

export { DEFAULT_BASE_URL, DEFAULT_USER_AGENT };
export default createPccClient;
