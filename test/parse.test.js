import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, plainText, durationSeconds, decodeEntities } from '../src/core.js';

const PODCAST = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
  <title>The Example &amp;#8211; Show</title>
  <link>https://example.org/</link>
  <description><![CDATA[<p>A show about <b>things</b>.</p>]]></description>
  <language>en-us</language>
  <generator>Castopod</generator>
  <podcast:guid>917393e3-d8f1-5ca5-9a3e-6f5a1b3b8a6d</podcast:guid>
  <itunes:author>Jane Doe</itunes:author>
  <itunes:owner><itunes:name>Jane</itunes:name><itunes:email>jane@example.org</itunes:email></itunes:owner>
  <itunes:explicit>yes</itunes:explicit>
  <itunes:image href="https://example.org/art.jpg"/>
  <itunes:category text="Technology"><itunes:category text="Software How-To"/></itunes:category>
  <itunes:category text="History"/>
  <item>
    <title>Episode 2</title>
    <guid isPermaLink="false">ep-2</guid>
    <link>https://example.org/ep2</link>
    <pubDate>Mon, 07 Sep 2026 10:00:00 GMT</pubDate>
    <enclosure url="https://example.org/ep2.mp3" type="audio/mpeg" length="12345"/>
    <itunes:duration>01:02:03</itunes:duration>
    <itunes:summary>Second.</itunes:summary>
  </item>
  <item>
    <title>Episode 1</title>
    <guid>ep-1</guid>
    <pubDate>Mon, 31 Aug 2026 10:00:00 GMT</pubDate>
    <enclosure url="https://example.org/ep1.mp3" type="audio/mpeg" length="0"/>
    <description>First.</description>
  </item>
  <item>
    <title>Show notes only</title>
    <guid>notes</guid>
    <pubDate>Mon, 24 Aug 2026 10:00:00 GMT</pubDate>
    <description>No enclosure.</description>
  </item>
</channel></rss>`;

test('parseFeed reads a podcast channel', () => {
  const f = parseFeed(PODCAST, 'https://example.org/feed.xml');
  assert.ok(f);
  assert.equal(f.format, 'rss');
  assert.equal(f.title, 'The Example – Show');
  assert.equal(f.description, 'A show about things.');
  assert.equal(f.link, 'https://example.org/');
  assert.equal(f.language, 'en-us');
  assert.equal(f.author, 'Jane Doe');
  assert.equal(f.owner, 'Jane');
  assert.equal(f.ownerEmail, 'jane@example.org');
  assert.equal(f.explicit, true);
  assert.equal(f.image, 'https://example.org/art.jpg');
  assert.deepEqual(f.categories, ['Technology', 'Software How-To', 'History']);
  assert.equal(f.generator, 'Castopod');
  assert.equal(f.podcastGuid, '917393e3-d8f1-5ca5-9a3e-6f5a1b3b8a6d');
  assert.equal(f.kind, 'podcast');
  assert.equal(f.itemCount, 3);
  assert.equal(f.episodeCount, 2);
  assert.equal(f.newestPublished, '2026-09-07T10:00:00.000Z');
  assert.equal(f.oldestPublished, '2026-08-24T10:00:00.000Z');
  const ep = f.items[0];
  assert.equal(ep.id, 'ep-2');
  assert.equal(ep.title, 'Episode 2');
  assert.equal(ep.link, 'https://example.org/ep2');
  assert.deepEqual(ep.media, { url: 'https://example.org/ep2.mp3', type: 'audio/mpeg', bytes: 12345, seconds: 3723, kind: 'audio' });
  assert.equal(f.items[1].media.bytes, null);
  assert.equal(f.items[2].media, null);
});

test('parseFeed reads a blog and calls it one', () => {
  const xml = `<rss version="2.0"><channel><title>Blog</title><link>https://b.org</link><description>d</description>
    <item><title>One</title><link>https://b.org/1</link><pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate><description>x</description></item>
    <item><title>Two</title><link>https://b.org/2</link></item>
  </channel></rss>`;
  const f = parseFeed(xml, 'https://b.org/feed');
  assert.equal(f.kind, 'blog');
  assert.equal(f.episodeCount, 0);
  assert.equal(f.items[1].published, null);
  assert.equal(f.items[1].id, 'https://b.org/2');
});

test('parseFeed reads Atom', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xml:lang="de">
    <title>Atom Cast</title><subtitle>sub</subtitle><logo>https://a.org/logo.png</logo>
    <link rel="alternate" href="https://a.org/"/><link rel="self" href="https://a.org/atom"/>
    <author><name>Alice</name></author>
    <entry><id>urn:1</id><title>E1</title><updated>2026-09-01T00:00:00Z</updated>
      <link rel="alternate" href="https://a.org/1"/><link rel="enclosure" href="https://a.org/1.mp3" type="audio/mpeg" length="5"/>
      <summary>s</summary></entry>
  </feed>`;
  const f = parseFeed(xml, 'https://a.org/atom');
  assert.equal(f.format, 'atom');
  assert.equal(f.title, 'Atom Cast');
  assert.equal(f.language, 'de');
  assert.equal(f.author, 'Alice');
  assert.equal(f.link, 'https://a.org/');
  assert.equal(f.image, 'https://a.org/logo.png');
  assert.equal(f.kind, 'podcast');
  assert.equal(f.items[0].link, 'https://a.org/1');
  assert.equal(f.items[0].media.url, 'https://a.org/1.mp3');
});

