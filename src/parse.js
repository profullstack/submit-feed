import { XMLParser } from 'fast-xml-parser';

/**
 * Channel-level feed parsing: what a directory needs to list a feed, and
 * enough of each item to tell a podcast from a blog and to say when it last
 * published. Not a full reader: item bodies are kept as plain text and
 * clipped, and nothing is fetched.
 *
 * Handles RSS 2.0 (with the iTunes and media namespaces), RSS 1.0 (RDF),
 * Atom and JSON Feed, because all four arrive at a submit endpoint.
 */

const MAX_ITEMS = 500;
const DESCRIPTION_CHARS = 4000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  // A tag appears once or many times with no warning; forcing arrays only for
  // the repeatable ones keeps every other access a plain property read.
  isArray: (name) =>
    name === 'item' ||
    name === 'entry' ||
    name === 'link' ||
    name === 'category' ||
    name === 'itunes:category' ||
    name === 'enclosure' ||
    name === 'media:content',
});

/** @param {unknown} node */
function text(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') {
    const o = /** @type {Record<string, unknown>} */ (node);
    if ('#text' in o) return text(o['#text']);
    // <title type="html">…</title> and CDATA both land here as #text; a
    // node with only attributes has no text at all.
  }
  return '';
}

/** @param {unknown} node @param {string} name */
function attr(node, name) {
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return attr(node[0], name);
  const v = /** @type {Record<string, unknown>} */ (node)[`@${name}`];
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** @param {unknown} node */
function list(node) {
  if (node == null) return [];
  return Array.isArray(node) ? node : [node];
}

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', eacute: 'é', uuml: 'ü', deg: '°', copy: '©',
};

/** @param {number} n */
function codePoint(n) {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
}

/**
 * Decode character references, twice.
 *
 * The XML parser leaves numeric character references alone, and a fair number
 * of feeds escape their titles twice on the way out of a CMS, so `&#8211;`
 * and `&amp;#8211;` both have to come back as an en dash. Two passes covers
 * both without needing to know which one a given publisher did.
 *
 * @param {string} input
 * @returns {string}
 */
export function decodeEntities(input) {
  const pass = (s) =>
    s
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
      .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED[String(name).toLowerCase()] ?? m);
  return pass(pass(String(input ?? '')));
}

/**
 * HTML to one line of plain text.
 *
 * @param {string} html
 * @returns {string}
 */
export function plainText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A duration as a publisher writes it (`SS`, `MM:SS`, `HH:MM:SS`), in seconds.
 *
 * @param {string} raw
 * @returns {number|null}
 */
