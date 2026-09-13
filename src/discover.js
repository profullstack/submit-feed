/**
 * Feed discovery: people submit "myblog.com", not "myblog.com/feed.xml".
 * Turning the former into the latter is most of what makes submission
 * painless. Everything here is pure; the fetching is in resolve.js.
 */

/** Paths a blog is likely to serve a feed from, in priority order. */
export const COMMON_PATHS = [
  '/feed',
  '/feed.xml',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/index.xml',
  '/feed/',
  '/feeds/posts/default',
  '/?feed=rss2',
  '/feed.json',
];

/**
 * Paths a podcast site is likely to serve its feed from, on top of the common
 * ones. Tried after them: a site with both a blog feed and a podcast feed at
 * /feed is a blog with a podcast on it, and /feed is still the honest answer
 * for the site.
 */
export const PODCAST_PATHS = [
  '/podcast.rss',
  '/podcast.xml',
  '/podcast/feed',
  '/podcast/feed/',
  '/podcast/rss',
  '/feed/podcast',
  '/feed/podcast/',
  '/episodes/feed',
  '/rss/podcast',
  '/feed.rss',
];

/** Content types that indicate the body is a feed rather than a web page. */
export const FEED_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/feed+json',
  'application/xml',
  'text/xml',
  'application/json',
];

/**
 * Extract feed URLs advertised by a page's <link rel="alternate"> tags.
 *
 * This is the correct, standards-based path; the guessed paths are only a
 * fallback for sites that don't advertise.
 *
 * @param {string} html
 * @param {string} baseUrl for resolving relative hrefs
 * @returns {string[]} absolute feed URLs, in document order, deduped
 */
export function findFeedLinks(html, baseUrl) {
  if (typeof html !== 'string') return [];
  const out = [];

  // Match <link> tags, then pull attributes out individually: attribute order
  // varies between generators and a single positional regex misses most.
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase().trim();
    if (!rel || !rel.split(/\s+/).includes('alternate')) continue;

    const type = /\btype\s*=\s*["']?([^"'>\s]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (!type || !FEED_TYPES.includes(type)) continue;

    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;

    try {
      const abs = new URL(href, baseUrl).toString();
      if (!out.includes(abs)) out.push(abs);
    } catch {
      // skip unresolvable href
    }
  }

  return out;
}

/**
 * Candidate feed URLs to try for a site, in priority order.
 *
 * Resolved against the site's origin, not the path submitted: a person who
 * pastes a deep link to one post still means the site.
 *
 * @param {string} siteUrl
 * @param {{ kind?: 'any'|'podcast'|'blog' }} [opts] `podcast` adds the podcast paths
 * @returns {string[]}
 */
export function guessFeedUrls(siteUrl, opts = {}) {
  const out = [];
  const paths =
    opts.kind === 'podcast' ? [...COMMON_PATHS, ...PODCAST_PATHS] : COMMON_PATHS;
  let origin;
  try {
    origin = new URL(siteUrl).origin + '/';
  } catch {
    return out;
  }
  for (const p of paths) {
    try {
      out.push(new URL(p, origin).toString());
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Decide whether a fetched response looks like a feed.
 *
 * Content-type alone is unreliable: plenty of feeds are served as text/plain
 * or text/html, so the body is sniffed too.
 *
 * @param {string} contentType
 * @param {string} body
 * @returns {boolean}
 */
export function looksLikeFeed(contentType, body) {
  const ct = (contentType || '').toLowerCase();
  const head = (body ?? '').slice(0, 4000);
  const lower = head.toLowerCase();

  if (FEED_TYPES.some((t) => ct.includes(t))) {
    // application/json is only a feed if it's actually JSON Feed.
    if (ct.includes('json') && !ct.includes('feed+json')) {
      return /"(?:items|version)"\s*:/.test(body ?? '');
    }
    // application/xml and text/xml are also what an HTML-ish sitemap or an
    // OPML file is served as; a feed root is what makes it a feed.
    if (ct.includes('xml') && !ct.includes('rss') && !ct.includes('atom')) {
      return /<(rss|feed|rdf:rdf)\b/i.test(head);
    }
    return true;
  }

  if (/<rss\b/.test(lower)) return true;
  if (/<feed\b[^>]*xmlns/.test(lower)) return true;
  if (/<rdf:rdf\b/.test(lower)) return true;
  if (/"version"\s*:\s*"https:\/\/jsonfeed\.org/.test(lower)) return true;

  return false;
}
