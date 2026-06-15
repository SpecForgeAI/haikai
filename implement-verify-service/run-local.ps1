# Run script for containerized local environment (Windows PowerShell)
# This script activates the isolated environment and runs the standards-extractor

$ErrorActionPreference = "Stop"

# Get the directory where this script is located
$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

$VENV_DIR = ".venv-local"
$ENV_FILE = Join-Path $SCRIPT_DIR ".env.local"

# Check if virtual environment exists
if (-not (Test-Path $VENV_DIR)) {
    Write-Host "Error: Virtual environment not found" -ForegroundColor Red
    Write-Host "Please run .\setup-local-env.ps1 first"
    exit 1
}

# Check if .env.local exists
if (-not (Test-Path $ENV_FILE)) {
    Write-Host "Error: .env.local file not found" -ForegroundColor Red
    Write-Host "Please create .env.local with your configuration"
    exit 1
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Standards Extractor - Local Environment" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Activate virtual environment
Write-Host "Activating containerized local environment..."
& "$VENV_DIR\Scripts\Activate.ps1"

# Load .env.local and build environment hashtable for child processes
$envVars = @{}
Get-Content $ENV_FILE | ForEach-Object {
    if ($_ -match '^([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        Set-Item -Path "env:$name" -Value $value
        $envVars[$name] = $value
    }
}

# Set environment variables for isolated execution (only if not already set)
if (-not $env:HAIKAI_PROFILES_PATH) {
    $env:HAIKAI_PROFILES_PATH = "$SCRIPT_DIR\haikai-profiles"
    $envVars["HAIKAI_PROFILES_PATH"] = $env:HAIKAI_PROFILES_PATH
}
$env:PATH = "$SCRIPT_DIR\node_modules\.bin;$env:PATH"
$env:NODE_PATH = "$SCRIPT_DIR\node_modules"

Write-Host "[OK] Environment activated" -ForegroundColor Green
Write-Host ""
Write-Host "Environment details:"
$pythonVersion = python --version
Write-Host "  Python: $pythonVersion"
Write-Host "  Virtual env: $VENV_DIR"
Write-Host "  Claude profiles: $env:HAIKAI_PROFILES_PATH"
Write-Host "  Working directory: $SCRIPT_DIR"
Write-Host ""

# Check what the user wants to run
$command = $args[0]

if ($command -eq "example") {
    Write-Host "Running example script..."
    Write-Host ""
    $remainingArgs = $args[1..($args.Length-1)]
    python -m src.entrypoints.run $remainingArgs
}
elseif ($command -eq "test") {
    Write-Host "Running tests..."
    Write-Host ""
    python -m pytest tests/
}
elseif ($command -eq "shell") {
    Write-Host "Starting interactive shell..."
    Write-Host "Type exit to leave the shell"
    Write-Host ""
    powershell
}
elseif ($command -eq "worker") {
    # Start only the background worker
    Write-Host "Starting background worker..."
    Write-Host "Worker will process async jobs from the queue"
    Write-Host "Press CTRL+C to stop"
    Write-Host ""
    python -m src.entrypoints.debug_worker
}
else {
    # Default: start both API server and worker
    # Check for port parameter (e.g., run-local.ps1 8004)
    $port = if ($command -match '^\d+$') { $command } else { "8000" }
    
    # Ensure JOBS_DB_PATH is set (shared between API and worker)
    if (-not $env:JOBS_DB_PATH) {
        $workspaceDir = if ($env:API_WORKSPACE_DIR) { $env:API_WORKSPACE_DIR } else { "$SCRIPT_DIR\api_workspace" }
        $env:JOBS_DB_PATH = "$workspaceDir\jobs.db"
    }
    
    Write-Host "Starting FastAPI server and background worker..."
    Write-Host "API will be available at http://localhost:$port"
    Write-Host "API docs at http://localhost:$port/docs"
    Write-Host "Jobs DB: $env:JOBS_DB_PATH"
    Write-Host ""
    Write-Host "Starting background worker in separate thread..."
    Write-Host ""
    
    # Start the worker in a separate PowerShell window
    # This ensures proper environment inheritance and visibility
    $workerCommand = @"
cd '$SCRIPT_DIR'
& '$SCRIPT_DIR\$VENV_DIR\Scripts\Activate.ps1'
`$env:JOBS_DB_PATH = '$($env:JOBS_DB_PATH)'
`$env:HAIKAI_PROFILES_PATH = '$SCRIPT_DIR\haikai-profiles'
python -m src.entrypoints.debug_worker
"@
    
    $script:workerProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $workerCommand -PassThru
    
    Write-Host "[OK] Background worker started (PID: $($script:workerProcess.Id))" -ForegroundColor Green
    Write-Host "     Worker is running in a separate window"
    Write-Host ""
    
    # Give the worker a moment to start
    Start-Sleep -Seconds 2
    
    # Register cleanup on script exit
    try {
        # Start the API server (this blocks until CTRL+C)
        uvicorn src.api:app --host 0.0.0.0 --port $port --reload
    }
    finally {
        # Cleanup when API server stops
        Write-Host ""
        Write-Host "Stopping background worker..." -ForegroundColor Yellow
        if ($script:workerProcess -and -not $script:workerProcess.HasExited) {
            Stop-Process -Id $script:workerProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Write-Host "[OK] Worker stopped" -ForegroundColor Green
    }
}
