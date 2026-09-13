import { looksLikeOpml, parseOpml } from './opml.js';
import { normalizeUrls, splitUrls } from './normalize.js';

/**
 * The submit contract: the one shape every Profullstack directory answers
 * `POST /api/submit` with, so a CLI, an MCP tool or a script written against
 * one site works against the next.
 *
 *   request  JSON  { url } | { urls: [] } | { opml: "<opml…" }  (+ email?)
 *            form  input=<one URL per line>  opml=<file>  email=?
 *   reply    { ok, accepted: [{ url, slug, page, existing }],
 *              rejected: [{ url, error }], queued, total,
 *              submissionId?, statusUrl? }
 *            a browser (Accept: text/html) gets 303 to the page or status URL
 *   limits   429 { ok: false, error: 'rate-limited', retryAfterSeconds }
 *            413 { ok: false, error: 'too-large' }
 */

/** Every error code a submit reply may carry, and what a person should be told. */
export const ERRORS = Object.freeze({
  'invalid-url': 'That is not a web address.',
  'blocked-host': 'That address is private or internal and cannot be fetched.',
  'blocked-redirect': 'That address redirected somewhere private.',
  'no-feed-found': 'No feed was found at that address or on that page.',
  'not-a-podcast': 'There is a feed there, but its items have no audio.',
  'not-eligible': 'That feed does not meet the directory\'s rules.',
  'hosted-platform': 'That feed is on a large hosting platform this directory does not list.',
  timeout: 'The publisher did not answer in time.',
  'fetch-failed': 'The publisher could not be reached.',
  'rate-limited': 'Too many submissions from here for now.',
  'too-large': 'That upload is bigger than this endpoint accepts.',
  'no-feeds-in-opml': 'That OPML file lists no feeds.',
  'bad-request': 'The request was missing a URL, a list or an OPML document.',
});

/**
 * Explain an error code, or the code itself when it is an http-NNN or
 * something newer than this table.
 *
 * @param {string} code
 * @returns {string}
 */
export function explainError(code) {
  const c = String(code ?? '');
  if (ERRORS[c]) return ERRORS[c];
  const m = /^http-(\d+)$/.exec(c);
  if (m) return `The publisher answered HTTP ${m[1]}.`;
  return c || 'Unknown error.';
}

/**
 * Turn whatever arrived at a submit endpoint into one shape.
 *
 * Takes a parsed JSON body, a FormData, or a URLSearchParams. The `opml`
 * field may be a string or a File; a File that turns out to hold a URL list
 * rather than OPML is treated as a list, because people upload .txt files
 * through the OPML picker.
 *
 * @param {unknown} body
 * @param {{ maxEntries?: number }} [opts]
 * @returns {Promise<import('../index.d.ts').Submission>}
 */
export async function parseSubmission(body, opts = {}) {
  const maxEntries = opts.maxEntries ?? 5000;
  /** @type {string[]} */
  let raw = [];
  let email = null;
  let kind = 'url';
  /** @type {Array<{ url: string, title: string, siteUrl: string|null }>} */
  let entries = [];

  const get = (name) => {
    if (!body || typeof body !== 'object') return undefined;
    if (typeof (/** @type {any} */ (body).get) === 'function') return /** @type {any} */ (body).get(name);
    return /** @type {any} */ (body)[name];
  };

  const opml = get('opml');
  const opmlText = await fieldText(opml);
  if (opmlText && opmlText.trim()) {
    if (looksLikeOpml(opmlText)) {
      kind = 'opml';
      entries = parseOpml(opmlText);
      raw = entries.map((e) => e.url);
    } else {
      raw = splitUrls(opmlText);
      kind = raw.length > 1 ? 'list' : 'url';
    }
  }

  if (raw.length === 0) {
    const urls = get('urls');
    if (Array.isArray(urls)) raw = urls.map((u) => String(u ?? ''));
    else if (typeof urls === 'string') raw = splitUrls(urls);
    if (raw.length === 0) {
      const one = get('url') ?? get('input');
      if (typeof one === 'string') raw = splitUrls(one);
    }
    kind = raw.length > 1 ? 'list' : 'url';
  }

  const e = get('email');
  if (typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())) email = e.trim().toLowerCase();

  const truncated = raw.length > maxEntries;
  if (truncated) {
    raw = raw.slice(0, maxEntries);
    entries = entries.slice(0, maxEntries);
  }
  const { urls, invalid, repeated } = normalizeUrls(raw);
  if (kind === 'opml') {
    const byUrl = new Map(entries.map((x) => [x.url, x]));
    entries = raw
      .filter((u) => byUrl.has(u))
      .map((u) => byUrl.get(u))
      .filter((x) => normalizeUrls([x.url]).urls.length === 1);
  } else {
    entries = urls.map((url) => ({ url, title: '', siteUrl: null }));
  }

  return { kind, urls, entries, invalid, repeated, email, truncated, empty: raw.length === 0 };
}

