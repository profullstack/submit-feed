import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, normalizeUrls, plausibleHost, splitUrls, hostOf } from '../src/core.js';

test('normalizeUrl accepts the three things people paste', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('//example.com/feed'), 'https://example.com/feed');
  assert.equal(normalizeUrl('http://example.com/feed#top'), 'http://example.com/feed');
  assert.equal(normalizeUrl('  Example.COM/Feed.xml '), 'https://example.com/Feed.xml');
});

test('normalizeUrl refuses what must never be fetched', () => {
  for (const bad of ['mailto:a@b.c', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.y/z', '', null, 42]) {
    assert.equal(normalizeUrl(bad), null, String(bad));
  }
});

test('plausibleHost rejects markup that URL parsing lets through', () => {
  assert.equal(plausibleHost('version="1.0"'), false);
  assert.equal(plausibleHost('zombies.)'), false);
  assert.equal(plausibleHost('z.'), false);
  assert.equal(plausibleHost('1.0'), false);
  assert.equal(plausibleHost('localhost'), false);
  assert.equal(plausibleHost('example.co.uk'), true);
  assert.equal(plausibleHost('xn--bcher-kva.de'), true);
  assert.equal(plausibleHost('93.184.216.34'), true);
  assert.equal(plausibleHost('999.1.1.1'), false);
  assert.equal(normalizeUrl('https://version="1.0"/'), null);
});

test('splitUrls and normalizeUrls dedupe and report', () => {
  const raw = splitUrls('a.com, b.com\nA.COM  not a url\tc.com');
  assert.deepEqual(raw, ['a.com', 'b.com', 'A.COM', 'not', 'a', 'url', 'c.com']);
  const r = normalizeUrls(raw);
  assert.deepEqual(r.urls, ['https://a.com/', 'https://b.com/', 'https://c.com/']);
  assert.deepEqual(r.invalid, ['not', 'a', 'url']);
  assert.equal(r.repeated, 1);
});

test('hostOf strips www and the port', () => {
  assert.equal(hostOf('https://www.Example.co.uk:8443/x'), 'example.co.uk');
  assert.equal(hostOf('nope'), null);
});
