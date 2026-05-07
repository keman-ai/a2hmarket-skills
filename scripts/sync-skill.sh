#!/usr/bin/env bash
# Sync the current main-branch SKILL.md to S3 + CloudFront, without touching
# the npm package. Use this for documentation-only updates (e.g. typo fix,
# clarifying a step) where bumping the npm version doesn't make sense.
#
# Usage:
#   scripts/sync-skill.sh
#   scripts/sync-skill.sh -n     # dry run (print actions, no execution)
#
# Exit 0 on success, 1 on pre-flight failure, 3 on sync workflow failure.
#
# This is the SECOND authorized publishing entry point (the other is
# release.sh). The sync-skill-md cron is disabled (2026-05-07) — main merge
# alone does NOT trigger sync.

set -euo pipefail

DRY_RUN=0
PUBLIC_REPO="keman-ai/a2hmarket-skills"
DEPLOY_REPO="keman-ai/a2hmarket-skills-deploy"
SKILL_URL="https://skill.a2hmarket.ai/claw/SKILL.md"

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

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) sed -n '2,/^set/p' "$0" | grep -E '^# ' | sed 's/^# //; s/^#//'; exit 0 ;;
    -n|--dry-run) DRY_RUN=1; shift ;;
    *) err "unknown arg: $1"; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ ! -f "$REPO_ROOT/SKILL.md" ]]; then
  err "expected SKILL.md under $REPO_ROOT — is this an a2hmarket-skills checkout?"
  exit 1
fi
cd "$REPO_ROOT"

# Show the user what's about to be published.
local_version="$(awk -F': ' '/^version:/ { print $2; exit }' SKILL.md | tr -d '\r ')"
local_sha="$(git log -1 --format=%h -- SKILL.md)"
hosted_version="$(curl -s "$SKILL_URL" | awk -F': ' '/^version:/ { print $2; exit }' | tr -d '\r ' 2>/dev/null || echo '?')"

info "sync plan"
echo "  local SKILL.md (commit $local_sha):  version $local_version"
echo "  hosted $SKILL_URL: version $hosted_version"
echo "  this will: trigger sync-skill-md on $DEPLOY_REPO →"
echo "             pull latest SKILL.md from $PUBLIC_REPO main → S3 → CloudFront invalidate"

if [[ "$local_version" == "$hosted_version" ]]; then
  warn "hosted version already matches local. Sync is a no-op (still allowed; CDN cache will be re-warmed)."
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  printf '\nProceed with sync? [y/N] '
  read -r confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    warn "aborted"; exit 1
  fi
fi

info "triggering sync-skill-md on $DEPLOY_REPO"
# Capture trigger time BEFORE the API call (5s buffer for clock skew). We
# use this to filter `gh run list` so we never pick up a previous
# already-completed dispatch run as if it were the one we just triggered.
sync_trigger_ts=$(($(date -u +%s) - 5))
run "gh workflow run sync-skill-md --repo '$DEPLOY_REPO'"

if [[ "$DRY_RUN" -eq 1 ]]; then
  exit 0
fi

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
new_hosted_version="$(curl -s "$SKILL_URL" | awk -F': ' '/^version:/ { print $2; exit }' | tr -d '\r ')"
if [[ -z "$new_hosted_version" ]]; then
  warn "could not extract version from $SKILL_URL — check manually."
elif [[ "$new_hosted_version" != "$local_version" ]]; then
  warn "hosted version is '$new_hosted_version' but local is '$local_version'."
  warn "CloudFront cache may take ~30s; re-curl in a moment to confirm."
else
  ok "hosted SKILL.md now at version $new_hosted_version"
fi
