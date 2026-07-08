# Memory Index

- [tz-sensitive date test pitfall](feedback_tz_sensitive_date_tests.md) — a UTC-guarantee test that never varies process.env.TZ doesn't actually verify the guarantee
- [status-please test infra boundaries](project_status_please_test_infra.md) — only packages/core is unit-tested; apps/web has zero test harness
- [feed.ts coverage, commit 33dfec5](project_feed_ts_coverage_33dfec5.md) — mutation-tested the 9→15 new tests; found tagUri/feedHost host-escaping fix has zero coverage
