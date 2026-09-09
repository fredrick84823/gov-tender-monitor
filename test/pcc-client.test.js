/**
 * 全部用假的 fetch 與假的 sleep —— 不碰網路、不真的等待。
 */
import { describe, it, expect } from 'vitest';
import { createPccClient, DEFAULT_BASE_URL } from '../src/pcc-client.js';

const ok = (body) => ({ status: 200, async text() { return JSON.stringify(body); } });
const fail = (status, body = '') => ({ status, async text() { return body; } });

/** 依序回應，並記下每次呼叫 */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`fakeFetch: 沒有預備的回應給 ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  fn.calls = calls;
  return fn;
}

/** 記錄退避時間，但不真的睡 */
function fakeSleep() {
  const waited = [];
  const fn = async (ms) => { waited.push(ms); };
  fn.waited = waited;
  return fn;
}

const client = (fetch, extra = {}) =>
  createPccClient({ fetch, sleep: extra.sleep ?? fakeSleep(), random: () => 0.5, ...extra });

describe('listByDate', () => {
  it('打對網址並回傳 records', async () => {
    const fetch = fakeFetch([ok({ records: [{ filename: 'A' }] })]);
    const c = client(fetch);
    await expect(c.listByDate('20260908')).resolves.toEqual([{ filename: 'A' }]);
    expect(fetch.calls[0].url).toBe(`${DEFAULT_BASE_URL}/listbydate?date=20260908`);
  });

  it('帶瀏覽器樣的 User-Agent，否則 Cloudflare 會 403', async () => {
    const fetch = fakeFetch([ok({ records: [] })]);
    await client(fetch).listByDate('20260908');
    expect(fetch.calls[0].headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
  });

  it('日期不是西元 YYYYMMDD 就直接拒絕，不浪費一次請求', async () => {
    const fetch = fakeFetch([]);
    await expect(client(fetch).listByDate('115/09/08')).rejects.toThrow(/YYYYMMDD/);
    expect(fetch.calls).toHaveLength(0);
  });

  it('回應少了 records 陣列就 fail-loud，不回空陣列充數', async () => {
    const fetch = fakeFetch([ok({ ok: true })]);
    await expect(client(fetch).listByDate('20260908')).rejects.toThrow(/no records array/);
  });
});

describe('tenderDetail', () => {
  it('參數經過 URL 編碼', async () => {
    const fetch = fakeFetch([ok({ records: [{ date: 1 }] })]);
    await client(fetch).tenderDetail('3.5.48', '115PD/516 146');
    expect(fetch.calls[0].url).toBe(
      `${DEFAULT_BASE_URL}/tender?unit_id=3.5.48&job_number=115PD%2F516%20146`,
    );
  });

  it('原樣回傳整個公告歷程，不代為挑選', async () => {
    const history = [{ date: 20260907 }, { date: 20260908 }];
    const fetch = fakeFetch([ok({ records: history })]);
    await expect(client(fetch).tenderDetail('2.1', 'X')).resolves.toEqual(history);
  });
});

describe('429：沒有 Retry-After，只能盲目退避', () => {
  it('先 429 再成功，中間有退避而不是直接放棄', async () => {
    const sleep = fakeSleep();
    const fetch = fakeFetch([
      fail(429, '{"ok":false,"error_code":429,"message":"Too Many Requests"}'),
      ok({ records: [] }),
    ]);
    await expect(client(fetch, { sleep }).listByDate('20260908')).resolves.toEqual([]);
    expect(fetch.calls).toHaveLength(2);
    expect(sleep.waited.some((ms) => ms > 0)).toBe(true);
  });

  it('退避時間隨次數指數成長', async () => {
    const sleep = fakeSleep();
    const fetch = fakeFetch([fail(429), fail(429), fail(429), ok({ records: [] })]);
    await client(fetch, { sleep }).listByDate('20260908');
    const backoffs = sleep.waited.filter((ms) => ms > 0);
    expect(backoffs[1]).toBeGreaterThan(backoffs[0]);
    expect(backoffs[2]).toBeGreaterThan(backoffs[1]);
  });

  it('退避有上限，不會無限膨脹', async () => {
    const sleep = fakeSleep();
    const fetch = fakeFetch([fail(429), fail(429), fail(429), ok({ records: [] })]);
    await client(fetch, { sleep, maxBackoffMs: 3000 }).listByDate('20260908');
    expect(Math.max(...sleep.waited)).toBeLessThanOrEqual(3000);
  });

  it('重試用盡後拋出，訊息含 URL 與 status', async () => {
    const fetch = fakeFetch([fail(429), fail(429), fail(429)]);
    await expect(client(fetch, { maxAttempts: 3 }).listByDate('20260908'))
      .rejects.toThrow(/HTTP 429.*listbydate\?date=20260908|listbydate\?date=20260908.*HTTP 429/s);
  });
});

describe('其他 HTTP 狀態', () => {
  it('5xx 會重試', async () => {
    const fetch = fakeFetch([fail(503), ok({ records: [] })]);
    await expect(client(fetch).listByDate('20260908')).resolves.toEqual([]);
    expect(fetch.calls).toHaveLength(2);
  });

  it('404 立刻拋出，不重試（fail-loud）', async () => {
    const fetch = fakeFetch([fail(404, 'Not Found')]);
    await expect(client(fetch).listByDate('20260908')).rejects.toThrow(/HTTP 404/);
    expect(fetch.calls).toHaveLength(1);
  });

  it('403 立刻拋出 —— 這通常代表 User-Agent 被 Cloudflare 攔了', async () => {
    const fetch = fakeFetch([fail(403, 'Forbidden')]);
    await expect(client(fetch).listByDate('20260908')).rejects.toThrow(/HTTP 403/);
    expect(fetch.calls).toHaveLength(1);
  });

  it('200 但不是 JSON 也要炸，不能當成沒資料', async () => {
    const fetch = fakeFetch([{ status: 200, async text() { return '<html>maintenance</html>'; } }]);
    await expect(client(fetch).listByDate('20260908')).rejects.toThrow(/non-JSON/);
  });

  it('網路層錯誤會重試，用盡才拋', async () => {
    const fetch = fakeFetch([new Error('ECONNRESET'), ok({ records: [] })]);
    await expect(client(fetch).listByDate('20260908')).resolves.toEqual([]);
    expect(fetch.calls).toHaveLength(2);
  });
});

describe('節流', () => {
  it('請求序列化，不會並發打爆速率限制', async () => {
    const order = [];
    let n = 0;
    const fetch = async () => {
      const id = ++n;
      order.push(`start${id}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end${id}`);
      return ok({ records: [] });
    };
    const c = client(fetch);
    await Promise.all([c.listByDate('20260908'), c.listByDate('20260909'), c.listByDate('20260910')]);
    expect(order).toEqual(['start1', 'end1', 'start2', 'end2', 'start3', 'end3']);
  });

  it('相鄰請求之間保持最小間隔', async () => {
    const sleep = fakeSleep();
    const fetch = fakeFetch([ok({ records: [] }), ok({ records: [] })]);
    const c = client(fetch, { sleep, minIntervalMs: 1000 });
    await c.listByDate('20260908');
    await c.listByDate('20260909');
    expect(sleep.waited.some((ms) => ms > 0)).toBe(true);
  });

  it('前一個請求失敗不會卡住後面的請求', async () => {
    const fetch = fakeFetch([fail(404), ok({ records: [{ filename: 'B' }] })]);
    const c = client(fetch);
    await expect(c.listByDate('20260908')).rejects.toThrow();
    await expect(c.listByDate('20260909')).resolves.toEqual([{ filename: 'B' }]);
  });
});

describe('token', () => {
  it('有 token 就帶 Authorization（可解除匿名速率限制）', async () => {
    const fetch = fakeFetch([ok({ records: [] })]);
    await client(fetch, { token: 'abc123' }).listByDate('20260908');
    expect(fetch.calls[0].headers.Authorization).toBe('Bearer abc123');
  });

  it('沒 token 就不帶', async () => {
    const fetch = fakeFetch([ok({ records: [] })]);
    await client(fetch).listByDate('20260908');
    expect(fetch.calls[0].headers.Authorization).toBeUndefined();
  });
});

describe('設定', () => {
  it('沒有可用的 fetch 就在建立時就報錯', () => {
    expect(() => createPccClient({ fetch: null })).toThrow(/no fetch available/);
  });

  it('base URL 尾斜線會被正規化', () => {
    expect(createPccClient({ fetch: async () => ok({}), baseUrl: 'https://x/api/' }).baseUrl)
      .toBe('https://x/api');
  });
});
