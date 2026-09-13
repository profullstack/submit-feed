import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFeedLinks, guessFeedUrls, looksLikeFeed, COMMON_PATHS, PODCAST_PATHS } from '../src/core.js';

test('findFeedLinks reads rel=alternate in any attribute order', () => {
  const html = `<html><head>
    <link href="/feed.xml" rel="alternate" type="application/rss+xml" title="RSS">
    <link type='application/atom+xml' rel='alternate' href='https://x.org/atom'>
    <link rel="stylesheet alternate" type="text/css" href="/a.css">
    <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    <link rel="alternate" type="application/feed+json" href="feed.json"/>
  </head></html>`;
  assert.deepEqual(findFeedLinks(html, 'https://x.org/blog/post'), [
    'https://x.org/feed.xml',
    'https://x.org/atom',
    'https://x.org/blog/feed.json',
  ]);
  assert.deepEqual(findFeedLinks(null, 'https://x.org'), []);
});

test('guessFeedUrls resolves against the origin, podcast paths on request', () => {
  const plain = guessFeedUrls('https://x.org/some/deep/post');
  assert.equal(plain[0], 'https://x.org/feed');
  assert.equal(plain.length, COMMON_PATHS.length);
  const pod = guessFeedUrls('https://x.org/some/deep/post', { kind: 'podcast' });
  assert.equal(pod.length, COMMON_PATHS.length + PODCAST_PATHS.length);
  assert.ok(pod.includes('https://x.org/podcast.rss'));
  assert.deepEqual(guessFeedUrls('nope'), []);
});

test('looksLikeFeed sniffs bodies served with the wrong type', () => {
  assert.equal(looksLikeFeed('text/plain', '<?xml version="1.0"?><rss version="2.0"><channel/></rss>'), true);
  assert.equal(looksLikeFeed('text/html', '<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true);
  assert.equal(looksLikeFeed('application/rss+xml', ''), true);
  assert.equal(looksLikeFeed('application/json', '{"version":"https://jsonfeed.org/version/1.1","items":[]}'), true);
  assert.equal(looksLikeFeed('application/json', '{"hello":"world"}'), false);
  assert.equal(looksLikeFeed('text/xml', '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"/>'), false);
  assert.equal(looksLikeFeed('text/xml', '<?xml version="1.0"?><opml version="2.0"/>'), false);
  assert.equal(looksLikeFeed('text/html', '<html><body>hi</body></html>'), false);
});
