# scripts/

Authorized publish-time helpers. Use these instead of running `gh workflow
run` / `git tag` / `npm publish` by hand — they validate state, confirm
with you, watch CI, and verify the result.

## When to use which

| Scenario | Script |
|---|---|
| Bumped `mcp/package.json` version, want to publish npm + sync SKILL.md | `release.sh vX.Y.Z` |
| Only `SKILL.md` changed (typo, doc clarification), no version bump | `sync-skill.sh` |

## Quick reference

```bash
# Full release: npm package + skill.a2hmarket.ai
./scripts/release.sh v0.3.2

# See what would happen without executing
./scripts/release.sh -n v0.3.2

# Already pushed the tag, just need to sync the doc
./scripts/release.sh --skip-npm v0.3.2

# Doc-only update
./scripts/sync-skill.sh
./scripts/sync-skill.sh -n   # dry-run
```

## Why these exist

The `sync-skill-md` cron in `keman-ai/a2hmarket-skills-deploy` was disabled
on 2026-05-07. Merging to public main alone **does not** publish to
`https://skill.a2hmarket.ai/claw/SKILL.md` — a maintainer must explicitly
trigger the sync. These scripts are the supported way to do it without
accidentally forgetting a step (npm CI status, CloudFront cache check,
hosted version verification, etc.). See
`findu-docs/REPOSITORIES.md` for the full publishing rules.

## Pre-flight invariants

`release.sh` will refuse to proceed if:

- not on `main` branch
- working tree dirty
- local `main` ≠ `origin/main`
- tag already exists locally or on origin
- `mcp/package.json` version doesn't match the requested tag

After tagging, it watches the npm publish workflow and verifies the npm
registry has the new version before kicking off the SKILL.md sync. If
the npm step fails, it stops — won't publish a SKILL.md that points at a
package version that doesn't exist.
