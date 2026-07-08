# Memory Index

- [PR #22 setup script review](pr22-setup-script-review.md) — status-please guided deploy script: verified wrangler field names; D1/KV name-collision limitation (still open); ask() EOF gap (fixed in PR #22)
- [feed RSS/Atom review](pr-feed-rss-atom-review.md) — double-XML-escaping in feed.ts is correct by design (verified by hand); amondnet/feed branch predates CLAUDE.md merge to main, use `git show origin/main:CLAUDE.md`
- [Statuspage provider-label gap](statuspage-provider-label-gap.md) — checkStatuspage's component-not-found error isn't provider-labeled like the other two; check when a new shared check kind is added
- [PR #30 CLI package-distribution review](pr30-cli-package-distribution-review.md) — statusbeam CLI + create-statusbeam scaffolder, execution-verified clean; resolveBin/resolvePackage chain confirmed working
