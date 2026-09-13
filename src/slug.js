/**
 * Slugs are the public identity of a feed on a directory: /<slug>. They have
 * to survive being typed by a human, pasted by an agent and used as a lookup
 * key, so they stay lowercase and free of consecutive separators.
 */

/**
 * Turn arbitrary text into a URL-safe slug.
 *
 * Unicode letters and digits are kept by default, not stripped to a-z: an a-z
 * filter turns every Cyrillic, Greek, Hebrew, Arabic or CJK title into an
 * empty slug and the hostname fallback then names them all after their host.
 * Pass `ascii: true` for a directory whose existing slugs are ASCII only.
 *
 * @param {string} input
 * @param {{ ascii?: boolean, maxLength?: number }} [opts]
 * @returns {string} slug, or '' when the input has no usable characters
 */
export function slugify(input, opts = {}) {
  if (typeof input !== 'string') return '';
  const max = opts.maxLength ?? 80;
  let s = input
    .normalize('NFKD')
    // strip combining marks so "Café" becomes "cafe" rather than "caf"
    .replace(/[̀-ͯ]/g, '')
    // put every other mark back on the character it belongs to: NFKD also
    // splits the Japanese dakuten off its kana, and that mark is not a letter
    .normalize('NFC')
    .toLowerCase()
    .replace(/['’]/g, '');
  s = opts.ascii ? s.replace(/[^a-z0-9]+/g, '-') : s.replace(/[^\p{L}\p{N}]+/gu, '-');
  return s.replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
}

/**
 * Pick a slug that is neither reserved nor already taken.
 *
 * Falls back to the feed's hostname when the title yields nothing usable,
 * then appends -2, -3 … until it finds a free one. `taken` is consulted
 * rather than mutated so the caller decides when a slug is really claimed.
 *
 * @param {string} title
 * @param {{ fallbackUrl?: string, taken?: (slug: string) => boolean, reserved?: Iterable<string>, ascii?: boolean, maxLength?: number }} [opts]
 * @returns {string}
 */
export function uniqueSlug(title, opts = {}) {
  const reserved = new Set(opts.reserved ?? []);
  const taken = opts.taken ?? (() => false);
  let base = slugify(title, opts);

  if (!base && opts.fallbackUrl) {
    try {
      base = slugify(new URL(opts.fallbackUrl).hostname.replace(/^www\./, ''), opts);
    } catch {
      base = '';
    }
  }
  if (!base) base = 'untitled';

  let candidate = base;
  let n = 1;
  while (reserved.has(candidate) || taken(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}
