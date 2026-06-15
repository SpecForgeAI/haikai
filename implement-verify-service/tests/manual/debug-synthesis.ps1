# Debug Product Standards Synthesis
# Check what metadata is being used

$headers = @{
    Authorization = "Bearer changeit"
    "Content-Type" = "application/json"
}

Write-Host "📊 Checking metamodel extraction..." -ForegroundColor Cyan

# First, let's see what the metamodel contains
$metamodel = Get-Content "C:\Projects\standards-extractor\api_workspace\CloudTech Enterprises\CloudDataPlatform\metamodel\architecture.json" | ConvertFrom-Json

Write-Host "`n=== Services in Metamodel ===" -ForegroundColor Yellow
$metamodel.metaModel.entities.services | Select-Object name, service_type, core_tech | Format-Table -AutoSize

Write-Host "`n=== Running Product Standards Generation ===" -ForegroundColor Cyan

$body = @{
    company = "CloudTech Enterprises"
    project = "CloudDataPlatform"
    sources = @(
        "https://raw.githubusercontent.com/apache/spark/master/python/pyspark/__init__.py"
    )
    recursive = $false
} | ConvertTo-Json -Depth 10

$response = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/standards/product/generate" `
    -Method POST `
    -Headers $headers `
    -Body $body `
    -TimeoutSec 180

Write-Host "`n✅ Generation complete!" -ForegroundColor Green
$response | ConvertTo-Json -Depth 5

Write-Host "`n=== Generated Tech Stack ===" -ForegroundColor Cyan
Get-Content "C:\Projects\standards-extractor\api_workspace\CloudTech Enterprises\CloudDataPlatform\haikai\product\tech-stack.md"

Write-Host "`n=== Checking Docker Logs for Metadata ===" -ForegroundColor Cyan
docker logs standards-extractor-api --since 2m 2>&1 | Select-String "Metamodel|tech_stack|precedence" | Select-Object -Last 20
