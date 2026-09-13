/**
 * A client for any endpoint that speaks the submit contract.
 */

export class SubmitError extends Error {
  /**
   * @param {string} message
   * @param {{ status: number, code?: string, retryAfterSeconds?: number|null, body?: unknown }} info
   */
  constructor(message, info) {
    super(message);
    this.name = 'SubmitError';
    this.status = info.status;
    this.code = info.code ?? null;
    this.retryAfterSeconds = info.retryAfterSeconds ?? null;
    this.body = info.body;
  }
}

/**
 * Submit to a site.
 *
 * @param {string} site the site's origin, e.g. https://p0dcasters.com
 * @param {{ url?: string, urls?: string[], opml?: string, email?: string }} what
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal, path?: string, headers?: Record<string, string> }} [opts]
 * @returns {Promise<import('../index.d.ts').SubmitReply>}
 */
export async function submitFeed(site, what, opts = {}) {
  const base = String(site ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new SubmitError('site must be an http(s) origin', { status: 0 });
  const doFetch = opts.fetch ?? globalThis.fetch;

  /** @type {Record<string, unknown>} */
  const payload = {};
  if (what?.opml) payload.opml = what.opml;
  else if (Array.isArray(what?.urls) && what.urls.length) payload.urls = what.urls;
  else if (what?.url) payload.url = what.url;
  else throw new SubmitError('nothing to submit', { status: 0, code: 'bad-request' });
  if (what?.email) payload.email = what.email;

  const res = await doFetch(`${base}${opts.path ?? '/api/submit'}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify(payload),
    signal: opts.signal,
  });

  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const code = body?.error ?? (res.status === 429 ? 'rate-limited' : res.status === 413 ? 'too-large' : `http-${res.status}`);
    const retry = body?.retryAfterSeconds ?? null;
    throw new SubmitError(`${base} answered ${res.status}${code ? ` (${code})` : ''}`, {
      status: res.status,
      code,
      retryAfterSeconds: retry,
      body,
    });
  }
  if (!body || typeof body !== 'object') {
    throw new SubmitError(`${base} did not answer with JSON`, { status: res.status, body: text });
  }
  return body;
}
