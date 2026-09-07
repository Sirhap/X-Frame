#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WRANGLER_LOG_PATH="${TMPDIR:-/tmp}/xsxb-wrangler-deploy.log"

DRY_RUN=false
SKIP_CHECKS=false
ALLOW_DIRTY=false
SKIP_HEALTH_CHECK=false
DEPLOY_ENVIRONMENT=""
WRANGLER_ARGUMENTS=()

readonly SCRIPT_NAME="$(basename "$0")"
readonly -a HEALTH_CHECK_URLS=(
  "https://xframe.dpdns.org/"
  "https://xframe.dpdns.org/workspace"
  "https://xsxb.devops9527.dpdns.org/"
  "https://xsxb.devops9527.dpdns.org/workspace"
  "https://xsxb.devops9527.dpdns.org/workspace/resources/import"
  "https://xsxb.devops9527.dpdns.org/workspace/resources/cutout"
  "https://xsxb.devops9527.dpdns.org/workspace/resources/scatter"
  "https://xsxb.devops9527.dpdns.org/workspace/animation/overview"
  "https://xsxb.devops9527.dpdns.org/workspace/animation/transform"
  "https://xsxb.devops9527.dpdns.org/workspace/animation/boxes"
  "https://xsxb.devops9527.dpdns.org/workspace/animation/trails"
  "https://xsxb.devops9527.dpdns.org/workspace/animation/audio"
  "https://xsxb.devops9527.dpdns.org/workspace/animation/attachments"
  "https://xsxb.devops9527.dpdns.org/workspace/delivery/export"
  "https://xsxb.devops9527.dpdns.org/workspace/delivery/godot"
  "https://xsxb.devops9527.dpdns.org/workspace/delivery/codex-pet"
  "https://xsxb.devops9527.dpdns.org/tools/export"
  "https://xsxb.devops9527.dpdns.org/admin/licenses"
  "https://xsxb.devops9527.dpdns.org/api/media-export/capabilities"
  "https://xsxb.devops9527.dpdns.org/tools/watermark"
  "https://xsxb-fast.devops9527.dpdns.org/"
)

export WRANGLER_LOG_PATH

# Prints one deployment step in a consistent, searchable format.
log_step() {
  printf '\n==> %s\n' "$1"
}

# Prints command usage without mutating the current environment.
print_usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [options]

Build, validate, and deploy XSXB Frame Tuner to Cloudflare Workers.

Options:
  --dry-run             Validate the Worker bundle without uploading it.
  --skip-checks         Skip the full test suite; production build and audit still run.
  --allow-dirty         Allow tracked or untracked working-tree changes.
  --skip-health-check   Do not request production URLs after deployment.
  --env <name>          Deploy a configured Wrangler environment.
  -h, --help            Show this help.

Examples:
  npm run deploy:cloudflare:dry-run
  npm run deploy:cloudflare
  bash scripts/deploy-cloudflare.sh --env staging
EOF
}

# Reports the failing line and exits through Bash's original error status.
report_error() {
  local exit_code=$?
  local line_number="${BASH_LINENO[0]:-unknown}"
  printf '\nDeployment failed near line %s (exit %s).\n' "${line_number}" "${exit_code}" >&2
  exit "${exit_code}"
}

trap report_error ERR

# Fails early when a required local executable is unavailable.
require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "${command_name}" >&2
    exit 1
  fi
}

# Rejects accidental production deploys from an uncommitted source tree.
assert_clean_worktree() {
  if "${ALLOW_DIRTY}"; then
    return
  fi
  if [[ -n "$(git status --porcelain=v1 --untracked-files=normal)" ]]; then
    printf 'Working tree is not clean. Commit or stash changes, or pass --allow-dirty.\n' >&2
    git status --short >&2
    exit 1
  fi
}

# Builds Wrangler arguments while preserving dashboard-managed variables.
build_wrangler_arguments() {
  WRANGLER_ARGUMENTS=(deploy --keep-vars)
  if [[ -n "${DEPLOY_ENVIRONMENT}" ]]; then
    WRANGLER_ARGUMENTS+=(--env "${DEPLOY_ENVIRONMENT}")
  fi
  if "${DRY_RUN}"; then
    WRANGLER_ARGUMENTS+=(--dry-run)
    return
  fi
  WRANGLER_ARGUMENTS+=(
    --strict
    --tag "$(git rev-parse --short=12 HEAD)"
    --message "$(git log -1 --pretty=%s)"
  )
}

# Verifies public routes only after a real production deployment.
run_health_checks() {
  local url
  if "${DRY_RUN}" || "${SKIP_HEALTH_CHECK}" || [[ -n "${DEPLOY_ENVIRONMENT}" ]]; then
    return
  fi
  require_command curl
  log_step "Checking production routes"
  for url in "${HEALTH_CHECK_URLS[@]}"; do
    curl \
      --fail \
      --silent \
      --show-error \
      --location \
      --retry 4 \
      --retry-all-errors \
      --retry-delay 2 \
      --max-time 20 \
      --output /dev/null \
      "${url}"
    printf 'OK  %s\n' "${url}"
  done
}

while (($# > 0)); do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --skip-checks)
      SKIP_CHECKS=true
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      ;;
    --skip-health-check)
      SKIP_HEALTH_CHECK=true
      ;;
    --env)
      if (($# < 2)) || [[ -z "$2" ]]; then
        printf '%s requires an environment name.\n' "$1" >&2
        exit 2
      fi
      DEPLOY_ENVIRONMENT="$2"
      shift
      ;;
    -h | --help)
      print_usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      print_usage >&2
      exit 2
      ;;
  esac
  shift
done

cd "${PROJECT_ROOT}"

require_command git
require_command node
require_command npm
require_command npx
assert_clean_worktree

log_step "Using local Wrangler"
npx --no-install wrangler --version

if "${SKIP_CHECKS}"; then
  log_step "Building production assets"
  npm run build:cloudflare
  log_step "Auditing production assets"
  npm run audit:production
else
  log_step "Running Cloudflare checks"
  npm run check:cloudflare
fi

build_wrangler_arguments

if "${DRY_RUN}"; then
  log_step "Running final deployment dry-run"
else
  log_step "Deploying commit $(git rev-parse --short=12 HEAD)"
fi
npx --no-install wrangler "${WRANGLER_ARGUMENTS[@]}"

run_health_checks

if "${DRY_RUN}"; then
  log_step "Cloudflare deployment dry-run completed"
else
  log_step "Cloudflare deployment completed"
fi
