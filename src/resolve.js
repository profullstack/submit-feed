import { findFeedLinks, guessFeedUrls, looksLikeFeed } from './discover.js';
import { isBlockedAddress, isIPv4, isIPv6, isInternalName, retryAfterSeconds } from './net.js';
import { normalizeUrl } from './normalize.js';
import { parseFeed } from './parse.js';

/**
 * Resolve a hostname and refuse if any address is internal.
 *
 * Every resolved address is checked, not just the first: a hostname with both
 * a public and a private A record would otherwise slip through.
 *
 * @param {string} hostname
 * @param {{ lookup?: (hostname: string) => Promise<string[]> }} [opts]
 *   `lookup` returns every address for the name; defaults to node:dns
 * @returns {Promise<boolean>} true when safe to fetch
 */
export async function isPublicHost(hostname, opts = {}) {
  const bare = String(hostname ?? '').replace(/^\[|\]$/g, '');
  if (isIPv4(bare) || isIPv6(bare)) return !isBlockedAddress(bare);
  if (isInternalName(bare)) return false;

  const lookup = opts.lookup ?? defaultLookup;
  try {
    const addrs = await lookup(bare);
    if (!addrs || addrs.length === 0) return false;
    return addrs.every((a) => !isBlockedAddress(a));
  } catch {
    return false;
  }
}

/** @param {string} hostname */
async function defaultLookup(hostname) {
  const dns = await import('node:dns/promises');
  const addrs = await dns.lookup(hostname, { all: true });
  return addrs.map((a) => a.address);
}

export const DEFAULT_USER_AGENT =
  'submit-feed/0.1 (+https://github.com/profullstack/submit-feed; feed directory)';
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Fetch a URL with the guards a submit endpoint needs: the private-address
 * check on the name and again on the redirect target, a timeout, and a
 * response size cap so a hostile endpoint cannot stream the process out of
 * memory.
 *
 * @param {string} url
 * @param {import('../index.d.ts').FetchOptions} [opts]
 * @returns {Promise<import('../index.d.ts').SafeFetchResult>}
 */
export async function safeFetch(url, opts = {}) {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return { ok: false, status: 0, contentType: '', body: '', url: String(url ?? ''), error: 'invalid-url' };
  }

  const lookup = opts.lookup;
  const target = new URL(normalized);
  if (!(await isPublicHost(target.hostname, { lookup }))) {
    return { ok: false, status: 0, contentType: '', body: '', url: normalized, error: 'blocked-host' };
  }

  const doFetch = opts.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const headers = {
      'user-agent': opts.userAgent ?? DEFAULT_USER_AGENT,
      accept: 'application/rss+xml, application/atom+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
      ...(opts.headers ?? {}),
    };
    const res = await doFetch(normalized, { headers, redirect: 'follow', signal: controller.signal });

    // A redirect can land somewhere internal even when the origin was public.
    const finalUrl = res.url || normalized;
    const finalHost = new URL(finalUrl).hostname;
    if (finalHost !== target.hostname && !(await isPublicHost(finalHost, { lookup }))) {
      return { ok: false, status: res.status, contentType: '', body: '', url: finalUrl, error: 'blocked-redirect' };
    }

    const body = await readCapped(res, opts.maxBytes ?? DEFAULT_MAX_BYTES);
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') ?? '',
      body,
      url: finalUrl,
      retryAfter: retryAfterSeconds(res.headers.get('retry-after')),
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError' || opts.signal?.aborted;
    return {
      ok: false,
      status: 0,
      contentType: '',
      body: '',
      url: normalized,
      error: aborted ? 'timeout' : 'fetch-failed',
    };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Read a body up to a byte cap, decoding as it goes.
 *
 * @param {Response} res
 * @param {number} maxBytes
 */
async function readCapped(res, maxBytes) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const whole = await res.text();
    return whole.length > maxBytes ? whole.slice(0, maxBytes) : whole;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = '';
  let seen = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > maxBytes) {
      out += decoder.decode(value.subarray(0, value.byteLength - (seen - maxBytes)), { stream: true });
      await reader.cancel().catch(() => {});
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

/**
 * Resolve whatever a person submitted into a parsed feed.
 *
 * Tries, in order: the URL itself as a feed, any feed advertised by the
 * page's <link rel="alternate"> tags, then a short list of conventional
 * paths. Stops at the first thing that parses and has at least one item.
 * With `kind: 'podcast'` the podcast paths are tried too, and a feed whose
 * items carry no audio is refused with `not-a-podcast`, because a directory
 * of podcasts would rather say so than list a blog.
 *
 * @param {string} input a site URL or a feed URL
 * @param {import('../index.d.ts').ResolveOptions} [opts]
 * @returns {Promise<import('../index.d.ts').ResolveResult>}
 */
export async function resolveFeed(input, opts = {}) {
  const start = normalizeUrl(input);
  if (!start) return { ok: false, error: 'invalid-url', url: String(input ?? '') };

  const wantPodcast = opts.kind === 'podcast';
  const first = await safeFetch(start, opts);
  if (!first.ok) {
    const throttled = first.status === 429 || (first.status === 503 && first.retryAfter != null);
    return {
      ok: false,
      url: start,
      error: first.error ?? `http-${first.status}`,
      ...(throttled ? { throttled: true, retryAfter: first.retryAfter ?? null } : {}),
    };
  }

  /** @type {string[]} */
  const tried = [first.url];
  /** @type {import('../index.d.ts').ParsedFeed|null} */
  let rejected = null;

  if (looksLikeFeed(first.contentType, first.body)) {
    const feed = parseFeed(first.body, first.url);
    if (feed) {
      if (!wantPodcast || feed.episodeCount > 0) return { ok: true, feedUrl: first.url, feed, tried };
      rejected = feed;
    }
  }

  const candidates = [...findFeedLinks(first.body, first.url), ...guessFeedUrls(first.url, { kind: opts.kind })];
  const seen = new Set([first.url]);
  const maxCandidates = opts.maxCandidates ?? candidates.length;
  let attempts = 0;
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (attempts >= maxCandidates) break;
    attempts += 1;
    tried.push(candidate);

    const res = await safeFetch(candidate, opts);
    if (!res.ok) continue;
    if (!looksLikeFeed(res.contentType, res.body)) continue;

    const feed = parseFeed(res.body, res.url);
    if (!feed || feed.items.length === 0) continue;
    if (wantPodcast && feed.episodeCount === 0) {
      rejected = rejected ?? feed;
      continue;
    }
    return { ok: true, feedUrl: res.url, feed, tried };
  }

  if (rejected) return { ok: false, url: start, error: 'not-a-podcast', feed: rejected, tried };
  return { ok: false, url: start, error: 'no-feed-found', tried };
}
