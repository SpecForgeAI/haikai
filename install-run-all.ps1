<#
.SYNOPSIS
  Install and/or run all 10 services in dev mode, each in its own Windows Terminal tab.

.PARAMETER Action
  install | run | all   (default: all)
    install -> mvn -DskipTests clean package  (maven)  /  npm ci  (npm)  /  venv + pip install -r requirements.txt (python)
    run     -> mvn spring-boot:run            (maven)  /  npm run dev (npm)  /  .\run-local.ps1                     (python)
               .\run-local.ps1 haibox (ivs-haibox: the IVS haibox control plane on 127.0.0.1:8780, same checkout + venv as
               implement-verify-service, so it installs nothing of its own)
    all     -> install then run

.PARAMETER Exclude
  Comma-separated list of service folder names to skip.

.PARAMETER Trace
  off | summary | detail   (default: summary)
    Sets HAIKAI_TRACE for each spawned service tab so the instrumented services
    write to the shared trace file (~/.haikai/trace.log) — including the
    HAIKAI_PREDICATE / HAIKAI_SCORECARD self-scoring lines the run judge reads
    (docs/run-judge/RUN_JUDGE_INSTRUCTIONS.md). Pass -t off to disable.
    See docs/trace-logging.md.

.EXAMPLES
  ./install-run-all.ps1
  ./install-run-all.ps1 -a run
  ./install-run-all.ps1 -a run -e architecture-read-service,jira-service
  ./install-run-all.ps1 -action install -exclude frontend
  ./install-run-all.ps1 -a run -t detail
#>
param(
  [Alias('a')]
  [ValidateSet('install','run','all')]
  [string]$Action = 'all',

  [Alias('e')]
  [string[]]$Exclude = @(),

  [Alias('t')]
  [ValidateSet('off','summary','detail')]
  [string]$Trace = 'summary'
)

$ErrorActionPreference = 'Stop'

$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

$services = @(
  [pscustomobject]@{ Name='architecture-model-service';        Type='maven' },
  [pscustomobject]@{ Name='architecture-read-service';         Type='maven' },
  [pscustomobject]@{ Name='jira-service';                      Type='maven' },
  [pscustomobject]@{ Name='db-discovery-sidecar';              Type='maven' },
  [pscustomobject]@{ Name='gateway';                           Type='npm'   },
  [pscustomobject]@{ Name='discovery-service';                 Type='npm'   },
  [pscustomobject]@{ Name='api-migration-validation-service';  Type='npm'   },
  [pscustomobject]@{ Name='mcp-server';                        Type='npm'   },
  [pscustomobject]@{ Name='frontend';                          Type='npm'   },
  # implement-verify-service runs LOCALLY via the usual python commands (NOT
  # docker): install = non-interactive equivalent of its setup-local-env.ps1
  # (.venv-local + pip install -r requirements.txt + Claude CLI); run = its
  # own run-local.ps1 (loads .env.local, starts the worker window + uvicorn
  # on port 8000 with hot reload).
  [pscustomobject]@{ Name='implement-verify-service';          Type='python' },
  # ivs-haibox (2026-09-12): the IVS haibox control plane (target-service
  # boxes for the deploy + API reconcile step) on 127.0.0.1:8780. Without it
  # a service-plane deploy fails AFTER the implement succeeded and the MR is
  # open. It runs from the implement-verify-service checkout with the SAME
  # venv + .env.local (`.\run-local.ps1 haibox`), so it has no install step
  # of its own; `Dir` points the tab at that checkout. Listed AFTER the IVS
  # entry so the IVS install lands first.
  [pscustomobject]@{ Name='ivs-haibox';                        Type='haibox'; Dir='implement-verify-service' }
)

# A service runs from its own folder unless it declares `Dir` (shared checkout).
function Service-Path([object]$svc) {
  $dir = if ($svc.PSObject.Properties['Dir'] -and $svc.Dir) { $svc.Dir } else { $svc.Name }
  return (Join-Path $repoRoot $dir)
}

$knownNames = $services | ForEach-Object { $_.Name }

