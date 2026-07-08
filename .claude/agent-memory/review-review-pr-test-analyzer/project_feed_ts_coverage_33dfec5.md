---
name: project-feed-ts-coverage-33dfec5
description: statusbeam packages/core/src/feed.ts (commit 33dfec5) - verified 9→15 new tests via mutation testing; found feedHost/tagUri host-escaping fix has zero test coverage
metadata:
  type: project
---

Commit `33dfec5` (branch `amondnet/feed`, repo pleaseai/statusbeam) added 6 tests to
`packages/core/src/feed.test.ts` (9→15) to close coverage gaps: malformed-timestamp robustness
(`toMs` guard in `feed.ts`), non-finite `meta.now`, the `resolvedAt` sort-fallback branch, XML
escaping of `title`/`name` (not just update body), and an empty-incident-list envelope.

**Verified by mutation testing** (revert `feed.ts` to the pre-commit version, keep the new tests,
`bun test`): the malformed-timestamp test and non-finite-`now` test both genuinely fail/throw
against the old code (confirms they're not tautological). Separately reverting just
`escapeXml(inc.title)` → `inc.title` in both builders makes the new title/name-escaping test fail
too. All three are real regression guards, not weak assertions.

**Remaining gap found (not covered by any of the 6 new tests):** the same commit added
`escapeXml(host)` inside `tagUri()` (`feed.ts` ~line 136) specifically to "defend the `feedHost`
raw-string fallback" — i.e. when `new URL(siteUrl)` throws (malformed `siteUrl`), `feedHost()`
returns the raw, unescaped string, and `tagUri` needs to escape it before embedding in the `tag:`
URI so a `siteUrl` containing `&`/`<` can't break XML well-formedness in `<id>`/`<guid>`. Mutation-
tested: deleting `escapeXml(host)` from `tagUri` causes **zero test failures** across the whole
suite. No test anywhere in the repo (`packages/core` or `apps/web`) constructs an invalid/malformed
`siteUrl` to exercise `feedHost`'s catch branch.

**Why lower-than-critical severity despite zero coverage:** the only real caller,
`apps/web/src/lib/feed.ts:29`, sets `siteUrl: url.origin` — always a well-formed URL from the
Request object, so `feedHost`'s catch branch is presently unreachable in production. Still worth a
targeted unit test since `feedHost`/`tagUri` are exported-adjacent pure functions in a `core`
package meant for reuse by other callers (e.g. a config-driven `siteUrl`), and the fix was called
out by name in the commit message as closing an invariant.

**How to apply:** when reviewing future changes to `feed.ts`'s escaping/host logic, check for a
test that passes a syntactically-invalid `siteUrl` (e.g. `'not a url <script>'`) through
`buildAtomFeed`/`buildRssFeed` and asserts the `<id>`/`<guid>` tag URI is still well-formed. Also
note (confirmed again in this review, consistent with [[project-status-please-test-infra]]):
`apps/web/src/lib/data.ts`'s `getPageName` warn-once change in the same commit has zero test
coverage — expected given apps/web has no test harness, not a fresh regression.
