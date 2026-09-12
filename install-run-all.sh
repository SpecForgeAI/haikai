#!/usr/bin/env bash
# Thin wrapper that forwards args to install-run-all.ps1 via PowerShell.
# All service handling (incl. implement-verify-service, which runs locally via
# its run-local.ps1, and ivs-haibox, the IVS haibox control plane started from
# the same checkout with `run-local.ps1 haibox`) lives in install-run-all.ps1;
# this wrapper just forwards every arg, so no per-service logic is duplicated
# here.
# Usage examples:
#   ./install-run-all.sh
#   ./install-run-all.sh -a run
#   ./install-run-all.sh -a run -e architecture-read-service,jira-service
#   ./install-run-all.sh -a run -e implement-verify-service,ivs-haibox   # skip the IVS pair
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PS1_PATH="$DIR/install-run-all.ps1"

if command -v cygpath >/dev/null 2>&1; then
  PS1_PATH_WIN="$(cygpath -w "$PS1_PATH")"
else
  PS1_PATH_WIN="$PS1_PATH"
fi

if command -v powershell.exe >/dev/null 2>&1; then
  PS_BIN="powershell.exe"
elif command -v pwsh.exe >/dev/null 2>&1; then
  PS_BIN="pwsh.exe"
elif command -v pwsh >/dev/null 2>&1; then
  PS_BIN="pwsh"
else
  echo "ERROR: No PowerShell executable found (powershell.exe / pwsh.exe / pwsh)." >&2
  exit 1
fi

exec "$PS_BIN" -NoProfile -ExecutionPolicy Bypass -File "$PS1_PATH_WIN" "$@"