/** @param {unknown} v */
async function fieldText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && typeof (/** @type {any} */ (v).text) === 'function') {
    return String(await /** @type {any} */ (v).text());
  }
  return '';
}

/**
 * Does this request want an HTML answer (a 303) rather than JSON?
 *
 * A form post from a browser says text/html first; fetch(), curl and every
 * agent say application/json or nothing at all.
 *
 * @param {string|null|undefined} accept the Accept header
 * @returns {boolean}
 */
export function wantsHtml(accept) {
  const a = String(accept ?? '').toLowerCase();
  if (!a) return false;
  const html = a.indexOf('text/html');
  const json = a.indexOf('application/json');
  return html >= 0 && (json < 0 || html < json);
}

/**
 * The reply body, with its derived fields filled in.
 *
 * @param {Partial<import('../index.d.ts').SubmitReply>} r
 * @returns {import('../index.d.ts').SubmitReply}
 */
export function submitReply(r) {
  const accepted = r.accepted ?? [];
  const rejected = r.rejected ?? [];
  const queued = r.queued ?? 0;
  return {
    ok: r.ok ?? (accepted.length > 0 || queued > 0),
    accepted,
    rejected,
    queued,
    total: r.total ?? accepted.length + rejected.length + queued,
    ...(r.submissionId ? { submissionId: r.submissionId } : {}),
    ...(r.statusUrl ? { statusUrl: r.statusUrl } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.retryAfterSeconds != null ? { retryAfterSeconds: r.retryAfterSeconds } : {}),
  };
}

/**
 * The `submit_feed` MCP tool, as `tools/list` describes it.
 *
 * The description is the interface: a model picks a tool by reading it and
 * nothing else. `run` is the site's, since it is the part that touches a
 * database; everything a client sees is here so two directories describe the
 * same tool in the same words.
 *
 * @param {{ directory?: string, maxUrls?: number, kind?: 'any'|'podcast'|'blog', run?: Function }} [opts]
 */
export function submitFeedTool(opts = {}) {
  const what = opts.kind === 'podcast' ? 'podcast' : 'feed';
  const directory = opts.directory ?? 'the directory';
  return {
    name: 'submit_feed',
    title: `Add a ${what} to ${directory}`,
    description:
      `Submit one URL or a list of them to ${directory}. A site URL works as well as a feed URL: the feed is discovered from the page. ` +
      'Anyone may submit; there is no account and no review queue. One URL resolves in the call and the answer carries its page; ' +
      'a list may be queued, and the answer says which. Rate limited per caller.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: `${what[0].toUpperCase()}${what.slice(1)} or site URLs. One is fine.`,
          maxItems: opts.maxUrls ?? 200,
        },
      },
      required: ['urls'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    ...(opts.run ? { run: opts.run } : {}),
  };
}

/**
 * The OpenAPI 3.1 `paths` entry for a submit endpoint, for a site that
 * publishes a spec.
 *
 * @param {{ path?: string, summary?: string }} [opts]
 */
export function submitOpenApiPath(opts = {}) {
  const path = opts.path ?? '/api/submit';
  const reply = {
    type: 'object',
    required: ['ok', 'accepted', 'rejected', 'queued', 'total'],
    properties: {
      ok: { type: 'boolean' },
      accepted: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            slug: { type: 'string' },
            page: { type: 'string', format: 'uri' },
            existing: { type: 'boolean' },
          },
        },
      },
      rejected: {
        type: 'array',
        items: {
          type: 'object',
          properties: { url: { type: 'string' }, error: { type: 'string', enum: Object.keys(ERRORS) } },
        },
      },
      queued: { type: 'integer' },
      total: { type: 'integer' },
      submissionId: { type: 'string' },
      statusUrl: { type: 'string', format: 'uri' },
    },
  };
  return {
    [path]: {
      post: {
        summary: opts.summary ?? 'Submit a feed or site URL to the directory',
        operationId: 'submitFeed',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  urls: { type: 'array', items: { type: 'string' } },
                  opml: { type: 'string', description: 'An OPML document' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
            'application/x-www-form-urlencoded': {
              schema: { type: 'object', properties: { input: { type: 'string' }, email: { type: 'string' } } },
            },
            'multipart/form-data': {
              schema: { type: 'object', properties: { opml: { type: 'string', format: 'binary' }, input: { type: 'string' } } },
            },
          },
        },
        responses: {
          200: { description: 'The result of the submission', content: { 'application/json': { schema: reply } } },
          303: { description: 'A browser is sent to the new page or the status page' },
          413: { description: 'Too large', content: { 'application/json': { schema: reply } } },
          429: { description: 'Rate limited; retryAfterSeconds says how long', content: { 'application/json': { schema: reply } } },
        },
      },
    },
  };
}
