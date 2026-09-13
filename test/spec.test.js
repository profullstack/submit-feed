import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSubmission, wantsHtml, submitReply, submitFeedTool, submitOpenApiPath, explainError, ERRORS } from '../src/core.js';

test('parseSubmission reads JSON shapes', async () => {
  let s = await parseSubmission({ url: 'example.com' });
  assert.equal(s.kind, 'url');
  assert.deepEqual(s.urls, ['https://example.com/']);
  s = await parseSubmission({ urls: ['a.com', 'b.com', 'a.com', 'nope'] , email: 'Me@Example.com' });
  assert.equal(s.kind, 'list');
  assert.deepEqual(s.urls, ['https://a.com/', 'https://b.com/']);
  assert.deepEqual(s.invalid, ['nope']);
  assert.equal(s.repeated, 1);
  assert.equal(s.email, 'me@example.com');
  s = await parseSubmission({ url: 'a.com b.com' });
  assert.equal(s.kind, 'list');
  s = await parseSubmission({});
  assert.equal(s.empty, true);
});

test('parseSubmission reads a form, and a URL list uploaded as OPML', async () => {
  const form = new FormData();
  form.set('input', 'a.com\nb.com');
  form.set('email', 'not an email');
  let s = await parseSubmission(form);
  assert.deepEqual(s.urls, ['https://a.com/', 'https://b.com/']);
  assert.equal(s.email, null);

  const opml = new FormData();
  opml.set('opml', new File(['<opml version="2.0"><body><outline text="X" xmlUrl="https://x.org/feed"/></body></opml>'], 'subs.opml'));
  s = await parseSubmission(opml);
  assert.equal(s.kind, 'opml');
  assert.deepEqual(s.urls, ['https://x.org/feed']);
  assert.deepEqual(s.entries, [{ url: 'https://x.org/feed', title: 'X', siteUrl: null }]);

  const txt = new FormData();
  txt.set('opml', new File(['https://x.org\nhttps://y.org'], 'list.txt'));
  s = await parseSubmission(txt);
  assert.equal(s.kind, 'list');
  assert.deepEqual(s.urls, ['https://x.org/', 'https://y.org/']);
});

test('parseSubmission caps the list', async () => {
  const s = await parseSubmission({ urls: ['a.com', 'b.com', 'c.com'] }, { maxEntries: 2 });
  assert.equal(s.truncated, true);
  assert.equal(s.urls.length, 2);
});

test('wantsHtml', () => {
  assert.equal(wantsHtml('text/html,application/xhtml+xml,*/*;q=0.8'), true);
  assert.equal(wantsHtml('application/json'), false);
  assert.equal(wantsHtml('application/json, text/html'), false);
  assert.equal(wantsHtml('*/*'), false);
  assert.equal(wantsHtml(null), false);
});

test('submitReply fills derived fields', () => {
  const r = submitReply({ accepted: [{ url: 'a', slug: 'a', page: 'p', existing: false }], rejected: [{ url: 'b', error: 'no-feed-found' }] });
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.equal(r.queued, 0);
  assert.equal(submitReply({ rejected: [{ url: 'b', error: 'x' }] }).ok, false);
  assert.equal(submitReply({ queued: 3 }).ok, true);
  assert.equal(submitReply({ error: 'rate-limited', retryAfterSeconds: 60 }).retryAfterSeconds, 60);
});

test('submitFeedTool and the OpenAPI path describe the contract', () => {
  const t = submitFeedTool({ directory: 'p0dcasters', kind: 'podcast', maxUrls: 50 });
  assert.equal(t.name, 'submit_feed');
  assert.match(t.title, /podcast/);
  assert.equal(t.inputSchema.properties.urls.maxItems, 50);
  assert.deepEqual(t.inputSchema.required, ['urls']);
  assert.equal('run' in t, false);
  const withRun = submitFeedTool({ run: async () => 1 });
  assert.equal(typeof withRun.run, 'function');
  const p = submitOpenApiPath({ path: '/api/submit' });
  assert.ok(p['/api/submit'].post.responses[429]);
  assert.deepEqual(p['/api/submit'].post.responses[200].content['application/json'].schema.properties.rejected.items.properties.error.enum, Object.keys(ERRORS));
});

test('explainError', () => {
  assert.equal(explainError('no-feed-found'), ERRORS['no-feed-found']);
  assert.equal(explainError('http-404'), 'The publisher answered HTTP 404.');
  assert.equal(explainError('weird'), 'weird');
});
