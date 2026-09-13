import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpml, buildOpml, looksLikeOpml } from '../src/core.js';

test('parseOpml walks folders and dedupes', () => {
  const xml = `<?xml version="1.0"?><opml version="2.0"><head><title>t</title></head><body>
    <outline text="Folder"><outline text="A" type="rss" xmlUrl="https://a.org/feed" htmlUrl="https://a.org"/>
      <outline text="Deeper"><outline title="B" xmlUrl="https://b.org/feed"/></outline></outline>
    <outline text="A again" xmlUrl="https://A.org/feed"/>
    <outline text="Not a feed"/>
  </body></opml>`;
  assert.deepEqual(parseOpml(xml), [
    { url: 'https://a.org/feed', title: 'A', siteUrl: 'https://a.org' },
    { url: 'https://b.org/feed', title: 'B', siteUrl: null },
  ]);
});

test('parseOpml is lenient', () => {
  assert.deepEqual(parseOpml('<opml><body><outline xmlUrl="x'), []);
  assert.deepEqual(parseOpml(''), []);
  assert.deepEqual(parseOpml(null), []);
});

test('looksLikeOpml and buildOpml round-trip', () => {
  const out = buildOpml([{ title: 'A & B', feedUrl: 'https://a.org/feed?x=1&y=2', siteUrl: 'https://a.org' }], 'Mine');
  assert.ok(looksLikeOpml(out));
  assert.ok(!looksLikeOpml('https://a.org\nhttps://b.org'));
  assert.deepEqual(parseOpml(out), [{ url: 'https://a.org/feed?x=1&y=2', title: 'A & B', siteUrl: 'https://a.org' }]);
});
