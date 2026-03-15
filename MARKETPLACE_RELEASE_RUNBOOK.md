# Marketplace Release Runbook

## Scope

This runbook covers the public marketplace release path:

- ClawHub publish
- SkillHub mirror verification

It does **not** replace the offline release path for `https://a2hmarket.ai/install.zip`.

## Current facts

As verified on 2026-03-13:

- public ClawHub slug: `a2hmarket`
- public ClawHub owner handle: `@xemaya`
- public SkillHub entry for `a2hmarket` is visible through search/download, but publish remains downstream from ClawHub

## Preconditions

Before using the GitHub Actions workflow, confirm all of the following:

1. `SKILL.md` frontmatter `version` has been updated for this release.
2. `./scripts/build-registry-bundle.sh` succeeds locally.
3. You control the ClawHub slug `a2hmarket`, or you have accepted a transfer for it.
4. You have a valid `CLAWHUB_TOKEN` that can publish that slug.

## Ownership transfer

If the target slug is still owned by another handle, request transfer before enabling automation.

Requester:

```bash
clawhub login
clawhub transfer request a2hmarket @TARGET_HANDLE --message "Transfer a2hmarket release ownership" --yes
```

Recipient:

```bash
clawhub login
clawhub transfer accept a2hmarket --yes
```

Verify:

```bash
clawhub whoami
curl -fsSL https://clawhub.ai/api/v1/skills/a2hmarket | python3 -c 'import json,sys; data=json.load(sys.stdin); print(data["owner"]["handle"])'
```

## Required GitHub secrets

- `CLAWHUB_TOKEN`
- `A2HMARKET_OFFLINE_DEPLOY_COMMAND` for the offline workflow only

## Recommended release order

1. Update [SKILL.md](/Users/champion/Documents/develop/a2hmarket-skills/SKILL.md) `version`.
2. Update changelog text for the marketplace workflow input.
3. Run local checks:

```bash
./scripts/build-offline-install.sh
./scripts/build-registry-bundle.sh
```

4. Run `offline-release` workflow if `install.zip` should move.
5. Run `marketplace-release` workflow.
6. Confirm:
   - ClawHub version matches `SKILL.md`
   - SkillHub mirror resolves the same version

## Local smoke commands

```bash
./scripts/build-registry-bundle.sh
CLAWHUB_TOKEN=clh_xxx ./scripts/publish-clawhub.sh \
  --slug a2hmarket \
  --name "agent to human market" \
  --version 1.0.18 \
  --tags latest \
  --changelog "Release notes"
python3 ./scripts/verify-clawhub-release.py --slug a2hmarket --version 1.0.18
python3 ./scripts/verify-skillhub-mirror.py --slug a2hmarket --version 1.0.18
```

## Roll-forward policy

Do not delete a bad public release unless required by policy.

Preferred response:

1. fix the issue in git
2. bump `SKILL.md` version
3. publish a new patch version

## Known non-automatable inputs

- final changelog text
- ClawHub ownership transfer acceptance
- offline hosting deployment command or credentials
