#!/usr/bin/env bash
# Release a new @a2hmarket/a2h-mcp version end-to-end:
#   1. Validate working tree state (on main, clean, in sync with origin)
#   2. Confirm package.json version matches the requested tag
#   3. Tag, push tag → GitHub Actions release.yml publishes to npm
#   4. Verify npm registry has the new version
#   5. Trigger sync-skill-md workflow → S3 → CloudFront
#   6. Verify hosted SKILL.md version matches expectations
#
# Usage:
#   scripts/release.sh v0.3.2
#   scripts/release.sh -n v0.3.2            # dry run (print commands, no actions)
#   scripts/release.sh --skip-skill v0.3.2  # publish npm only, don't sync CDN
#   scripts/release.sh --skip-npm v0.3.2    # CDN sync only (assumes tag already pushed)
#
# Exit codes:
#   0  success
#   1  pre-flight failed (dirty tree, wrong branch, version mismatch, etc.)
#   2  npm publish CI failed
#   3  CDN sync failed
#
# This script is the SINGLE authorized publishing entry point. The sync-skill-md
# cron is disabled (2026-05-07) — main merge alone does NOT trigger CDN sync.

set -euo pipefail

DRY_RUN=0
SKIP_SKILL=0
SKIP_NPM=0
VERSION=""

# Repos involved (kept in one place for visibility).
PUBLIC_REPO="keman-ai/a2hmarket-skills"
DEPLOY_REPO="keman-ai/a2hmarket-skills-deploy"
SKILL_URL="https://skill.a2hmarket.ai/claw/SKILL.md"
NPM_PKG="@a2hmarket/a2h-mcp"

usage() {
  sed -n '2,/^set/p' "$0" | grep -E '^# ' | sed 's/^# //; s/^#//'
  exit 0
}

err() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
info() { printf '\033[36m→ %s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m⚠ %s\033[0m\n' "$*"; }

run() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    printf '\033[35m[dry-run] %s\033[0m\n' "$*"
  else
    eval "$@"
  fi
}

# Parse args.
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage ;;
    -n|--dry-run) DRY_RUN=1; shift ;;
    --skip-skill) SKIP_SKILL=1; shift ;;
    --skip-npm) SKIP_NPM=1; shift ;;
    -*) err "unknown flag: $1"; usage ;;
    *)
      if [[ -n "$VERSION" ]]; then
        err "version already set to '$VERSION', got '$1'"; exit 1
      fi
      VERSION="$1"; shift ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  err "version required (e.g. v0.3.2)"; usage
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]]; then
  err "version must look like v0.3.2 or v0.3.2-rc.1, got '$VERSION'"; exit 1
fi

VERSION_NO_V="${VERSION#v}"

# Resolve the script's home repo: walk up to the dir containing mcp/package.json.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ ! -f "$REPO_ROOT/mcp/package.json" ]]; then
  err "expected mcp/package.json under $REPO_ROOT — is this an a2hmarket-skills checkout?"
  exit 1
fi
cd "$REPO_ROOT"

info "release plan"
echo "  repo:        $PUBLIC_REPO"
echo "  branch:      main (will tag here)"
echo "  tag:         $VERSION"
echo "  npm version: $VERSION_NO_V"
echo "  npm pkg:     $NPM_PKG"
echo "  skip-npm:    $SKIP_NPM"
echo "  skip-skill:  $SKIP_SKILL"
echo "  dry-run:     $DRY_RUN"

# ── Pre-flight ────────────────────────────────────────────────────────────────

if [[ "$SKIP_NPM" -eq 0 ]]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [[ "$branch" != "main" ]]; then
    err "must be on main branch, currently on '$branch'"; exit 1
  fi
  if [[ -n "$(git status --porcelain)" ]]; then
    err "working tree is dirty. Commit or stash first:"
    git status --short
    exit 1
  fi
  info "fetching origin..."
  git fetch origin --tags
  local_sha="$(git rev-parse HEAD)"
  origin_sha="$(git rev-parse origin/main)"
  if [[ "$local_sha" != "$origin_sha" ]]; then
    err "local main ($local_sha) != origin/main ($origin_sha). Pull / push first."
    exit 1
  fi
  if git rev-parse "refs/tags/$VERSION" >/dev/null 2>&1; then
    err "tag $VERSION already exists locally. Delete it (git tag -d $VERSION) or pick another version."
    exit 1
  fi
  if git ls-remote --tags origin "refs/tags/$VERSION" | grep -q "$VERSION"; then
    err "tag $VERSION already exists on origin. Pick another version."
    exit 1
  fi
  pkg_version="$(node -p "require('./mcp/package.json').version")"
  if [[ "$pkg_version" != "$VERSION_NO_V" ]]; then
    err "mcp/package.json version is '$pkg_version', tag asks for '$VERSION_NO_V'."
    err "Bump package.json + commit + push, then re-run."
    exit 1
  fi
  ok "pre-flight clean"