$excludeSet = @()
if ($Exclude -and $Exclude.Count -gt 0) {
  $excludeSet = $Exclude |
    ForEach-Object { $_ -split ',' } |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }
}
foreach ($x in $excludeSet) {
  if ($knownNames -notcontains $x) {
    Write-Host "ERROR: unknown service '$x' in -exclude." -ForegroundColor Red
    Write-Host "Valid service names:" -ForegroundColor Yellow
    $knownNames | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
}

$selected = @($services | Where-Object { $excludeSet -notcontains $_.Name })
if ($selected.Count -eq 0) {
  Write-Host "ERROR: all services excluded; nothing to do." -ForegroundColor Red
  exit 1
}

$doInstall = ($Action -eq 'install') -or ($Action -eq 'all')
$doRun     = ($Action -eq 'run')     -or ($Action -eq 'all')

Write-Host ""
Write-Host "Repo root : $repoRoot"
Write-Host "Action    : $Action"
Write-Host "Excluded  : $(if ($excludeSet.Count) { $excludeSet -join ', ' } else { '(none)' })"
Write-Host "Trace     : $Trace"
Write-Host "Selected  :"
$selected | ForEach-Object { Write-Host ("  - {0,-40} [{1}]" -f $_.Name, $_.Type) }
Write-Host ""

function Require-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' not found on PATH."
  }
}

$needMaven  = ($selected | Where-Object { $_.Type -eq 'maven'  }).Count -gt 0
$needNpm    = ($selected | Where-Object { $_.Type -eq 'npm'    }).Count -gt 0
$needDocker = ($selected | Where-Object { $_.Type -eq 'docker' }).Count -gt 0
$needPython = ($selected | Where-Object { $_.Type -eq 'python' -or $_.Type -eq 'haibox' }).Count -gt 0
if ($needMaven)  { Require-Command 'java'; Require-Command 'mvn' }
if ($needNpm)    { Require-Command 'npm' }
if ($needDocker) { Require-Command 'docker' }
# python services also need npm: the IVS worker shells out to the locally
# installed Claude Code CLI (node_modules/.bin), installed during the
# install phase when absent.
if ($needPython) { Require-Command 'python'; Require-Command 'npm' }

if ($doInstall) {
  Write-Host "=== INSTALL phase ===" -ForegroundColor Cyan
  foreach ($svc in $selected) {
    $path = Service-Path $svc
    if (-not (Test-Path $path)) { throw "Service path not found: $path" }

    Write-Host ""
    Write-Host "--- Installing $($svc.Name) [$($svc.Type)] ---" -ForegroundColor Yellow
    Push-Location $path
    try {
      if ($svc.Type -eq 'haibox') {
        # Shares implement-verify-service's venv, Claude CLI and .env.local:
        # that entry's install covers it. Only the box work root is ensured.
        New-Item -ItemType Directory -Force -Path 'api_workspace\haibox' | Out-Null
        Write-Host "ivs-haibox shares the implement-verify-service install (nothing to do)."
      } elseif ($svc.Type -eq 'maven') {
        & mvn -DskipTests clean package
      } elseif ($svc.Type -eq 'docker') {
        # Build the dev image (source is volume-mounted at run time for hot reload).
        & docker compose -f $svc.Compose build
      } elseif ($svc.Type -eq 'python') {
        # Non-interactive equivalent of the service's setup-local-env.ps1
        # (that script Read-Host-prompts when the venv / node_modules already
        # exist, so it cannot run unattended). Idempotent: existing venv /
        # node_modules / .env.local are reused, dependencies are re-synced.
        if (-not (Test-Path '.venv-local')) {
          & python -m venv .venv-local
          if ($LASTEXITCODE -ne 0) { throw "venv creation failed for $($svc.Name) (exit code $LASTEXITCODE)." }
        }
        $venvPython = Join-Path (Get-Location) '.venv-local\Scripts\python.exe'
        & $venvPython -m pip install --upgrade pip --quiet
        if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed for $($svc.Name) (exit code $LASTEXITCODE)." }
        & $venvPython -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "pip install failed for $($svc.Name) (exit code $LASTEXITCODE)." }
        if (-not (Test-Path 'node_modules')) {
          # The IVS worker shells out to the locally installed Claude Code CLI.
          & npm install @anthropic-ai/claude-code
          if ($LASTEXITCODE -ne 0) { throw "Claude CLI install failed for $($svc.Name) (exit code $LASTEXITCODE)." }
        }
        foreach ($dir in @('api_workspace', 'workspace', 'logs\orchestration', 'output')) {
          New-Item -ItemType Directory -Force -Path $dir | Out-Null
        }
        if (-not (Test-Path '.env.local')) {
          if (Test-Path '.env.example') {
            Copy-Item '.env.example' '.env.local'
            Write-Host "Created .env.local from .env.example - EDIT IT and add your API keys before running." -ForegroundColor Red
          } else {
            Write-Host "WARNING: no .env.local and no .env.example to copy - run-local.ps1 will refuse to start." -ForegroundColor Red
          }
        }
      } else {
        & npm ci
      }
      if ($LASTEXITCODE -ne 0) {
        throw "Install failed for $($svc.Name) (exit code $LASTEXITCODE)."
      }
    } finally {
      Pop-Location
    }
  }
  Write-Host ""
  Write-Host "All installs complete." -ForegroundColor Green
}

