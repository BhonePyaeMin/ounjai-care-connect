export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, rawBody, contentType } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (rawBody !== undefined) {
    opts.body = rawBody;
    opts.headers['Content-Type'] = contentType;
  } else if (method !== 'GET' && method !== 'HEAD') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body ?? {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.details);
  return data;
}

let configPromise;
export const getConfig = () => (configPromise ||= api('/api/config'));

export function safeNext(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';
}