test('parseFeed reads JSON Feed', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'JF',
    home_page_url: 'https://j.org',
    icon: 'https://j.org/i.png',
    authors: [{ name: 'Jo' }],
    items: [
      { id: '1', url: 'https://j.org/1', title: 'One', date_published: '2026-09-02T00:00:00Z', content_html: '<p>hi</p>',
        attachments: [{ url: 'https://j.org/1.m4a', mime_type: 'audio/x-m4a', size_in_bytes: 9, duration_in_seconds: 61.4 }] },
    ],
  });
  const f = parseFeed(json, 'https://j.org/feed.json');
  assert.equal(f.format, 'json');
  assert.equal(f.title, 'JF');
  assert.equal(f.author, 'Jo');
  assert.equal(f.kind, 'podcast');
  assert.deepEqual(f.items[0].media, { url: 'https://j.org/1.m4a', type: 'audio/x-m4a', bytes: 9, seconds: 61, kind: 'audio' });
  assert.equal(f.items[0].description, 'hi');
});

test('parseFeed reads RSS 1.0 with items beside the channel', () => {
  const xml = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
    <channel rdf:about="https://r.org/"><title>RDF</title><link>https://r.org/</link><description>d</description></channel>
    <item rdf:about="https://r.org/1"><title>I1</title><link>https://r.org/1</link><dc:date>2026-09-01T00:00:00Z</dc:date></item>
  </rdf:RDF>`;
  const f = parseFeed(xml, 'https://r.org/rss');
  assert.equal(f.title, 'RDF');
  assert.equal(f.items.length, 1);
  assert.equal(f.items[0].published, '2026-09-01T00:00:00.000Z');
});

test('parseFeed returns null for non-feeds', () => {
  assert.equal(parseFeed('<html><body>no</body></html>'), null);
  assert.equal(parseFeed('{"hello":1}'), null);
  assert.equal(parseFeed(''), null);
  assert.equal(parseFeed('<<<'), null);
});

test('text helpers', () => {
  assert.equal(plainText('<p>Hello&amp;#8217;s <br> world&nbsp;&#x41;</p>'), 'Hello’s world A');
  assert.equal(decodeEntities('&amp;amp;'), '&');
  assert.equal(durationSeconds('90'), 90);
  assert.equal(durationSeconds('1:30'), 90);
  assert.equal(durationSeconds('1:01:30'), 3690);
  assert.equal(durationSeconds('x'), null);
  assert.equal(durationSeconds(''), null);
});
