import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
});

/**
 * Walk an OPML outline tree and collect every node that carries a feed URL.
 *
 * OPML nests arbitrarily: subscription lists are usually grouped into folders,
 * and folders can contain folders, so this recurses rather than reading only
 * the top level. Nodes without an xmlUrl are folders, not feeds.
 *
 * @param {unknown} node
 * @param {Array<{ url: string, title: string, siteUrl: string|null }>} out
 */
function walk(node, out) {
  if (!node) return;
  const list = Array.isArray(node) ? node : [node];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;

    const url = item['@xmlUrl'] || item['@xmlurl'] || item['@xmlURL'];
    if (typeof url === 'string' && url.trim()) {
      const siteUrl = item['@htmlUrl'] || item['@htmlurl'] || item['@htmlURL'];
      out.push({
        url: url.trim(),
        title: (item['@title'] || item['@text'] || '').toString().trim(),
        siteUrl: typeof siteUrl === 'string' && siteUrl.trim() ? siteUrl.trim() : null,
      });
    }

    if (item.outline) walk(item.outline, out);
  }
}

/**
 * Extract feed URLs from an OPML document.
 *
 * Deliberately lenient: a malformed OPML returns an empty list rather than
 * throwing, because this runs on user-submitted uploads and one bad file must
 * not take down the submit endpoint.
 *
 * @param {string} xml raw OPML
 * @returns {Array<{ url: string, title: string, siteUrl: string|null }>} deduped by URL, order preserved
 */
export function parseOpml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) return [];

  let doc;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  const found = [];
  walk(doc?.opml?.body?.outline, found);

  const seen = new Set();
  return found.filter((f) => {
    const key = f.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Does this text look like OPML rather than a list of URLs?
 *
 * Sniffed from the head only, so it is safe on a multi-megabyte upload.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeOpml(text) {
  const head = String(text ?? '').slice(0, 4096);
  return /<opml\b/i.test(head) || /<outline\b[^>]*\bxmlurl\s*=/i.test(head);
}

/**
 * Render a list of feeds as an OPML 2.0 subscription list.
 *
 * @param {Array<{ title: string, feedUrl: string, siteUrl?: string|null }>} feeds
 * @param {string} [title]
 * @returns {string}
 */
export function buildOpml(feeds, title = 'Subscriptions') {
  const rows = feeds.map((f) => opmlOutline(f)).join('\n');
  return `${opmlHead(title)}${rows}\n${opmlFoot()}`;
}

/** @param {string} [title] */
export function opmlHead(title = 'Subscriptions') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>${esc(title)}</title>
  </head>
  <body>
`;
}

/** @param {{ title: string, feedUrl: string, siteUrl?: string|null }} feed */
export function opmlOutline(feed) {
  const attrs = [
    `text="${esc(feed.title)}"`,
    `title="${esc(feed.title)}"`,
    'type="rss"',
    `xmlUrl="${esc(feed.feedUrl)}"`,
  ];
  if (feed.siteUrl) attrs.push(`htmlUrl="${esc(feed.siteUrl)}"`);
  return `    <outline ${attrs.join(' ')} />`;
}

export function opmlFoot() {
  return `  </body>
</opml>
`;
}

/** @param {unknown} s */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