export function durationSeconds(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.split(':').map((p) => Number(p));
  if (parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** @param {string} when */
function isoDate(when) {
  const t = when ? Date.parse(when) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)(\?|$)/i;

/** @param {string} type @param {string} url */
function isAudio(type, url) {
  if (/^audio\//i.test(type)) return true;
  if (/^(image|text|video)\//i.test(type)) return false;
  return AUDIO_EXT.test(url);
}

/** @param {string} type @param {string} url */
function isVideo(type, url) {
  if (/^video\//i.test(type)) return true;
  if (/^(image|text|audio)\//i.test(type)) return false;
  return VIDEO_EXT.test(url);
}

/**
 * The media attachment of an RSS item: the enclosure, or a media:content, or
 * an Atom link rel="enclosure".
 *
 * @param {Record<string, unknown>} item
 * @returns {{ url: string, type: string, bytes: number|null, seconds: number|null, kind: 'audio'|'video' }|null}
 */
function mediaOf(item) {
  const candidates = [];
  for (const enc of list(item.enclosure)) {
    candidates.push({ url: attr(enc, 'url'), type: attr(enc, 'type'), bytes: attr(enc, 'length') });
  }
  for (const l of list(item.link)) {
    if (attr(l, 'rel') === 'enclosure' && attr(l, 'href')) {
      candidates.push({ url: attr(l, 'href'), type: attr(l, 'type'), bytes: attr(l, 'length') });
    }
  }
  for (const m of list(item['media:content'])) {
    candidates.push({ url: attr(m, 'url'), type: attr(m, 'type'), bytes: attr(m, 'fileSize') });
  }
  const seconds = durationSeconds(text(item['itunes:duration']));
  for (const c of candidates) {
    if (!c.url) continue;
    const kind = isAudio(c.type, c.url) ? 'audio' : isVideo(c.type, c.url) ? 'video' : null;
    if (!kind) continue;
    const bytes = Number(c.bytes);
    return {
      url: c.url.trim(),
      type: c.type || '',
      bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null,
      seconds,
      kind,
    };
  }
  return null;
}

/** @param {Record<string, unknown>} item */
function itemLink(item) {
  for (const l of list(item.link)) {
    if (typeof l === 'string') return l;
    const rel = attr(l, 'rel');
    if ((!rel || rel === 'alternate') && attr(l, 'href')) return attr(l, 'href');
    if (text(l)) return text(l);
  }
  return '';
}

/**
 * @param {Record<string, unknown>} item
 * @returns {import('../index.d.ts').FeedItem}
 */
function rssItem(item) {
  const media = mediaOf(item);
  const link = itemLink(item);
  const body =
    text(item['itunes:summary']) ||
    text(item.description) ||
    text(item['content:encoded']) ||
    text(item.summary) ||
    text(item.content);
  return {
    id: text(item.guid) || text(item.id) || media?.url || link || '',
    title: plainText(text(item.title)),
    link: link || null,
    published: isoDate(
      text(item.pubDate) || text(item.published) || text(item['dc:date']) || text(item.updated),
    ),
    description: plainText(body).slice(0, 1000),
    image: attr(item['itunes:image'], 'href') || null,
    media,
  };
}

/** @param {Record<string, unknown>} channel */
function rssCategories(channel) {
  const out = [];
  const push = (v) => {
    const s = plainText(v);
    if (s && !out.includes(s)) out.push(s);
  };
  for (const c of list(channel['itunes:category'])) {
    push(attr(c, 'text'));
    for (const sub of list(/** @type {any} */ (c)?.['itunes:category'])) push(attr(sub, 'text'));
  }
  for (const c of list(channel.category)) push(typeof c === 'string' ? c : text(c) || attr(c, 'term'));
  return out;
}

/** @param {unknown} v */
function explicitOf(v) {
  const s = text(v).trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === 'explicit';
}

/**
 * @param {Record<string, unknown>} channel
 * @param {string} url
 */
function fromRss(channel, url) {
  const items = list(channel.item).slice(0, MAX_ITEMS).map(rssItem);
  const owner = channel['itunes:owner'];
  const link = itemLink(channel);
  return finish(
    {
      title: plainText(text(channel.title)),
      description: plainText(text(channel.description) || text(channel['itunes:summary'])).slice(0, DESCRIPTION_CHARS),
      link: link || null,
      language: text(channel.language) || null,
      author: plainText(text(channel['itunes:author']) || text(channel['dc:creator']) || text(channel.managingEditor)) || null,
      owner: plainText(text(/** @type {any} */ (owner)?.['itunes:name'])) || null,
      ownerEmail: text(/** @type {any} */ (owner)?.['itunes:email']).trim() || null,
      image: attr(channel['itunes:image'], 'href') || text(/** @type {any} */ (channel.image)?.url) || null,
      explicit: explicitOf(channel['itunes:explicit']),
      categories: rssCategories(channel),
      generator: text(channel.generator) || null,
      podcastGuid: text(channel['podcast:guid']) || null,
      items,
    },
    url,
    'rss',
  );
}

/**
 * @param {Record<string, unknown>} feed
 * @param {string} url
 */
function fromAtom(feed, url) {
  const items = list(feed.entry).slice(0, MAX_ITEMS).map(rssItem);
  const author = /** @type {any} */ (list(feed.author)[0]);
  return finish(
    {
      title: plainText(text(feed.title)),
      description: plainText(text(feed.subtitle)).slice(0, DESCRIPTION_CHARS),
      link: itemLink(feed) || null,
      language: attr(feed, 'xml:lang') || null,
      author: plainText(text(author?.name)) || null,
      owner: null,
      ownerEmail: text(author?.email).trim() || null,
      image: text(feed.logo) || text(feed.icon) || null,
      explicit: false,
      categories: rssCategories(feed),
      generator: text(feed.generator) || null,
      podcastGuid: null,
      items,
    },
    url,
    'atom',
  );
}

/**
 * @param {Record<string, unknown>} doc
 * @param {string} url
 */
function fromJsonFeed(doc, url) {
  const items = list(doc.items)
    .slice(0, MAX_ITEMS)
    .map((raw) => {
      const it = /** @type {Record<string, any>} */ (raw ?? {});
      let media = null;
      for (const a of list(it.attachments)) {
        const type = String(a?.mime_type ?? '');
        const href = String(a?.url ?? '');
        if (!href) continue;
        const kind = isAudio(type, href) ? 'audio' : isVideo(type, href) ? 'video' : null;
        if (!kind) continue;
        media = {
          url: href,
          type,
          bytes: Number(a?.size_in_bytes) > 0 ? Number(a.size_in_bytes) : null,
          seconds: Number(a?.duration_in_seconds) > 0 ? Math.round(Number(a.duration_in_seconds)) : null,
          kind,
        };
        break;
      }
      return {
        id: String(it.id ?? it.url ?? media?.url ?? ''),
        title: plainText(String(it.title ?? '')),
        link: it.url ? String(it.url) : null,
        published: isoDate(String(it.date_published ?? it.date_modified ?? '')),
        description: plainText(String(it.summary ?? it.content_text ?? it.content_html ?? '')).slice(0, 1000),
        image: it.image ? String(it.image) : null,
        media,
      };
    });
  const author = /** @type {any} */ (list(doc.authors)[0] ?? doc.author);
  return finish(
    {
      title: plainText(String(doc.title ?? '')),
      description: plainText(String(doc.description ?? '')).slice(0, DESCRIPTION_CHARS),
      link: doc.home_page_url ? String(doc.home_page_url) : null,
      language: doc.language ? String(doc.language) : null,
      author: author?.name ? plainText(String(author.name)) : null,
      owner: null,
      ownerEmail: null,
      image: doc.icon ? String(doc.icon) : doc.favicon ? String(doc.favicon) : null,
      explicit: false,
      categories: [],
      generator: null,
      podcastGuid: null,
      items,
    },
    url,
    'json',
  );
}

/**
 * Derived fields every format shares.
 *
 * @param {any} feed
 * @param {string} url
 * @param {'rss'|'atom'|'json'} format
 */
function finish(feed, url, format) {
  const withMedia = feed.items.filter((i) => i.media);
  const dates = feed.items.map((i) => (i.published ? Date.parse(i.published) : NaN)).filter(Number.isFinite);
  const kind =
    feed.items.length > 0 && withMedia.length * 2 >= feed.items.length
      ? withMedia.every((i) => i.media.kind === 'video')
        ? 'video'
        : 'podcast'
      : 'blog';
  return {
    ...feed,
    format,
    feedUrl: url,
    kind,
    episodeCount: withMedia.length,
    itemCount: feed.items.length,
    newestPublished: dates.length ? new Date(Math.max(...dates)).toISOString() : null,
    oldestPublished: dates.length ? new Date(Math.min(...dates)).toISOString() : null,
  };
}

/**
 * Parse a feed document at channel level.
 *
 * Returns null when the text is not a feed at all. A feed with no items is
 * still a feed; whether that is acceptable is the directory's decision.
 *
 * @param {string} body
 * @param {string} [url] where it came from, recorded as `feedUrl`
 * @returns {import('../index.d.ts').ParsedFeed|null}
 */
export function parseFeed(body, url = '') {
  const src = String(body ?? '').trim();
  if (!src) return null;

  if (src.startsWith('{')) {
    try {
      const doc = JSON.parse(src);
      if (doc && typeof doc === 'object' && (Array.isArray(doc.items) || /jsonfeed\.org/.test(String(doc.version)))) {
        return fromJsonFeed(doc, url);
      }
    } catch {
      // not JSON
    }
    return null;
  }

  let doc;
  try {
    doc = parser.parse(src);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;

  if (doc.rss?.channel) return fromRss(doc.rss.channel, url);
  if (doc.feed && (doc.feed.entry || doc.feed.title !== undefined)) return fromAtom(doc.feed, url);
  const rdf = doc['rdf:RDF'];
  if (rdf?.channel) {
    // RSS 1.0 keeps items beside the channel, not inside it.
    return fromRss({ ...rdf.channel, item: rdf.item ?? [] }, url);
  }
  if (doc.channel) return fromRss(doc.channel, url);
  return null;
}