if ($doRun) {
  Write-Host ""
  Write-Host "=== RUN phase ===" -ForegroundColor Cyan

  if (-not (Get-Command wt.exe -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: wt.exe (Windows Terminal) not found on PATH." -ForegroundColor Red
    Write-Host "Install via Microsoft Store or: winget install Microsoft.WindowsTerminal" -ForegroundColor Yellow
    exit 1
  }

  $wtArgs = New-Object System.Collections.Generic.List[string]
  $wtArgs.Add('-w'); $wtArgs.Add('0')

  $first = $true
  foreach ($svc in $selected) {
    $path = Service-Path $svc
    if (-not (Test-Path $path)) { throw "Service path not found: $path" }

    $runCmd =
      if     ($svc.Type -eq 'maven')  { 'mvn spring-boot:run' }
      elseif ($svc.Type -eq 'docker') { "docker compose -f $($svc.Compose) up" }
      elseif ($svc.Type -eq 'haibox') {
        # The IVS haibox control plane (loopback 8780) from the same checkout.
        '.\run-local.ps1 haibox'
      }
      elseif ($svc.Type -eq 'python') {
        # The service's own local runner: activates .venv-local, loads
        # .env.local, spawns the background worker window, then runs
        # uvicorn on port 8000 with hot reload.
        '.\run-local.ps1'
      }
      else                            { 'npm run dev' }

    if (-not $first) { $wtArgs.Add(';') }
    $first = $false

    $wtArgs.Add('new-tab')
    $wtArgs.Add('--title');  $wtArgs.Add($svc.Name)
    $wtArgs.Add('-d');       $wtArgs.Add($path)
    $wtArgs.Add('powershell')
    $wtArgs.Add('-NoExit')
    if ($Trace -ne 'off' -and $svc.Type -ne 'docker') {
      # Docker services run in a container and won't inherit the tab's HAIKAI_TRACE
      # env var, so the trace injection is skipped for them (plain -Command below).
      # Set HAIKAI_TRACE inside the tab. We need a "$env:...='x'; <run>" statement
      # separator (';'), but wt.exe treats a bare ';' as ITS OWN tab delimiter
      # (see the $wtArgs.Add(';') above) -- passing it via -Command splits the
      # command and wt tries to launch the run word as an exe (0x80070002). So we
      # base64-encode the statement (UTF-16LE) and use -EncodedCommand: the b64 has
      # no ';' for wt to see, and the env is set INSIDE the tab (works even when
      # -w 0 attaches to an already-open Terminal window).
      $inner = "`$env:HAIKAI_TRACE='$Trace'; $runCmd"
      $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($inner))
      $wtArgs.Add('-EncodedCommand'); $wtArgs.Add($enc)
    } else {
      $wtArgs.Add('-Command'); $wtArgs.Add($runCmd)
    }
  }

  Write-Host "Launching Windows Terminal with $($selected.Count) tab(s)..." -ForegroundColor Green
  Start-Process -FilePath 'wt.exe' -ArgumentList $wtArgs
  Write-Host "Tabs launched. Close them individually to stop each service." -ForegroundColor Green
}
