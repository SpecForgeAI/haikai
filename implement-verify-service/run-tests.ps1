# Quick Test Runner - Standards Extractor
# Convenience wrapper for integration test harness

param(
    [int]$Port = 8003,
    [switch]$SkipArchive
)

$scriptPath = Join-Path $PSScriptRoot "tests\integration\test-harness.ps1"

if (-not (Test-Path $scriptPath)) {
    Write-Host "ERROR: Test harness not found at $scriptPath" -ForegroundColor Red
    exit 1
}

Write-Host "Running integration test harness..." -ForegroundColor Cyan
Write-Host "Port: $Port`n" -ForegroundColor White

& $scriptPath -Port $Port -SkipArchive:$SkipArchive

# Exit with same code as test harness
exit $LASTEXITCODE
