param(
  [string]$ArchitectureModelPath = ".\architecture-model-service",
  [string]$GatewayPath = ".\gateway",
  [string]$FrontendPath = ".\frontend",
  [int]$ArchitectureModelPort = 8080,
  [int]$GatewayPort = 3001,
  [int]$FrontendPort = 5173
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command '$name' not found on PATH."
  }
}

function Start-CmdLoggedProcess([string]$Name, [string]$WorkingDir, [string]$CmdLine, [string]$LogFile) {
  if (-not (Test-Path $WorkingDir)) { throw "Working directory not found: $WorkingDir" }

  $logDir = Split-Path $LogFile -Parent
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
  New-Item -ItemType File -Path $LogFile -Force | Out-Null

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.WorkingDirectory = (Resolve-Path $WorkingDir).Path

  # Redirect BOTH stdout and stderr to the same log file using cmd.exe redirection
  $psi.Arguments = "/c $CmdLine 1>> `"$LogFile`" 2>>&1"

  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()

  Write-Host "Started $Name (PID=$($p.Id))  Logs: $LogFile"
  return @{ Name=$Name; Process=$p; LogFile=$LogFile }
}

function Tail-Log([string]$Path, [int]$Lines = 40) {
  if (Test-Path $Path) {
    Write-Host "---- Last $Lines lines of $Path ----" -ForegroundColor Yellow
    Get-Content $Path -Tail $Lines -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    Write-Host "-----------------------------------" -ForegroundColor Yellow
  } else {
    Write-Host "Log file not found: $Path" -ForegroundColor Yellow
  }
}

# Prereqs
Require-Command "java"
Require-Command "mvn"
Require-Command "npm"

$root = (Get-Location).Path
$logsRoot = Join-Path $root "run-logs"
New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
$ts = Get-Date -Format "yyyyMMdd-HHmmss"

$archLog = Join-Path $logsRoot "architecture-model-service-$ts.log"
$gwLog   = Join-Path $logsRoot "gateway-$ts.log"
$feLog   = Join-Path $logsRoot "frontend-$ts.log"

$started = @()

try {
  Write-Host "`n== Installing/building Architecture Model Service ==" -ForegroundColor Cyan
  Push-Location $ArchitectureModelPath
  mvn -DskipTests clean package
  Pop-Location

  Write-Host "`n== Installing Gateway deps ==" -ForegroundColor Cyan
  Push-Location $GatewayPath
  npm ci
  Pop-Location

  Write-Host "`n== Installing Frontend deps ==" -ForegroundColor Cyan
  Push-Location $FrontendPath
  npm ci
  Pop-Location

  Write-Host "`n== Starting services ==" -ForegroundColor Cyan

  # Spring Boot
  $started += Start-CmdLoggedProcess `
    -Name "architecture-model-service" `
    -WorkingDir $ArchitectureModelPath `
    -CmdLine "mvn -q spring-boot:run -Dspring-boot.run.arguments=--server.port=$ArchitectureModelPort" `
    -LogFile $archLog

  # Gateway (set PORT for cmd.exe invocation)
  $started += Start-CmdLoggedProcess `
    -Name "gateway" `
    -WorkingDir $GatewayPath `
    -CmdLine "set PORT=$GatewayPort && npm run dev" `
    -LogFile $gwLog

  # Frontend (Vite)
  $started += Start-CmdLoggedProcess `
    -Name "frontend" `
    -WorkingDir $FrontendPath `
    -CmdLine "npm run dev -- --port $FrontendPort" `
    -LogFile $feLog

  Start-Sleep -Seconds 2

  # Early-exit detection
  foreach ($s in $started) {
    if ($s.Process.HasExited) {
      Write-Host "`nERROR: $($s.Name) exited immediately (ExitCode=$($s.Process.ExitCode))." -ForegroundColor Red
      Tail-Log $s.LogFile 80
      throw "$($s.Name) failed to start. See log: $($s.LogFile)"
    }
  }

  Write-Host "`nAll processes started. Press Ctrl+C to stop them." -ForegroundColor Green

  while ($true) {
    foreach ($s in $started) {
      if ($s.Process.HasExited) {
        Write-Host "`nERROR: $($s.Name) exited (ExitCode=$($s.Process.ExitCode))." -ForegroundColor Red
        Tail-Log $s.LogFile 80
        throw "$($s.Name) exited unexpectedly."
      }
    }
    Start-Sleep -Seconds 5
  }
}
finally {
  Write-Host "`nStopping services..." -ForegroundColor Yellow
  foreach ($s in $started) {
    try {
      if ($s.Process -and (-not $s.Process.HasExited)) {
        $s.Process.Kill($true)
      }
    } catch { }
  }
  Write-Host "Stopped. Logs are in: $logsRoot" -ForegroundColor Yellow
}