fi

# Final confirm — give a chance to abort.
if [[ "$DRY_RUN" -eq 0 ]]; then
  printf '\nProceed with release? [y/N] '
  read -r confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    warn "aborted"; exit 1
  fi
fi

# ── 1. Tag + push → triggers npm publish CI ───────────────────────────────────

if [[ "$SKIP_NPM" -eq 0 ]]; then
  info "tag + push $VERSION (triggers release.yml CI on $PUBLIC_REPO)"
  run "git tag '$VERSION'"
  run "git push origin '$VERSION'"

  if [[ "$DRY_RUN" -eq 0 ]]; then
    info "waiting for release.yml run to start..."
    # GH may take a few seconds to register the tag-triggered workflow.
    for i in 1 2 3 4 5 6 7 8 9 10; do
      run_id="$(gh run list --repo "$PUBLIC_REPO" --workflow release.yml --limit 1 --json databaseId,headBranch --jq '.[0] | select(.headBranch == "'"$VERSION"'") | .databaseId' 2>/dev/null || true)"
      [[ -n "$run_id" ]] && break
      sleep 2
    done
    if [[ -z "$run_id" ]]; then
      err "release.yml run for $VERSION did not start within 20s. Check $PUBLIC_REPO Actions tab."
      exit 2
    fi
    info "watching CI run $run_id..."
    if ! gh run watch "$run_id" --repo "$PUBLIC_REPO" --exit-status >/dev/null; then
      err "release.yml CI failed. See https://github.com/$PUBLIC_REPO/actions/runs/$run_id"
      exit 2
    fi
    ok "release.yml succeeded"

    info "verifying npm registry..."
    actual="$(npm view "$NPM_PKG" version 2>/dev/null || true)"
    if [[ "$actual" != "$VERSION_NO_V" ]]; then
      err "npm registry shows '$actual', expected '$VERSION_NO_V'"
      err "(could be propagation lag — try \`npm view $NPM_PKG version\` again in 30s)"
      exit 2
    fi
    ok "npm publish landed: $NPM_PKG@$VERSION_NO_V"
  fi
fi

# ── 2. Sync SKILL.md → S3 + CloudFront ────────────────────────────────────────

if [[ "$SKIP_SKILL" -eq 0 ]]; then
  info "triggering sync-skill-md on $DEPLOY_REPO"
  # Capture trigger time BEFORE the API call. Subtract a 5s buffer to absorb
  # local-vs-github clock skew. We use this to filter `gh run list` so we
  # never pick up a previous already-completed dispatch run as if it were
  # the one we just triggered (the bug that masked a stale "✓ succeeded"
  # report during v0.3.2 release).
  sync_trigger_ts=$(($(date -u +%s) - 5))
  run "gh workflow run sync-skill-md --repo '$DEPLOY_REPO'"

  if [[ "$DRY_RUN" -eq 0 ]]; then
    # Wait for the manual run to register (workflow_dispatch is async).
    info "waiting for sync run..."
    sync_run_id=""
    for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
      # Filter to runs strictly newer than our trigger timestamp.
      sync_run_id="$(gh run list --repo "$DEPLOY_REPO" --workflow sync-skill-md --event workflow_dispatch --limit 5 --json databaseId,createdAt --jq ".[] | select((.createdAt | fromdateiso8601) >= $sync_trigger_ts) | .databaseId" 2>/dev/null | head -1 || true)"
      [[ -n "$sync_run_id" ]] && break
      sleep 2
    done
    if [[ -z "$sync_run_id" ]]; then
      err "sync-skill-md run did not start within 30s. Check $DEPLOY_REPO Actions tab."
      exit 3
    fi
    info "watching sync run $sync_run_id..."
    if ! gh run watch "$sync_run_id" --repo "$DEPLOY_REPO" --exit-status >/dev/null; then
      err "sync-skill-md failed. See https://github.com/$DEPLOY_REPO/actions/runs/$sync_run_id"
      exit 3
    fi
    ok "sync-skill-md succeeded"

    info "verifying hosted SKILL.md..."
    hosted_version="$(curl -s "$SKILL_URL" | awk -F': ' '/^version:/ { print $2; exit }' | tr -d '\r ')"
    if [[ -z "$hosted_version" ]]; then
      warn "could not extract version from $SKILL_URL — check manually."
    else
      ok "hosted SKILL.md version: $hosted_version (CloudFront cache may take ~30s to fully propagate)"
    fi
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

ok "release complete"
[[ "$SKIP_NPM"   -eq 0 ]] && echo "  npm:   $NPM_PKG@$VERSION_NO_V"
[[ "$SKIP_SKILL" -eq 0 ]] && echo "  skill: $SKILL_URL"
