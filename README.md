# @profullstack/submit-feed

One way to add a feed to a directory, shared by every site that takes one.

**A submit box is the most abused input a feed directory has, and every site rebuilds it from scratch.** People paste a homepage instead of a feed, a list instead of a URL, an OPML file into a text area, `mailto:` links, and once in a while `http://169.254.169.254/`. rssamplifier.com learned each of those the hard way; p0dcasters.com was about to learn them again. This package is the part that does not depend on the site: turning what a person typed into a feed, safely, and the contract the endpoint answers with, so a CLI or an agent written against one directory works against the next.

```bash
npm i @profullstack/submit-feed
```

## Why

Three incidents shaped it.

A bulk uploader on rssamplifier split pasted text on whitespace and offered every token as a URL. Somebody pasted raw OPML, and `new URL('https://version="1.0"/')` parses, so about 3,700 rows of markup reached the directory and were crawled forever. `plausibleHost` is the gate that refuses a hostname DNS could never serve, and `normalizeUrl` runs every entry through it.

A submit endpoint fetches whatever it is given from inside the deployment. Without a private-address check on the name and again on the redirect target, that is a server-side request forgery primitive pointed at the cloud metadata service. `safeFetch` checks both, bounds the time and the bytes, and answers with a code instead of an exception.

And an endpoint that resolves one URL in the request is fine; one that resolves eight in the request took 65 seconds and inserted nothing. So the contract says that one URL answers with its page and a list may be queued, and the reply says which.

## Use it

Resolve whatever was submitted into a feed:

```js
import { resolveFeed } from '@profullstack/submit-feed';

const r = await resolveFeed('atp.fm', { kind: 'podcast' });
// { ok: true, feedUrl: 'https://cdn.atp.fm/rss/public?…', feed: { title, kind: 'podcast', episodeCount, … }, tried: [...] }
```

It tries the URL itself, then the feeds the page advertises in `<link rel="alternate">`, then a short list of conventional paths (`/feed`, `/rss.xml`, and with `kind: 'podcast'` also `/podcast.rss` and friends). It stops at the first feed with items. Refusals are codes: `invalid-url`, `blocked-host`, `blocked-redirect`, `timeout`, `http-404`, `no-feed-found`, and with `kind: 'podcast'`, `not-a-podcast` for a feed whose items carry no audio.

Read what an endpoint received, whatever shape it came in:

```js
import { parseSubmission, wantsHtml, submitReply } from '@profullstack/submit-feed';

export async function POST(req) {
  const body = req.headers.get('content-type')?.includes('json') ? await req.json() : await req.formData();
  const s = await parseSubmission(body, { maxEntries: 200 });
  // s.kind: 'url' | 'list' | 'opml'; s.urls normalised and deduped; s.invalid; s.email
  …
  const reply = submitReply({ accepted, rejected, queued, statusUrl });
  if (wantsHtml(req.headers.get('accept'))) return Response.redirect(accepted[0]?.page ?? statusUrl, 303);
  return Response.json(reply);
}
```

Call one from anywhere:

```js
import { submitFeed } from '@profullstack/submit-feed/core';

const reply = await submitFeed('https://p0dcasters.com', { url: 'example.org' });
// reply.accepted[0].page, or reply.rejected[0].error
```

Describe it to an agent:

```js
import { submitFeedTool } from '@profullstack/submit-feed/core';

const tool = submitFeedTool({ directory: 'p0dcasters', kind: 'podcast', run: mySubmit });
// name, title, description, inputSchema and annotations, the same on every site
```

## The contract

```
POST /api/submit
  JSON   { "url": "…" } | { "urls": ["…"] } | { "opml": "<opml…" }   plus "email" optionally
  form   input=<one URL per line>   opml=<file>   email=?

200  { ok, accepted: [{ url, slug, page, existing }],
       rejected: [{ url, error }], queued, total, submissionId?, statusUrl? }
303  when the caller sends Accept: text/html first: to the new page, or the status page
429  { ok: false, error: "rate-limited", retryAfterSeconds }
413  { ok: false, error: "too-large" }
```

`ERRORS` lists every code with a sentence for a person, and `explainError` turns an `http-NNN` into one. `submitOpenApiPath()` is the same contract as an OpenAPI 3.1 paths entry.

## Two entry points

`@profullstack/submit-feed` is for Node: `resolveFeed`, `safeFetch` and `isPublicHost` look names up with `node:dns`.

`@profullstack/submit-feed/core` is everything else and imports nothing from `node:`: normalising, discovery from HTML, the channel-level parser, OPML, slugs, the address checks, the contract helpers and the client. Safe in a browser bundle, an edge middleware or a worker.

## The parser

`parseFeed` reads RSS 2.0 with the iTunes and media namespaces, RSS 1.0, Atom and JSON Feed, at channel level: title, description, link, language, author, owner, artwork, explicit flag, categories, generator, `podcast:guid`, and each item's id, title, link, date, plain-text description, image and media attachment. It derives `kind` (`podcast` when at least half the items carry audio), `episodeCount`, and the newest and oldest dates. Character references are decoded twice, because a fair number of feeds escape their titles twice on the way out of a CMS.

It is not a reader. Bodies are plain text and clipped. For full text, extract from the item's link.

## Options

| `resolveFeed` / `safeFetch` | |
|---|---|
| `fetch` | defaults to `globalThis.fetch` |
| `lookup` | `(hostname) => Promise<string[]>`, every address for a name; defaults to `node:dns`. Inject in tests |
| `timeoutMs` | 15000 |
| `maxBytes` | 5 MiB; the body is cut there, not refused |
| `userAgent` | say who you are; publishers read logs |
| `kind` | `'any'` (default), `'podcast'`, `'blog'` |
| `maxCandidates` | how many discovered or guessed URLs to try after the first |

| `parseSubmission` | |
|---|---|
| `maxEntries` | 5000; `truncated` says when it bit |

## What this does not do

It does not write to a database, keep a queue, rate-limit, or decide who is allowed in. Those are the site's: the slug oracle (`uniqueSlug` takes a `taken` predicate), the ledger, the express lane and the review policy differ between a directory of everything and a directory of self-hosted podcasts, and the package stops where they begin.

## License

MIT
