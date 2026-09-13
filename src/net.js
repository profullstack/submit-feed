/**
 * The guards a submit endpoint needs before it fetches a URL somebody else
 * chose. Anyone can submit and the fetch happens from inside the deployment,
 * so without these a submit endpoint is a server-side request forgery
 * primitive: point it at the cloud metadata address and read credentials
 * back out of the error message.
 *
 * Pure apart from `isPublicHost`, whose DNS lookup is injected so it can run
 * anywhere and be tested without a network.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** @param {string} ip */
export function isIPv4(ip) {
  const m = IPV4.exec(String(ip ?? ''));
  return Boolean(m) && m.slice(1).every((n) => Number(n) <= 255);
}

/** @param {string} ip */
export function isIPv6(ip) {
  const s = String(ip ?? '');
  if (!s.includes(':')) return false;
  return /^[0-9a-f:.]+$/i.test(s) && s.split('::').length <= 2;
}

/**
 * Private, loopback, link-local and carrier-grade-NAT ranges.
 *
 * @param {string} ip
 * @returns {boolean} true when the address must not be fetched
 */
export function isBlockedAddress(ip) {
  if (isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (isIPv6(ip)) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('fe80')) return true; // link-local
    if (v.startsWith('fc') || v.startsWith('fd')) return true; // unique-local
    // IPv4-mapped (::ffff:10.0.0.1) must be checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isBlockedAddress(mapped[1]);
    return false;
  }

  return true; // unparseable: refuse
}

/**
 * Names that are internal by convention whatever DNS says.
 *
 * @param {string} hostname
 */
export function isInternalName(hostname) {
  const lower = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  return (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.local') ||
    lower === 'metadata.google.internal'
  );
}

/**
 * How long a server asked us to wait, in seconds.
 *
 * RFC 9110 allows either a delay in seconds or an HTTP date. Anything
 * unparseable is null. Clamped to a day: a server that asks for a month has
 * almost certainly sent a date we misread.
 *
 * @param {string|null|undefined} header
 * @returns {number|null}
 */
export function retryAfterSeconds(header) {
  if (!header) return null;
  const seconds = Number(String(header).trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds), 86_400);
  const at = Date.parse(String(header));
  if (!Number.isNaN(at)) return Math.min(Math.max(0, Math.round((at - Date.now()) / 1000)), 86_400);
  return null;
}
