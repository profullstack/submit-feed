/**
 * What a person pastes is rarely a URL. It is "myblog.com", or "//example.org",
 * or three feeds separated by commas and a newline. Everything a submit
 * endpoint accepts passes through here first, so one gate covers the web form,
 * the OPML import, the MCP tool and the CLI alike.
 */

/**
 * Normalize user input into an absolute http(s) URL.
 *
 * Accepts "example.com", "//example.com" and "http://example.com", because all
 * three get pasted into submission boxes. Returns null for anything that is
 * not a usable web URL, including non-http schemes, which must never be
 * fetched. The fragment is dropped: it never reaches a server.
 *
 * @param {string} input
 * @returns {string|null}
 */
export function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith('//')) raw = `https:${raw}`;
  if (!/^https?:\/\//i.test(raw)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // mailto:, javascript:, file:
    raw = `https://${raw}`;
  }

  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!plausibleHost(u.hostname)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Is this hostname something a publisher could actually be at?
 *
 * `new URL()` is far more permissive about hosts than DNS is. Quotes, parens,
 * `=` and `&` are not forbidden host code points, so `new URL('https://x')`
 * happily parses `version="1.0"`, `zombies.)` and `z.` into a hostname. The
 * bulk-upload scanner on rssamplifier splits pasted text on whitespace and
 * offers every token as a URL, so pasting raw OPML instead of a URL list
 * turned the markup itself into feeds: roughly 3,700 rows like
 * `https://version="1.0"/` reached the directory and were crawled forever.
 *
 * Kept deliberately loose about what a real domain looks like: this rejects
 * things that cannot be hostnames, not things that are merely unusual. IDN is
 * already punycode by the time it arrives, and a bare IPv4 literal is allowed
 * through so a feed genuinely served from one is not rejected here; private
 * ranges are refused later, by `isPublicHost`.
 *
 * @param {string} hostname as parsed by `new URL`, so lowercased and punycoded
 * @returns {boolean}
 */
export function plausibleHost(hostname) {
  const host = String(hostname ?? '');
  if (!host || host.length > 253) return false;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return host.split('.').every((n) => Number(n) <= 255);
  }

  if (!/^[a-z0-9.-]+$/.test(host)) return false;

  const labels = host.split('.');
  if (labels.length < 2) return false;
  if (labels.some((l) => l === '' || l.length > 63 || l.startsWith('-') || l.endsWith('-'))) {
    return false;
  }

  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

/**
 * Split a pasted block into candidate URLs.
 *
 * Whitespace and commas both separate; a textarea gets one per line and a
 * chat message gets them comma-separated. Not normalised here, so the caller
 * can report which *original* token was refused.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function splitUrls(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normalise a list of inputs, keeping the first spelling of each URL and
 * reporting the ones that were not URLs at all.
 *
 * @param {string[]} inputs
 * @returns {{ urls: string[], invalid: string[], repeated: number }}
 */
export function normalizeUrls(inputs) {
  const urls = [];
  const invalid = [];
  const seen = new Set();
  let repeated = 0;
  for (const raw of Array.isArray(inputs) ? inputs : []) {
    const url = normalizeUrl(raw);
    if (!url) {
      invalid.push(String(raw ?? ''));
      continue;
    }
    const key = url.toLowerCase();
    if (seen.has(key)) {
      repeated += 1;
      continue;
    }
    seen.add(key);
    urls.push(url);
  }
  return { urls, invalid, repeated };
}

/**
 * The registrable-ish host a feed publishes from, for "which domain is this
 * on" questions: lowercased, port dropped, leading `www.` removed.
 *
 * Not a public-suffix computation. A directory that groups by host wants
 * `example.co.uk`, and the suffix list is a moving target this package does
 * not carry. `www.` is stripped because it is the one prefix every publisher
 * treats as the same site.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function hostOf(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}
