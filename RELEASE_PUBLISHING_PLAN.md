# A2H Market Multi-Channel Release Plan

## Goal

Keep the current offline installation contract intact while making marketplace publication repeatable and auditable.

The offline contract that must not break is:

```text
Install this skill: https://a2hmarket.ai/install.zip
agentId=<value>
key=<value>
```

## Release Channels

### 1. Offline Direct

Primary business distribution for A2H users.

Requirements:

- Stable URL: `https://a2hmarket.ai/install.zip`
- Zip root folder must remain `a2hmarket/`
- Package must continue to include:
  - `a2hmarket/SKILL.md`
  - `a2hmarket/package.json`
  - `a2hmarket/a2hmarket-runtime.tgz`
  - `a2hmarket/setup.sh`
  - `a2hmarket/references/*`
- `setup.sh` must continue to support:
  - `./setup.sh --agent-id <ID> --key <KEY>`
  - `AGENT_ID=... AGENT_KEY=... ./setup.sh`

Notes:

- This is a wrapper-style offline bundle.
- It is intentionally different from a registry bundle.
- Marketplace release failures must never block this channel.

### 2. ClawHub Registry

Public source of truth for marketplace distribution.

Requirements:

- Publish a text-only skill folder, not the offline zip wrapper.
- Bundle should contain the runnable source tree directly:
  - `SKILL.md`
  - `setup.sh`
  - `references/`
  - `bin/`
  - `runtime/js/`
  - `scripts/`
  - `package.json`
  - `package-lock.json`
  - `config/config.sh`
- Must not include:
  - `.zip`
  - `.tgz`
  - `dist/`
  - runtime state files

Notes:

- ClawHub is the only channel that should receive direct automated publish actions.
- Current ClawHub listing is out of sync with this repository and should be treated as drift to eliminate.

### 3. SkillHub Mirror

Domestic mirror and accelerated distribution layer.

Observed behavior:

- Public site states skill data comes from ClawHub.
- Public installer and CLI expose search and download only.
- No public publish API or CLI flow was found.

Decision:

- Do not design direct writes to SkillHub.
- Publish to ClawHub, then verify that SkillHub search and download endpoints reflect the new version.

## Source-of-Truth Model

Use one repository with two generated artifacts.

### Artifact A: offline bundle

Purpose:

- feeds `https://a2hmarket.ai/install.zip`
- preserves the current user-facing install contract

Build shape:

- wrapper directory
- embedded runtime tarball
- offline-oriented `SKILL.md`

### Artifact B: registry bundle

Purpose:

- published to ClawHub
- mirrored downstream by SkillHub

Build shape:

- text-only runnable source tree
- registry-oriented `SKILL.md`

## Documentation Strategy

The offline package and public registry should not ship the same preamble.

Recommended structure:

- shared body: transaction flows, commands, references
- offline preamble: trust assumptions and operator guidance for A2H-first installs
- registry preamble: transparent runtime requirements and side effects

Suggested future source files:

- `docs/skill/base.md`
- `docs/skill/offline-preamble.md`
- `docs/skill/registry-preamble.md`

Current repository drift shows why this matters:

- online `install.zip` content is not identical to repository `SKILL.md`
- online `install.zip` `setup.sh` is not identical to repository `setup.sh`

That drift should be closed before enabling unattended release automation.

Current implementation status:

- `packaging/offline/setup.sh` is the offline setup authority
- repository root `setup.sh` is required to stay byte-for-byte in sync
- release builds fail fast if the two files drift

## Versioning

Release version must be treated as skill release metadata, not runtime package metadata.

Current mismatch:

- `package.json` version tracks `a2hmarket-runtime`
- marketplace version tracks the published skill release

Recommendation:

- use `SKILL.md` frontmatter `version` as the single source of truth
- fail release jobs when a manual override does not match `SKILL.md`
- do not infer marketplace version purely from `package.json`

## Required Metadata For Registry Publish

Before the next ClawHub publish, add accurate frontmatter metadata to `SKILL.md`.

Minimum expected declarations:

- `version`
- `metadata.openclaw.requires.env`
- `metadata.openclaw.requires.bins`
- `metadata.openclaw.primaryEnv`
- `metadata.openclaw.homepage`

Reason:

- current registry scan flags the skill mainly because declared metadata does not match actual behavior
- the skill writes config, installs npm deps, starts a listener, and interacts with OpenClaw

## Automation Design

### Workflow A: offline release

Trigger:

- manual only during review phase
- later: release tag or promoted release event

Responsibilities:

1. build offline bundle
2. run offline contract checks
3. produce:
   - versioned zip
   - stable `install.zip`
   - manifest with sha256 and commit
4. upload artifacts
5. deploy to the hosting target for `a2hmarket.ai`

Deployment rule:

- offline deployment is isolated from marketplace deployment

### Workflow B: marketplace release

Trigger:

- manual only during review phase
- later: release tag or promoted release event

Responsibilities:

1. build registry bundle
2. validate text-only constraints
3. publish to ClawHub with a pinned CLI version
4. verify ClawHub version and download
5. poll SkillHub search/download for mirror visibility

Deployment rule:

- SkillHub verification is non-blocking
- offline channel is never rolled back because SkillHub mirror is delayed

## Validation Rules

### Offline contract checks

- zip root is exactly `a2hmarket/`
- `a2hmarket/a2hmarket-runtime.tgz` exists
- `a2hmarket/setup.sh` exists
- `setup.sh --help` still documents `--agent-id` and `--key`

### Registry checks

- no binary payloads
- no `.zip` or `.tgz`
- all files are text-like
- required files exist

## Operational Prerequisites

Before enabling real automated publish:

1. Confirm ClawHub ownership for slug `a2hmarket`.
2. Provide a ClawHub API token with permission to publish that slug.
3. Provide a deployment command or credentials for the offline hosting target behind `a2hmarket.ai`.

Recommended operator runbook:

- [MARKETPLACE_RELEASE_RUNBOOK.md](/Users/champion/Documents/develop/a2hmarket-skills/MARKETPLACE_RELEASE_RUNBOOK.md)

## Open Decisions

- Whether to keep browser authorization as a hard offline contract or a best-effort convenience.
- Whether ClawHub publish should update slug `a2hmarket` in place or move to a new owner/slug after transfer.
- Which storage/deploy mechanism serves `https://a2hmarket.ai/install.zip`.
