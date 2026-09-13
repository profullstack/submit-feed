/**
 * Everything that runs anywhere: no node: imports, no network. Safe to
 * import from a browser bundle, an edge runtime or a worker.
 */
export { normalizeUrl, normalizeUrls, plausibleHost, splitUrls, hostOf } from './normalize.js';
export { COMMON_PATHS, PODCAST_PATHS, FEED_TYPES, findFeedLinks, guessFeedUrls, looksLikeFeed } from './discover.js';
export { parseFeed, plainText, decodeEntities, durationSeconds } from './parse.js';
export { parseOpml, looksLikeOpml, buildOpml, opmlHead, opmlOutline, opmlFoot } from './opml.js';
export { slugify, uniqueSlug } from './slug.js';
export { isIPv4, isIPv6, isBlockedAddress, isInternalName, retryAfterSeconds } from './net.js';
export { ERRORS, explainError, parseSubmission, wantsHtml, submitReply, submitFeedTool, submitOpenApiPath } from './spec.js';
export { submitFeed, SubmitError } from './client.js';
