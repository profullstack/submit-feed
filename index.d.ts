/**
 * @profullstack/submit-feed
 *
 * One way to add a feed to a directory. The root entry is for Node (it
 * resolves DNS and fetches); `@profullstack/submit-feed/core` is everything
 * that runs anywhere, with no network.
 */

/** A media attachment on one item: the episode, when there is one. */
export interface FeedMedia {
  url: string;
  /** The declared MIME type, or '' when the publisher gave none. */
  type: string;
  bytes: number | null;
  /** From itunes:duration or the JSON Feed attachment, in seconds. */
  seconds: number | null;
  kind: 'audio' | 'video';
}

export interface FeedItem {
  /** guid, id, or the media or link URL when the feed has neither. */
  id: string;
  title: string;
  link: string | null;
  /** ISO 8601, or null when the item carries no parseable date. */
  published: string | null;
  /** Plain text, clipped to 1000 characters. */
  description: string;
  image: string | null;
  media: FeedMedia | null;
}

/** A feed at channel level: what a directory lists, plus its items. */
export interface ParsedFeed {
  format: 'rss' | 'atom' | 'json';
  /** The URL the document was parsed from, as given to parseFeed. */
  feedUrl: string;
  title: string;
  /** Plain text, clipped to 4000 characters. */
  description: string;
  link: string | null;
  language: string | null;
  author: string | null;
  owner: string | null;
  ownerEmail: string | null;
  image: string | null;
  explicit: boolean;
  categories: string[];
  generator: string | null;
  podcastGuid: string | null;
  items: FeedItem[];
  /**
   * 'podcast' when at least half the items carry audio (or video, when they
   * all do: 'video'); otherwise 'blog'. A directory may apply a stricter test.
   */
  kind: 'podcast' | 'video' | 'blog';
  /** Items with a media attachment. */
  episodeCount: number;
  itemCount: number;
  newestPublished: string | null;
  oldestPublished: string | null;
}

export interface FetchOptions {
  /** Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
  /** Every address for a hostname; defaults to node:dns. Inject in tests. */
  lookup?: (hostname: string) => Promise<string[]>;
  /** Default 15000. */
  timeoutMs?: number;
  /** Default 16 MiB. The body is cut there, not refused, and `truncated` says so. */
  maxBytes?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ResolveOptions extends FetchOptions {
  /**
   * 'podcast' tries the podcast paths as well and refuses a feed whose items
   * carry no audio with `not-a-podcast`. Default 'any'.
   */
  kind?: 'any' | 'podcast' | 'blog';
  /** How many discovered or guessed candidates to fetch after the first URL. */
  maxCandidates?: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
  /** The final URL after redirects. */
  url: string;
  /** The body was cut at maxBytes. resolveFeed repairs a cut feed at its last complete item. */
  truncated?: boolean;
  retryAfter?: number | null;
  /** invalid-url | blocked-host | blocked-redirect | timeout | fetch-failed */
  error?: string;
}

export type ResolveResult =
  | { ok: true; feedUrl: string; feed: ParsedFeed; tried: string[] }
  | {
      ok: false;
      url: string;
      /** One of the ERRORS keys, or http-NNN. */
      error: string;
      throttled?: boolean;
      retryAfter?: number | null;
      /** On not-a-podcast: the feed that was found and refused. */
      feed?: ParsedFeed;
      tried?: string[];
    };

/** What a submit endpoint received, in one shape. */
export interface Submission {
  kind: 'url' | 'list' | 'opml';
  /** Normalised, deduped, in the order given. */
  urls: string[];
  /** One per url; OPML entries carry the outline's title and htmlUrl. */
  entries: Array<{ url: string; title: string; siteUrl: string | null }>;
  /** Tokens that were not URLs at all. */
  invalid: string[];
  repeated: number;
  email: string | null;
  truncated: boolean;
  /** Nothing usable was sent. */
  empty: boolean;
}

export interface AcceptedFeed {
  url: string;
  slug: string;
  /** The feed's page on the directory. */
  page: string;
  /** Already listed before this submission. */
  existing: boolean;
  feedUrl?: string;
  title?: string;
}

export interface RejectedFeed {
  url: string;
  /** One of the ERRORS keys, or http-NNN. */
  error: string;
  message?: string;
}

/** The body every submit endpoint answers with. */
export interface SubmitReply {
  ok: boolean;
  accepted: AcceptedFeed[];
  rejected: RejectedFeed[];
  /** Entries handed to a crawler rather than resolved in the request. */
  queued: number;
  total: number;
  submissionId?: string;
  statusUrl?: string;
  /** On a refused request: rate-limited, too-large, bad-request. */
  error?: string;
  retryAfterSeconds?: number;
}

export interface McpTool {
  name: 'submit_feed';
  title: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: { urls: { type: 'array'; items: { type: 'string' }; description: string; maxItems: number } };
    required: ['urls'];
  };
  annotations: { readOnlyHint: false; destructiveHint: false; idempotentHint: true; openWorldHint: true };
  run?: (args: { urls: string[] }, ctx: unknown) => Promise<unknown>;
}

// ---- normalize -------------------------------------------------------------

