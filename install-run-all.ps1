<#
.SYNOPSIS
  Install and/or run all 9 services in dev mode, each in its own Windows Terminal tab.

.PARAMETER Action
  install | run | all   (default: all)
    install -> mvn -DskipTests clean package  (maven)  /  npm ci  (npm)
    run     -> mvn spring-boot:run            (maven)  /  npm run dev (npm)
    all     -> install then run

.PARAMETER Exclude
  Comma-separated list of service folder names to skip.

.PARAMETER Trace
  off | summary | detail   (default: off)
    Sets HAIKAI_TRACE for each spawned service tab so the instrumented services
    write to the shared trace file (~/.haikai/trace.log). See docs/trace-logging.md.

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
  [string]$Trace = 'off'
)

$ErrorActionPreference = 'Stop'

$repoRoot = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

$services = @(
  [pscustomobject]@{ Name='architecture-model-service';        Type='maven' },
  [pscustomobject]@{ Name='architecture-read-service';         Type='maven' },
  [pscustomobject]@{ Name='jira-service';                      Type='maven' },
  [pscustomobject]@{ Name='sybase-discovery-sidecar';          Type='maven' },
  [pscustomobject]@{ Name='gateway';                           Type='npm'   },
  [pscustomobject]@{ Name='discovery-service';                 Type='npm'   },
  [pscustomobject]@{ Name='api-migration-validation-service';  Type='npm'   },
  [pscustomobject]@{ Name='mcp-server';                        Type='npm'   },
  [pscustomobject]@{ Name='frontend';                          Type='npm'   }
)

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

$needMaven = ($selected | Where-Object { $_.Type -eq 'maven' }).Count -gt 0
$needNpm   = ($selected | Where-Object { $_.Type -eq 'npm'   }).Count -gt 0
if ($needMaven) { Require-Command 'java'; Require-Command 'mvn' }
if ($needNpm)   { Require-Command 'npm' }

if ($doInstall) {
  Write-Host "=== INSTALL phase ===" -ForegroundColor Cyan
  foreach ($svc in $selected) {
    $path = Join-Path $repoRoot $svc.Name
    if (-not (Test-Path $path)) { throw "Service path not found: $path" }

    Write-Host ""
    Write-Host "--- Installing $($svc.Name) [$($svc.Type)] ---" -ForegroundColor Yellow
    Push-Location $path
    try {
      if ($svc.Type -eq 'maven') {
        & mvn -DskipTests clean package
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
    $path = Join-Path $repoRoot $svc.Name
    if (-not (Test-Path $path)) { throw "Service path not found: $path" }

    $runCmd = if ($svc.Type -eq 'maven') { 'mvn spring-boot:run' } else { 'npm run dev' }
    if ($Trace -ne 'off') { $runCmd = "`$env:HAIKAI_TRACE='$Trace'; " + $runCmd }

    if (-not $first) { $wtArgs.Add(';') }
    $first = $false

    $wtArgs.Add('new-tab')
    $wtArgs.Add('--title');  $wtArgs.Add($svc.Name)
    $wtArgs.Add('-d');       $wtArgs.Add($path)
    $wtArgs.Add('powershell')
    $wtArgs.Add('-NoExit')
    $wtArgs.Add('-Command')
    $wtArgs.Add($runCmd)
  }

  Write-Host "Launching Windows Terminal with $($selected.Count) tab(s)..." -ForegroundColor Green
  Start-Process -FilePath 'wt.exe' -ArgumentList $wtArgs
  Write-Host "Tabs launched. Close them individually to stop each service." -ForegroundColor Green
}
