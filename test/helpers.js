import { createApp } from '../server/index.js';

/** Start an app on a random port with a controllable clock. */
export async function startApp(opts = {}) {
  const clock = { t: Date.parse('2026-10-30T03:00:00Z') }; // Fri 30 Oct 2026, 10:00 in Bangkok
  // rate limiting is off by default so tests that share one frozen clock don't trip it
  const app = createApp({ now: () => clock.t, rateLimit: false, ...opts });
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  return { app, base, clock, port, close: () => app.close() };
}

/** Minimal fetch wrapper with a cookie jar. */
export function client(base) {
  let cookie = '';
  async function call(method, path, body, { headers = {}, raw = false } = {}) {
    const opts = { method, headers: { ...headers } };
    if (cookie) opts.headers.cookie = cookie;
    if (body !== undefined) {
      if (raw) opts.body = body;
      else {
        opts.headers['content-type'] ??= 'application/json';
        opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }
    const res = await fetch(base + path, opts);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const m = setCookie.match(/ojsid=([^;]*)/);
      cookie = m && m[1] ? `ojsid=${m[1]}` : '';
    }
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    call,
    get: (p, o) => call('GET', p, undefined, o),
    post: (p, b, o) => call('POST', p, b ?? {}, o),
    del: (p, b, o) => call('DELETE', p, b ?? {}, o),
    get cookie() { return cookie; },
    set cookie(v) { cookie = v; },
  };
}

let n = 0;
export async function signUp(c, name = 'Test User') {
  n += 1;
  const email = `tester${n}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Pw${Math.random().toString(36).slice(2, 10)}9x`;
  const res = await c.post('/api/auth/register', { name, email, password, consent: true });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.data)}`);
  return { email, password, user: res.data.user };
}

export const HOUR = 3600 * 1000;
