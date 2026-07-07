# Contributing

Thanks for your interest in contributing to **status-please**! This guide covers how to get from a clone to a merged pull request.

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md). All documentation, code, comments, and commit messages in this repository are written in **English**.

## Getting started

```bash
git clone https://github.com/pleaseai/status-please.git
cd status-please
bun install         # install dependencies
```

The full toolchain and local setup are described in the [`README.md`](./README.md). status-please targets Cloudflare (Workers, D1, KV, Workers Cache); you will need a Cloudflare account and [Wrangler](https://developers.cloudflare.com/workers/wrangler/) to run the check and display layers end to end. The Astro app alone can run against fixture data.

## Development workflow

1. Create a branch from `main` (e.g. `feat/short-description` or `fix/issue-123`).
2. Make focused changes — keep each pull request to one logical change.
3. Run the checks below and make sure they pass.
4. Open a pull request and fill out the template.

```bash
bun run lint        # lint and format
bun run test        # run the test suite
bun run build       # ensure it builds
```

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, where `type` is one of `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, etc. Breaking changes include a `BREAKING CHANGE:` footer. Versioning and the changelog are generated automatically from these messages, so accurate types matter.

## Pull requests

- Reference the issue your PR addresses (e.g. `Closes #123`).
- Use a Conventional-Commit-style PR title — it becomes the squash-merge commit.
- Make sure CI is green before requesting review.

## Reporting bugs and requesting features

Open an issue using the bug report or feature request template. For security
vulnerabilities, **do not** open a public issue — follow [SECURITY.md](./SECURITY.md).