/** "example.com", "//example.com" or "http://…" to an absolute http(s) URL, or null. */
export function normalizeUrl(input: string): string | null;
/** Could a publisher be at this hostname? Rejects markup, not the merely unusual. */
export function plausibleHost(hostname: string): boolean;
/** Split pasted text on whitespace and commas. */
export function splitUrls(text: string): string[];
export function normalizeUrls(inputs: string[]): { urls: string[]; invalid: string[]; repeated: number };
/** Lowercased hostname without port or leading www., or null. */
export function hostOf(url: string): string | null;

// ---- discover --------------------------------------------------------------

export const COMMON_PATHS: readonly string[];
export const PODCAST_PATHS: readonly string[];
export const FEED_TYPES: readonly string[];
/** Feed URLs from a page's <link rel="alternate"> tags, absolute, deduped. */
export function findFeedLinks(html: string, baseUrl: string): string[];
/** Conventional feed paths on the site's origin, in priority order. */
export function guessFeedUrls(siteUrl: string, opts?: { kind?: 'any' | 'podcast' | 'blog' }): string[];
/** Does this response look like a feed? Sniffs the body, not just the type. */
export function looksLikeFeed(contentType: string, body: string): boolean;

// ---- parse -----------------------------------------------------------------

/** RSS 2.0, RSS 1.0, Atom or JSON Feed at channel level; null when not a feed. */
export function parseFeed(body: string, url?: string): ParsedFeed | null;
export function plainText(html: string): string;
export function decodeEntities(input: string): string;
export function durationSeconds(raw: string): number | null;

// ---- opml ------------------------------------------------------------------

export function parseOpml(xml: string): Array<{ url: string; title: string; siteUrl: string | null }>;
export function looksLikeOpml(text: string): boolean;
export function buildOpml(feeds: Array<{ title: string; feedUrl: string; siteUrl?: string | null }>, title?: string): string;
export function opmlHead(title?: string): string;
export function opmlOutline(feed: { title: string; feedUrl: string; siteUrl?: string | null }): string;
export function opmlFoot(): string;

// ---- slug ------------------------------------------------------------------

export function slugify(input: string, opts?: { ascii?: boolean; maxLength?: number }): string;
export function uniqueSlug(
  title: string,
  opts?: {
    fallbackUrl?: string;
    taken?: (slug: string) => boolean;
    reserved?: Iterable<string>;
    ascii?: boolean;
    maxLength?: number;
  },
): string;

// ---- net -------------------------------------------------------------------

export function isIPv4(ip: string): boolean;
export function isIPv6(ip: string): boolean;
/** Private, loopback, link-local, CGNAT, multicast; unparseable is blocked. */
export function isBlockedAddress(ip: string): boolean;
export function isInternalName(hostname: string): boolean;
/** Resolves the name and refuses if any address is internal. Node only at the root. */
export function isPublicHost(hostname: string, opts?: { lookup?: (hostname: string) => Promise<string[]> }): Promise<boolean>;
export function retryAfterSeconds(header: string | null | undefined): number | null;

// ---- resolve (root entry only) --------------------------------------------

export const DEFAULT_USER_AGENT: string;
export const DEFAULT_TIMEOUT_MS: number;
export const DEFAULT_MAX_BYTES: number;
/** fetch with the SSRF guard, a timeout and a body cap. */
export function safeFetch(url: string, opts?: FetchOptions): Promise<SafeFetchResult>;
/** Close a feed document cut off by the byte cap at its last complete item; null when nothing is left. */
export function repairTruncated(body: string): string | null;
/** Advertised feed links reordered so those under the page's own path come first. */
export function nearestFirst(links: string[], pageUrl: string): string[];
/** A site or feed URL to a parsed feed: the URL itself, then advertised links (nearest the page's path first), then guesses. */
export function resolveFeed(input: string, opts?: ResolveOptions): Promise<ResolveResult>;

// ---- spec ------------------------------------------------------------------

/** Every error code a reply may carry, with a sentence for a person. */
export const ERRORS: Readonly<Record<string, string>>;
export function explainError(code: string): string;
/** A JSON body, FormData or URLSearchParams to one Submission. */
export function parseSubmission(body: unknown, opts?: { maxEntries?: number }): Promise<Submission>;
/** Should this request get a 303 rather than JSON? */
export function wantsHtml(accept: string | null | undefined): boolean;
export function submitReply(reply: Partial<SubmitReply>): SubmitReply;
/** The submit_feed MCP tool as tools/list describes it; `run` is the site's. */
export function submitFeedTool(opts?: {
  directory?: string;
  maxUrls?: number;
  kind?: 'any' | 'podcast' | 'blog';
  run?: McpTool['run'];
}): McpTool;
/** An OpenAPI 3.1 paths entry for the endpoint. */
export function submitOpenApiPath(opts?: { path?: string; summary?: string }): Record<string, unknown>;

// ---- client ----------------------------------------------------------------

export class SubmitError extends Error {
  status: number;
  code: string | null;
  retryAfterSeconds: number | null;
  body: unknown;
}
/** POST to a site that speaks the contract. Throws SubmitError on a refusal. */
export function submitFeed(
  site: string,
  what: { url?: string; urls?: string[]; opml?: string; email?: string },
  opts?: { fetch?: typeof fetch; signal?: AbortSignal; path?: string; headers?: Record<string, string> },
): Promise<SubmitReply>;
