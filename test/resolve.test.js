import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFeed, safeFetch } from '../src/index.js';

const lookup = async () => ['93.184.216.34'];

const RSS = (items) => `<rss version="2.0"><channel><title>T</title><link>https://s.org</link><description>d</description>${items}</channel></rss>`;
const EP = '<item><title>E</title><guid>e</guid><enclosure url="https://s.org/e.mp3" type="audio/mpeg"/></item>';
const POST = '<item><title>P</title><link>https://s.org/p</link></item>';

/** @param {Record<string, { status?: number, type?: string, body?: string, redirect?: string }>} routes */
function fakeFetch(routes) {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (!r) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
    const res = new Response(r.body ?? '', { status: r.status ?? 200, headers: { 'content-type': r.type ?? 'text/html', ...(r.headers ?? {}) } });
    Object.defineProperty(res, 'url', { value: r.redirect ?? url });
    return res;
  };
  return { fetch, calls };
}

test('resolveFeed takes a feed URL as-is', async () => {
  const { fetch, calls } = fakeFetch({ 'https://s.org/feed.xml': { type: 'application/rss+xml', body: RSS(EP) } });
  const r = await resolveFeed('s.org/feed.xml', { fetch, lookup });
  assert.equal(r.ok, true);
  assert.equal(r.feedUrl, 'https://s.org/feed.xml');
  assert.equal(r.feed.kind, 'podcast');
  assert.equal(calls.length, 1);
});

test('resolveFeed discovers from the page before guessing', async () => {
  const { fetch, calls } = fakeFetch({
    'https://s.org/': { body: '<html><link rel="alternate" type="application/rss+xml" href="/rss/show"></html>' },
    'https://s.org/rss/show': { type: 'text/plain', body: RSS(EP) },
  });
  const r = await resolveFeed('https://s.org', { fetch, lookup });
  assert.equal(r.ok, true);
  assert.equal(r.feedUrl, 'https://s.org/rss/show');
  assert.deepEqual(calls, ['https://s.org/', 'https://s.org/rss/show']);
});

test('resolveFeed falls back to conventional paths, podcast ones on request', async () => {
  const { fetch } = fakeFetch({
    'https://s.org/': { body: '<html>no links</html>' },
    'https://s.org/podcast.rss': { type: 'application/xml', body: RSS(EP) },
  });
  const plain = await resolveFeed('https://s.org', { fetch, lookup });
  assert.equal(plain.ok, false);
  assert.equal(plain.error, 'no-feed-found');
  const pod = await resolveFeed('https://s.org', { fetch, lookup, kind: 'podcast' });
  assert.equal(pod.ok, true);
  assert.equal(pod.feedUrl, 'https://s.org/podcast.rss');
});

test('resolveFeed refuses a blog when a podcast was asked for', async () => {
  const { fetch } = fakeFetch({ 'https://s.org/feed': { type: 'application/rss+xml', body: RSS(POST + POST) } });
  const r = await resolveFeed('https://s.org/feed', { fetch, lookup, kind: 'podcast' });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not-a-podcast');
  assert.equal(r.feed.title, 'T');
  const ok = await resolveFeed('https://s.org/feed', { fetch, lookup });
  assert.equal(ok.ok, true);
  assert.equal(ok.feed.kind, 'blog');
});

test('resolveFeed reports http errors and throttles', async () => {
  const { fetch } = fakeFetch({
    'https://s.org/gone': { status: 404 },
    'https://s.org/busy': { status: 429, headers: { 'retry-after': '90' } },
  });
  assert.deepEqual(await resolveFeed('https://s.org/gone', { fetch, lookup }), { ok: false, url: 'https://s.org/gone', error: 'http-404' });
  const busy = await resolveFeed('https://s.org/busy', { fetch, lookup });
  assert.equal(busy.throttled, true);
  assert.equal(busy.retryAfter, 90);
  assert.equal((await resolveFeed('mailto:x@y.z', { fetch, lookup })).error, 'invalid-url');
});

test('safeFetch blocks private hosts, private redirects and oversize bodies', async () => {
  const blocked = await safeFetch('http://10.0.0.1/feed', { fetch: async () => { throw new Error('should not fetch'); } });
  assert.equal(blocked.error, 'blocked-host');
  const { fetch } = fakeFetch({ 'https://s.org/r': { body: 'x', redirect: 'http://169.254.169.254/latest/meta-data' } });
  const redirect = await safeFetch('https://s.org/r', { fetch, lookup });
  assert.equal(redirect.error, 'blocked-redirect');
  const big = await safeFetch('https://s.org/big', { lookup, fetch: async () => new Response('a'.repeat(1000), { status: 200 }) , maxBytes: 100 });
  assert.equal(big.ok, true);
  assert.equal(big.body.length, 100);
  const slow = await safeFetch('https://s.org/slow', { lookup, timeoutMs: 20, fetch: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) });
  assert.equal(slow.error, 'timeout');
});
