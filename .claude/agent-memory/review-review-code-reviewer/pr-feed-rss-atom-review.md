---
name: pr-feed-rss-atom-review
description: statusbeam RSS/Atom incident-history feed (branch amondnet/feed) — verified double-XML-escaping is correct by design, not a bug; noted the branch predates CLAUDE.md's merge to main
metadata:
  type: project
---

## Double XML-escaping in packages/core/src/feed.ts is intentional and correct

`incidentContentHtml()` escapes each update body once (`escapeXml`), then
`buildAtomFeed`/`buildRssFeed` escape the *entire* built HTML blob again before
embedding it in `<content type="html">` / `<description>`. This looks like a
double-escaping bug at first glance but is the correct encoding for
"HTML-as-text embedded in XML": traced through XML-entity-decoding by hand
(and confirmed via `bun test`, including under `TZ=America/Los_Angeles`) —
tags decode back to real markup after one XML-parse pass, while the body's
original special characters (e.g. `&`) survive as literal HTML entities
(`&amp;`) in the decoded HTML string, which an HTML renderer then displays
correctly. Don't flag this pattern as a bug in this file without re-deriving
it; see [[injection-avoidance-conventions]] if that memory exists for the
broader escaping convention.

**Why:** the docstring on `escapeXml` in feed.ts explains this is deliberate;
verified experimentally rather than taking the comment at face value, since
"the comment says it's fine" is not sufficient evidence on its own.

**How to apply:** if a future diff touches `feed.ts`'s escaping, re-verify by
hand (or by adding a body containing `&`/`<` to a test and checking the final
rendered/decoded string), don't assume single-escape is "more correct."

## amondnet/feed branch predates CLAUDE.md's merge to main

This repo's root `CLAUDE.md` (and `.please/docs/knowledge/*.md`) were added to
`origin/main` in commit `29112f1` ("docs: add ARCHITECTURE.md, CLAUDE.md, and
.please workspace", PR #35). The `amondnet/feed` branch was cut from an
earlier commit (`3e23bfa`), so `CLAUDE.md` does not exist in that branch's
working tree — `find`/`cat CLAUDE.md` locally returns nothing even though the
review prompt says "root CLAUDE.md ... applies."

**Why:** a three-dot `git diff origin/main...HEAD` diffs from the merge-base,
so it never surfaces origin/main's later-added CLAUDE.md; a naive local file
check would wrongly conclude the repo has no CLAUDE.md/engineering-standards
doc at all.

**How to apply:** when a review prompt references CLAUDE.md/project
guidelines but the file isn't in the checked-out working tree, check
`git show origin/main:CLAUDE.md` (and `.please/docs/knowledge/workflow.md`,
`tech-stack.md`) before concluding no guidelines exist. Key rule found there:
workflow.md says "Every module must have corresponding tests" — but
`apps/web/src/lib/*.ts` has zero test files repo-wide (not just the new
`feed.ts`), so a missing test for a new `apps/web/src/lib/*.ts` file is a
citable-but-pre-existing-pattern finding, not a fresh regression — flag at
moderate/low confidence and say so explicitly.

## getIncidents()/getSummary() (apps/web/src/lib/data.ts) still have no try/catch

Confirmed still true as of this review: `getIncidents()` does
`kv.get()` + `JSON.parse(raw)` with no error handling, unlike its sibling
`getLocale()`/`getPageName()` in the same file (both explicitly try/catch and
never throw). The new `feed.ts` (`apps/web/src/lib/feed.ts`) adds another
caller of `getIncidents()`, but `page.ts` already called it the same
unguarded way before this diff — so the exposure isn't new, just replicated.
Low-confidence/pre-existing; don't rate this as high severity for a diff that
only adds a new caller of already-unguarded code.
