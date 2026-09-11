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
    2. Any java/node/python/uvicorn/npm process matched THREE ways:
       a. executable path or command line under this repo root;
       b. launcher SIGNATURES in the command line (debug_worker, src.api,
          src.entrypoints, --multiprocessing-fork, spring-boot:run,
          run-local.ps1) -- catches the orphaned IVS multiprocessing
          workers that run from a SYSTEM python.exe with a generic
          "-c from multiprocessing.spawn import spawn_main ..." command
          line: neither exe nor args carry the repo path (only their CWD
          did, which Win32_Process does not expose), so path matching
          alone let them survive and keep the folder locked;
       c. a process-TREE walk: every matched process's runtime
          descendants are swept too, so forks whose parent already
          exited still go.

  It does NOT touch this Kiro/VS Code session, other editors, or processes
  outside the repo. The script's own process ancestry is explicitly
  protected from the sweep.

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
#   maven : 8080 ams, 8079 ars, 8078 jira, 8093 db-sidecar
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

# --- 2. Kill leftover children spawned by our services -------------------------
# Catches detached JVMs, node/vite watchers, the uvicorn reloader, the separate
# IVS worker PowerShell window's python, AND the orphaned IVS multiprocessing
# forks. Those forks run from the SYSTEM python.exe with a generic
# "-c from multiprocessing.spawn import spawn_main ... --multiprocessing-fork"
# command line -- neither exe nor args carry the repo path (only their CWD did,
# which Win32_Process does not expose), so repo-path matching alone missed them.
# Three-way match: repo path in exe/cmdline, launcher signatures, then a
# process-tree walk over every match's descendants.
Write-Host ""
Write-Host "=== Stopping leftover processes rooted in the repo ===" -ForegroundColor Cyan

$targetNames = 'java', 'javaw', 'node', 'python', 'pythonw', 'uvicorn', 'npm', 'mvn'

# Launcher signatures that identify OUR spawned processes regardless of where
# the executable lives (see install-run-all.ps1 / implement-verify-service\
# run-local.ps1: `python -m src.entrypoints.debug_worker`, uvicorn on src.api,
# `mvn spring-boot:run`, and Python multiprocessing's spawn forks).
$launcherSignature = '(?i)(debug_worker|src\.api|src\.entrypoints|--multiprocessing-fork|spring-boot:run|run-local\.ps1)'

# One CIM snapshot for matching AND the tree walk.
$allProcs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$procById = @{}
$childrenByParent = @{}
foreach ($p in $allProcs) {
  $procById[[int]$p.ProcessId] = $p
  $parentId = [int]$p.ParentProcessId
  if (-not $childrenByParent.ContainsKey($parentId)) {
    $childrenByParent[$parentId] = New-Object System.Collections.Generic.List[object]
  }
  $childrenByParent[$parentId].Add($p)
}

# Guard: never touch this script's own ancestry (the invoking shell, the
# editor session hosting it, and so on up the chain).
$protected = New-Object System.Collections.Generic.HashSet[int]
$cursor = [int]$PID
while ($cursor -gt 0 -and $protected.Add($cursor)) {
  $me = $procById[$cursor]
  $cursor = if ($me) { [int]$me.ParentProcessId } else { 0 }
}

# Why a process is ours -- the reason names the matching RULE so a -WhatIf
# review explains why e.g. a system-python fork got flagged. Null = not ours.
function Get-MatchReason($Process) {
  $name = ($Process.Name -replace '\.exe$', '')
  if ($targetNames -notcontains $name) { return $null }
  if ($Process.ExecutablePath -and
      $Process.ExecutablePath.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return "repo-rooted $($Process.Name)"
  }
  if ($Process.CommandLine -and $Process.CommandLine -match [Regex]::Escape($repoRoot)) {
    return "repo path in command line ($($Process.Name))"
  }
  if ($Process.CommandLine -and $Process.CommandLine -match $launcherSignature) {
    return "launcher signature '$($Matches[1])' ($($Process.Name))"
  }
  return $null
}

$matched = @($allProcs | Where-Object { Get-MatchReason $_ })

# Breadth-first descendants of one PID from the snapshot (visited-set bounded
# against parent-PID cycles from PID reuse).
function Get-Descendants([int]$RootPid) {
  $out = New-Object System.Collections.Generic.List[object]
  $visited = New-Object System.Collections.Generic.HashSet[int]
  $queue = New-Object System.Collections.Generic.Queue[int]
  $queue.Enqueue($RootPid)
  [void]$visited.Add($RootPid)
  while ($queue.Count -gt 0) {
    $current = $queue.Dequeue()
    if (-not $childrenByParent.ContainsKey($current)) { continue }
    foreach ($child in $childrenByParent[$current]) {
      $childId = [int]$child.ProcessId
      if ($visited.Add($childId)) {
        $out.Add($child)
        $queue.Enqueue($childId)
      }
    }
  }
  return $out
}

foreach ($proc in $matched) {
  $procId = [int]$proc.ProcessId
  if ($protected.Contains($procId)) { continue }
  # Descendants first (from the snapshot), so a killed parent can't orphan
  # forks we haven't reached yet -- then the matched process itself.
  foreach ($descendant in (Get-Descendants $procId)) {
    $descendantId = [int]$descendant.ProcessId
    if ($protected.Contains($descendantId)) { continue }
    Stop-One -ProcId $descendantId -Reason "descendant of PID $procId ($($proc.Name))"
  }
  Stop-One -ProcId $procId -Reason (Get-MatchReason $proc)
}

Write-Host ""
Write-Host "Done. If the folder still won't delete, run this once more, then" -ForegroundColor Green
Write-Host "close any remaining Windows Terminal / worker windows manually." -ForegroundColor Green
Write-Host "Tip: 'handle64 <folder>' or Resource Monitor > CPU > Associated Handles" -ForegroundColor DarkGray
Write-Host "     will name any straggler still holding the folder." -ForegroundColor DarkGray
