#!/usr/bin/env bash
#
# Bundle the src/ folder of every service into ONE shareable zip.
#
# Zips JUST the src/ folder of each service (source code only -- no
# node_modules, no target/ or build output, no other dependencies) into a
# single zip at the repo root. Run it, then share the one resulting file
# (e.g. paste into an AI chat) to share the source of every microservice.
#
# Layouts:
#   default       zip-of-zips: parent holds one "<service>-src.zip" per service.
#   -f | --flat   single flat archive holding "<service>/src/..." for every
#                 service (one extraction; usually easier for an AI to browse).
#
# Service list mirrors install-run-all.sh (the same 9 folders).
#
# Usage:
#   ./zip-all-src.sh
#   ./zip-all-src.sh --flat
#   ./zip-all-src.sh -e architecture-read-service,jira-service
#   ./zip-all-src.sh -o haikai-src.zip --flat
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"

SERVICES=(
  architecture-model-service
  architecture-read-service
  jira-service
  sybase-discovery-sidecar
  gateway
  discovery-service
  api-migration-validation-service
  mcp-server
  frontend
)

OUTFILE="all-services-src.zip"
FLAT=0
EXCLUDE_RAW=""

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--exclude) EXCLUDE_RAW="${2:-}"; shift 2 ;;
    -o|--out)     OUTFILE="${2:-}";     shift 2 ;;
    -f|--flat)    FLAT=1;               shift   ;;
    -h|--help)    usage; exit 0 ;;
    *) echo "ERROR: unknown argument '$1'"; echo; usage; exit 1 ;;
  esac
done

if ! command -v zip >/dev/null 2>&1; then
  echo "ERROR: 'zip' not found on PATH. Install it (e.g. 'sudo apt install zip', 'brew install zip')." >&2
  exit 1
fi

# --- Build the exclude list (comma-separated, trimmed) ---------------------
EXCLUDE_LIST=()
if [[ -n "${EXCLUDE_RAW// /}" ]]; then
  IFS=',' read -ra _parts <<< "$EXCLUDE_RAW"
  for _p in "${_parts[@]}"; do
    _p="$(echo "$_p" | xargs)"
    [[ -n "$_p" ]] && EXCLUDE_LIST+=("$_p")
  done
fi

is_known() { local s; for s in "${SERVICES[@]}"; do [[ "$s" == "$1" ]] && return 0; done; return 1; }
is_excluded() {
  [[ ${#EXCLUDE_LIST[@]} -eq 0 ]] && return 1
  local x; for x in "${EXCLUDE_LIST[@]}"; do [[ "$x" == "$1" ]] && return 0; done; return 1
}

for x in "${EXCLUDE_LIST[@]:-}"; do
  [[ -z "$x" ]] && continue
  if ! is_known "$x"; then
    echo "ERROR: unknown service '$x' in --exclude."
    echo "Valid service names: ${SERVICES[*]}"
    exit 1
  fi
done

OUT="$REPO_ROOT/$OUTFILE"
rm -f "$OUT"

echo
echo "Repo root : $REPO_ROOT"
if [[ $FLAT -eq 1 ]]; then echo "Layout    : flat (<service>/src/...)"; else echo "Layout    : zip-of-zips (<service>-src.zip)"; fi
[[ ${#EXCLUDE_LIST[@]} -gt 0 ]] && echo "Excluded  : ${EXCLUDE_LIST[*]}"
echo

included=()
missing=()

if [[ $FLAT -eq 1 ]]; then
  # One flat archive: <service>/src/... for every service.
  for s in "${SERVICES[@]}"; do
    is_excluded "$s" && continue
    if [[ ! -d "$REPO_ROOT/$s/src" ]]; then
      echo "  SKIP $s (no src/ folder)"; missing+=("$s"); continue
    fi
    ( cd "$REPO_ROOT" && zip -rq "$OUT" "$s/src" )
    echo "  OK   $s"
    included+=("$s")
  done
else
  # Zip-of-zips: stage one <service>-src.zip each (holding src/...), then bundle.
  STAGING="$(mktemp -d)"
  trap 'rm -rf "$STAGING"' EXIT
  for s in "${SERVICES[@]}"; do
    is_excluded "$s" && continue
    if [[ ! -d "$REPO_ROOT/$s/src" ]]; then
      echo "  SKIP $s (no src/ folder)"; missing+=("$s"); continue
    fi
    ( cd "$REPO_ROOT/$s" && zip -rq "$STAGING/$s-src.zip" src )
    echo "  OK   $s"
    included+=("$s")
  done
  if [[ ${#included[@]} -gt 0 ]]; then
    ( cd "$STAGING" && zip -q "$OUT" ./*-src.zip )
  fi
fi

if [[ ${#included[@]} -eq 0 ]]; then
  echo "ERROR: nothing zipped (no src/ folders found)." >&2
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo
echo "Created: $OUT"
echo "  ${#included[@]} service(s), ${SIZE} -- share this single file."
[[ ${#missing[@]} -gt 0 ]] && echo "  Skipped (no src/): ${missing[*]}"
