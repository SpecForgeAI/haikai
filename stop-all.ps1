<#
.SYNOPSIS
  Stop everything started by install-run-all.ps1 so the repo folder can be
  deleted (fresh git clone workflow).

.DESCRIPTION
  Closing the Windows Terminal tabs does NOT reliably kill what runs inside
  them: `mvn spring-boot:run` forks a detached JVM, `npm run dev` / `uvicorn
  --reload` spawn watcher children, and implement-verify-service\run-local.ps1
  opens a SEPARATE PowerShell window for its background worker. Any of those
  left running holds a working directory / open file handle inside the repo,
  and Windows then refuses to delete the folder.

  This script terminates, in order:
    1. Any process LISTENING on a known service port (freeing the ports).
    2. Any java/node/python/uvicorn/npm process whose executable path or
       working directory is UNDER this repo root (catches the detached
       children + the separate IVS worker window that no longer own a port).

  It does NOT touch this Kiro/VS Code session, other editors, or processes
  outside the repo.

.PARAMETER WhatIf
  Show what would be killed without killing anything.

.EXAMPLES
  .\stop-all.ps1
  .\stop-all.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param()

$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$repoRoot = (Resolve-Path $repoRoot).Path

# Pre-load CimCmdlets OUTSIDE the WhatIf scope: its module-init alias creation
# honours $WhatIfPreference and would otherwise spray "What if: Set Alias"
# noise into a -WhatIf run when Get-CimInstance auto-loads it later.
& { $WhatIfPreference = $false; Import-Module CimCmdlets -ErrorAction SilentlyContinue }

# Ports used by the 10 services (see install-run-all.ps1 / config files):
#   maven : 8080 ams, 8079 ars, 8078 jira, 8093 sybase-sidecar
#   npm   : 8081 gateway, 8091 discovery, 8092 api-migration-validation, 8090 mcp
#   vite  : 5173 frontend
#   python (IVS): 8000 uvicorn
$ports = 8078, 8079, 8080, 8081, 8090, 8091, 8092, 8093, 5173, 8000

Write-Host ""
Write-Host "Repo root : $repoRoot"
Write-Host "Ports     : $($ports -join ', ')"
Write-Host ""

# Track PIDs we've already handled so we don't try twice.
$handled = New-Object System.Collections.Generic.HashSet[int]

function Stop-One([int]$ProcId, [string]$Reason) {
  if ($ProcId -le 4) { return }                     # skip System/Idle
  if (-not $handled.Add($ProcId)) { return }        # already handled
  $p = Get-Process -Id $ProcId -ErrorAction SilentlyContinue
  if (-not $p) { return }
  $label = "PID $ProcId ($($p.ProcessName)) - $Reason"
  if ($PSCmdlet.ShouldProcess($label, 'Stop-Process')) {
    try {
      Stop-Process -Id $ProcId -Force -ErrorAction Stop
      Write-Host "  killed  $label" -ForegroundColor Green
    } catch {
      Write-Host "  FAILED  $label -> $($_.Exception.Message)" -ForegroundColor Red
    }
  } else {
    Write-Host "  would kill  $label" -ForegroundColor Yellow
  }
}

# --- 1. Kill whatever is LISTENING on the known ports --------------------------
Write-Host "=== Stopping listeners on known ports ===" -ForegroundColor Cyan
foreach ($port in $ports) {
  $conns = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
  if (-not $conns) { continue }
  foreach ($owningPid in ($conns.OwningProcess | Sort-Object -Unique)) {
    Stop-One -ProcId $owningPid -Reason "listening on port $port"
  }
}

# --- 2. Kill leftover children whose image/CWD is under the repo ---------------
# Catches detached JVMs, node/vite watchers, the uvicorn reloader, and the
# separate IVS worker PowerShell window that may no longer hold a port but still
# lock files inside the repo.
Write-Host ""
Write-Host "=== Stopping leftover processes rooted in the repo ===" -ForegroundColor Cyan

$targetNames = 'java', 'javaw', 'node', 'python', 'pythonw', 'uvicorn', 'npm', 'mvn'

# Query once via CIM to get ExecutablePath + CommandLine (CWD isn't directly
# exposed, so we match on the executable path and the command line, both of
# which reference the repo path for our spawned processes).
$cim = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $name = ($_.Name -replace '\.exe$', '')
  if ($targetNames -notcontains $name) { return $false }
  $inRepo =
    ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) -or
    ($_.CommandLine    -and $_.CommandLine    -match [Regex]::Escape($repoRoot))
  return $inRepo
}

foreach ($proc in $cim) {
  Stop-One -ProcId ([int]$proc.ProcessId) -Reason "repo-rooted $($proc.Name)"
}

Write-Host ""
Write-Host "Done. If the folder still won't delete, run this once more, then" -ForegroundColor Green
Write-Host "close any remaining Windows Terminal / worker windows manually." -ForegroundColor Green
Write-Host "Tip: 'handle64 <folder>' or Resource Monitor > CPU > Associated Handles" -ForegroundColor DarkGray
Write-Host "     will name any straggler still holding the folder." -ForegroundColor DarkGray
