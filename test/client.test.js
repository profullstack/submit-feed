import { test } from 'node:test';
import assert from 'node:assert/strict';
import { submitFeed, SubmitError } from '../src/core.js';

function fakeFetch(status, body, headers = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  };
  return { fetch, calls };
}

test('submitFeed posts the contract and returns the reply', async () => {
  const { fetch, calls } = fakeFetch(200, { ok: true, accepted: [{ slug: 'x' }], rejected: [], queued: 0, total: 1 });
  const reply = await submitFeed('https://p0dcasters.com/', { url: 'example.org' }, { fetch });
  assert.equal(reply.accepted[0].slug, 'x');
  assert.equal(calls[0].url, 'https://p0dcasters.com/api/submit');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'example.org' });
  assert.equal(calls[0].init.headers.accept, 'application/json');
});

test('submitFeed prefers opml, then urls, then url', async () => {
  const { fetch, calls } = fakeFetch(200, { ok: true, accepted: [], rejected: [], queued: 2, total: 2 });
  await submitFeed('https://s.com', { urls: ['a', 'b'], url: 'c', email: 'e@x.y' }, { fetch });
  assert.deepEqual(JSON.parse(calls[0].init.body), { urls: ['a', 'b'], email: 'e@x.y' });
  await submitFeed('https://s.com', { opml: '<opml/>' }, { fetch });
  assert.deepEqual(JSON.parse(calls[1].init.body), { opml: '<opml/>' });
});

test('submitFeed surfaces rate limits with the retry hint', async () => {
  const { fetch } = fakeFetch(429, { ok: false, error: 'rate-limited', retryAfterSeconds: 3600 });
  await assert.rejects(
    () => submitFeed('https://s.com', { url: 'a' }, { fetch }),
    (err) => err instanceof SubmitError && err.status === 429 && err.code === 'rate-limited' && err.retryAfterSeconds === 3600,
  );
});

test('submitFeed refuses bad input before the network', async () => {
  await assert.rejects(() => submitFeed('s.com', { url: 'a' }), /origin/);
  await assert.rejects(() => submitFeed('https://s.com', {}), (e) => e.code === 'bad-request');
});

test('submitFeed rejects a non-JSON answer', async () => {
  const { fetch } = fakeFetch(200, '<html>', { 'content-type': 'text/html' });
  await assert.rejects(() => submitFeed('https://s.com', { url: 'a' }, { fetch }), /JSON/);
});
