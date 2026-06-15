# Test Product Standards Generation
# Simple test with minimal source files

$headers = @{
    Authorization = "Bearer changeit"
    "Content-Type" = "application/json"
}

$body = @{
    company = "CloudTech Enterprises"
    project = "CloudDataPlatform"
    sources = @(
        # Just a few core Python files from Spark
        "https://raw.githubusercontent.com/apache/spark/master/python/pyspark/__init__.py",
        "https://raw.githubusercontent.com/apache/spark/master/python/pyspark/sql/__init__.py",
        # A simple config file
        "https://raw.githubusercontent.com/apache/kafka/trunk/config/server.properties"
    )
    recursive = $false
} | ConvertTo-Json -Depth 10

Write-Host "🚀 Testing Product Standards Generation..." -ForegroundColor Cyan
Write-Host "Company: CloudTech Enterprises" -ForegroundColor Yellow
Write-Host "Project: CloudDataPlatform" -ForegroundColor Yellow
Write-Host "Sources: 3 simple files (not full repos)" -ForegroundColor Yellow
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "http://localhost:8000/api/v1/standards/product/generate" `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -TimeoutSec 300

    Write-Host "✅ Request accepted!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10 | Write-Host
}
catch {
    Write-Host "❌ Request failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Response body:" -ForegroundColor Yellow
        Write-Host $responseBody -ForegroundColor Yellow
    }
}
