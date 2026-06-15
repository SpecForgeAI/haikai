# Standards Extractor - Integration Test Harness v2
# ================================================
# Run all critical API endpoints before committing to main
# Updated to handle shape-spec interactive Q&A flow

param(
    [int]$Port = 8003,
    [switch]$SkipArchive,
    [string]$OutputDir = "test-results",
    [switch]$LocalMode,
    [string]$LocalWorkspace = "C:\Workspaces\SSD\sdd-arch-tool-generated",
    [string]$Company = "ABM",
    [string]$Project = "abm-1"
)

$ErrorActionPreference = "Continue"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$fullOutputDir = Join-Path $PSScriptRoot $OutputDir
$sessionDir = Join-Path $fullOutputDir $timestamp

New-Item -ItemType Directory -Force -Path $sessionDir | Out-Null
New-Item -ItemType Directory -Force -Path "$sessionDir\generated-files" | Out-Null

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Standards Extractor - Test Harness" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Port: $Port" -ForegroundColor White
Write-Host "Mode: $(if ($LocalMode) { 'Local App' } else { 'Docker Container' })" -ForegroundColor White
if ($LocalMode) {
    Write-Host "Workspace: $LocalWorkspace" -ForegroundColor White
}
Write-Host "Timestamp: $timestamp`n" -ForegroundColor White

$headers = @{
    "Authorization" = "Bearer changeit"
    "Content-Type" = "application/json"
}

# Helper functions for file operations (Docker vs Local)
function Test-FileExists {
    param([string]$Path)
    if ($LocalMode) {
        Test-Path $Path
    } else {
        $exitCode = docker exec $containerName test -f $Path 2>$null
        return $LASTEXITCODE -eq 0
    }
}

function Get-FileContent {
    param([string]$Path, [string]$OutFile)
    if ($LocalMode) {
        Copy-Item $Path $OutFile -ErrorAction SilentlyContinue
    } else {
        docker exec $containerName cat $Path | Out-File $OutFile -Encoding UTF8
    }
}

function Find-Files {
    param([string]$Path, [string]$Pattern)
    if ($LocalMode) {
        $found = Get-ChildItem -Path $Path -Filter $Pattern -Recurse -File -ErrorAction SilentlyContinue
        return $found | ForEach-Object { $_.FullName }
    } else {
        $result = docker exec $containerName find $Path -name $Pattern -type f 2>$null
        return $result
    }
}

$results = @()
$allPassed = $true

# Test 1: Health Check
Write-Host "[1/5] Health Check..." -ForegroundColor Yellow -NoNewline
$test1Start = Get-Date
try {
    $response = Invoke-RestMethod -Uri "http://localhost:$Port/health" -Method GET -Headers $headers
    $test1End = Get-Date
    $test1Duration = ($test1End - $test1Start).TotalSeconds
    $response | ConvertTo-Json | Out-File "$sessionDir\test1-health-response.json" -Encoding UTF8
    Write-Host " ✅ PASS ($([math]::Round($test1Duration, 2))s)" -ForegroundColor Green
    $results += @{Test="1"; Endpoint="/health"; Result="PASS"; Duration="$([math]::Round($test1Duration, 2))s"}
} catch {
    Write-Host " ❌ FAIL" -ForegroundColor Red
    $_.Exception.Message | Out-File "$sessionDir\test1-health-error.txt" -Encoding UTF8
    $results += @{Test="1"; Endpoint="/health"; Result="FAIL"; Duration="-"}
    $allPassed = $false
}

# Test 2: Product Standards
Write-Host "[2/5] Product Standards..." -ForegroundColor Yellow -NoNewline
$test2Start = Get-Date
$body2 = @{
    company = $Company
    project = $Project
    repo_url = "https://github.com/SpecForgeAI/standards-extractor"
    branch = "main"
} | ConvertTo-Json

$containerName = "standards-extractor-api-$Port"
if ($Port -eq 8000) { $containerName = "standards-extractor-api" }
if ($Port -eq 8001) { $containerName = "standards-extractor-api-test" }

try {
    $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/v1/standards/product/generate" -Method POST -Headers $headers -Body $body2 -TimeoutSec 120
    $test2End = Get-Date
    $test2Duration = ($test2End - $test2Start).TotalSeconds
    $response | ConvertTo-Json | Out-File "$sessionDir\test2-product-response.json" -Encoding UTF8
    
    # Verify tech-stack.md was created
    if ($LocalMode) {
        $projectPath = Join-Path $LocalWorkspace "$Company\$Project"
        $techStackPath = Join-Path $projectPath "haikai\product\tech-stack.md"
    } else {
        $projectPath = "/app/api_workspace/$($Company.ToLower())/$Project"
        $techStackPath = "$projectPath/haikai/product/tech-stack.md"
    }
    
    if (-not (Test-FileExists $techStackPath)) {
        throw "Expected file not created: tech-stack.md"
    }
    
    # Copy the file for verification
    Get-FileContent $techStackPath "$sessionDir\generated-files\tech-stack.md"
    $fileSize = (Get-Item "$sessionDir\generated-files\tech-stack.md").Length
    
    Write-Host " ✅ PASS ($([math]::Round($test2Duration, 2))s, tech-stack.md $([math]::Round($fileSize/1KB, 2))KB)" -ForegroundColor Green
    $results += @{Test="2"; Endpoint="standards/product/generate"; Result="PASS"; Duration="$([math]::Round($test2Duration, 2))s"; Files="tech-stack.md"}
} catch {
    Write-Host " ❌ FAIL" -ForegroundColor Red
    $_.Exception.Message | Out-File "$sessionDir\test2-product-error.txt" -Encoding UTF8
    $results += @{Test="2"; Endpoint="standards/product/generate"; Result="FAIL"; Duration="-"; Files="MISSING"}
    $allPassed = $false
}

# Test 3: Global Standards
Write-Host "[3/5] Global Standards..." -ForegroundColor Yellow -NoNewline
$test3Start = Get-Date
$body3 = @{
    company = $Company
    technical_documents = @{
        tech_stack = @(
            "**Frontend:** React 18 with TypeScript, Redux Toolkit, Material-UI, React Router v6"
            "**Backend:** Node.js 20 LTS, Express.js, TypeScript, PostgreSQL 15, Redis 7, Bull queues"
            "**Auth:** JWT tokens, OAuth 2.0 (Google, GitHub), bcrypt password hashing"
            "**API:** RESTful, OpenAPI 3.0, JSON responses, Joi validation"
            "**Database:** PostgreSQL 15 with Prisma ORM, connection pooling, read replicas"
            "**DevOps:** Docker, GitHub Actions CI/CD, AWS ECS/Fargate, Terraform IaC"
            "**Testing:** Jest, Supertest, Cypress, 80% coverage requirement"
            "**Monitoring:** APM, Sentry error tracking, Prometheus metrics, Grafana dashboards"
        )
        coding_style = @(
            "TypeScript strict mode enabled across all projects"
            "ESLint + Prettier for code formatting and linting"
            "Functional components with React Hooks (no class components)"
            "Async/await preferred over Promise chains"
            "Modular architecture with clear separation of concerns"
        )
        conventions = @(
            "RESTful API naming: plural nouns, kebab-case URLs"
            "Database naming: snake_case for tables and columns"
            "Code naming: camelCase for variables/functions, PascalCase for classes/components"
            "Git: feature branches, PR required, squash merge to main"
            "Commit messages: Conventional Commits format"
        )
        error_handling = @(
            "Standard HTTP status codes for API responses"
            "Global error handler middleware in Express"
            "Try-catch blocks for async operations"
            "Detailed error logging to CloudWatch"
            "User-friendly error messages in production"
        )
        validation = @(
            "Joi schemas for API request validation"
            "Prisma schema validation for database operations"
            "TypeScript compile-time type checking"
            "Unit tests for business logic validation"
            "Integration tests for API endpoint validation"
        )
    }
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/v1/standards/global/generate" -Method POST -Headers $headers -Body $body3 -TimeoutSec 120
    $test3End = Get-Date
    $test3Duration = ($test3End - $test3Start).TotalSeconds
    $response | ConvertTo-Json | Out-File "$sessionDir\test3-global-response.json" -Encoding UTF8
    
    # Verify global standards files were created
    if ($LocalMode) {
        $globalStandardsPath = Join-Path $LocalWorkspace "$Company\haikai\standards\global"
    } else {
        $globalStandardsPath = "/app/api_workspace/$($Company.ToLower())/haikai/standards/global"
    }
    
    $filesFound = Find-Files $globalStandardsPath "*.md"
    if ([string]::IsNullOrEmpty($filesFound) -or ($filesFound -is [array] -and $filesFound.Count -eq 0)) {
        throw "No global standards files created in $globalStandardsPath"
    }
    
    # Copy generated files
    $fileCount = 0
    if ($filesFound -is [string]) { $filesFound = @($filesFound) }
    $filesFound | Where-Object { $_ -ne "" } | ForEach-Object {
        $fileName = Split-Path $_ -Leaf
        Get-FileContent $_ "$sessionDir\generated-files\global-$fileName"
        $fileCount++
    }
    
    Write-Host " ✅ PASS ($([math]::Round($test3Duration, 2))s, $fileCount file(s))" -ForegroundColor Green
    $results += @{Test="3"; Endpoint="standards/global/generate"; Result="PASS"; Duration="$([math]::Round($test3Duration, 2))s"; Files="$fileCount file(s)"}
} catch {
    Write-Host " ❌ FAIL" -ForegroundColor Red
    $_.Exception.Message | Out-File "$sessionDir\test3-global-error.txt" -Encoding UTF8
    $results += @{Test="3"; Endpoint="standards/global/generate"; Result="FAIL"; Duration="-"; Files="MISSING"}
    $allPassed = $false
}

# Test 4: Shape-Spec Stream (Interactive with Q&A)
Write-Host "[4/5] Shape-Spec Stream (2-step)..." -ForegroundColor Yellow -NoNewline
$test4Start = Get-Date

try {
    # Step 1: Initial request (will ask questions)
    $body4a = @{
        company = $Company
        project = $Project
        message = "Create a comprehensive user authentication system spec including login, logout, password reset, and session management"
    } | ConvertTo-Json
    
    Invoke-WebRequest -Uri "http://localhost:$Port/api/v1/shape-spec/stream" -Method POST -Headers $headers -Body $body4a -OutFile "$sessionDir\test4a-shape-spec-questions.txt" -TimeoutSec 120 2>$null
    
    # Step 2: Answer the questions
    $body4b = @{
        company = $Company
        project = $Project
        message = @"
Here are the answers to your questions:

**Specific Features:**
1. Email/password authentication
2. JWT token-based sessions
3. Password reset via email link
4. Account lockout after 5 failed attempts
5. Optional 2FA with TOTP

**User Flows:**
1. Registration: Email verification required
2. Login: Email + password, returns JWT
3. Password Reset: Email link valid for 1 hour
4. Logout: Invalidate JWT token

**Security Requirements:**
- Bcrypt password hashing (cost factor 12)
- HTTPS only
- CSRF protection
- Rate limiting on auth endpoints
- Session timeout after 30 minutes inactivity

**Dependencies:**
- PostgreSQL for user storage
- Redis for session management
- Email service (SendGrid or similar)

**Error Handling:**
- User-friendly error messages
- Detailed server logs for debugging
- Account lockout notifications

Please create the spec based on these requirements.
"@
    } | ConvertTo-Json
    
    Invoke-WebRequest -Uri "http://localhost:$Port/api/v1/shape-spec/stream" -Method POST -Headers $headers -Body $body4b -OutFile "$sessionDir\test4b-shape-spec-spec.txt" -TimeoutSec 120 2>$null
    
    $test4End = Get-Date
    $test4Duration = ($test4End - $test4Start).TotalSeconds
    $lineCountA = (Get-Content "$sessionDir\test4a-shape-spec-questions.txt").Count
    $lineCountB = (Get-Content "$sessionDir\test4b-shape-spec-spec.txt").Count
    
    # Verify spec files were created (should be requirements.md in specs folder)
    if ($LocalMode) {
        $specsPath = Join-Path $LocalWorkspace "$Company\$Project\haikai\specs"
    } else {
        $specsPath = "/app/api_workspace/$($Company.ToLower())/$Project/haikai/specs"
    }
    
    $specFiles = Find-Files $specsPath "*.md"
    if ([string]::IsNullOrEmpty($specFiles) -or ($specFiles -is [array] -and $specFiles.Count -eq 0)) {
        throw "No spec files created in $specsPath"
    }
    
    # Copy spec files
    $specCount = 0
    if ($specFiles -is [string]) { $specFiles = @($specFiles) }
    $specFiles | Where-Object { $_ -ne "" } | ForEach-Object {
        $fileName = Split-Path $_ -Leaf
        Get-FileContent $_ "$sessionDir\generated-files\spec-$fileName"
        $specCount++
    }
    
    Write-Host " ✅ PASS ($([math]::Round($test4Duration, 2))s, $specCount spec(s))" -ForegroundColor Green
    $results += @{Test="4"; Endpoint="shape-spec/stream"; Result="PASS"; Duration="$([math]::Round($test4Duration, 2))s"; Files="$specCount spec(s)"}
} catch {
    Write-Host " ❌ FAIL" -ForegroundColor Red
    $_.Exception.Message | Out-File "$sessionDir\test4-shape-spec-error.txt" -Encoding UTF8
    $results += @{Test="4"; Endpoint="shape-spec/stream"; Result="FAIL"; Duration="-"; Files="MISSING"}
    $allPassed = $false
}

# Test 5: Plan-Product Stream
Write-Host "[5/5] Plan-Product Stream..." -ForegroundColor Yellow -NoNewline
$test5Start = Get-Date
$body5 = @{
    company = $Company
    project = $Project
    message = "Create a comprehensive product implementation plan for the user authentication system, including database schema, API endpoints, frontend components, and testing strategy"
} | ConvertTo-Json

try {
    Invoke-WebRequest -Uri "http://localhost:$Port/api/v1/plan-product/stream" -Method POST -Headers $headers -Body $body5 -OutFile "$sessionDir\test5-plan-product-stream.txt" -TimeoutSec 120 2>$null
    $test5End = Get-Date
    $test5Duration = ($test5End - $test5Start).TotalSeconds
    $lineCount = (Get-Content "$sessionDir\test5-plan-product-stream.txt").Count
    
    # Verify implementation plan files were created
    if ($LocalMode) {
        $implPath = Join-Path $LocalWorkspace "$Company\$Project\haikai\implementation"
    } else {
        $implPath = "/app/api_workspace/$($Company.ToLower())/$Project/haikai/implementation"
    }
    
    $planFiles = Find-Files $implPath "*.md"
    if ([string]::IsNullOrEmpty($planFiles) -or ($planFiles -is [array] -and $planFiles.Count -eq 0)) {
        throw "No implementation plan files created in $implPath"
    }
    
    # Copy plan files
    $planCount = 0
    if ($planFiles -is [string]) { $planFiles = @($planFiles) }
    $planFiles | Where-Object { $_ -ne "" } | ForEach-Object {
        $fileName = Split-Path $_ -Leaf
        Get-FileContent $_ "$sessionDir\generated-files\plan-$fileName"
        $planCount++
    }
    
    Write-Host " ✅ PASS ($([math]::Round($test5Duration, 2))s, $planCount plan(s))" -ForegroundColor Green
    $results += @{Test="5"; Endpoint="plan-product/stream"; Result="PASS"; Duration="$([math]::Round($test5Duration, 2))s"; Files="$planCount plan(s)"}
} catch {
    Write-Host " ❌ FAIL" -ForegroundColor Red
    $_.Exception.Message | Out-File "$sessionDir\test5-plan-product-error.txt" -Encoding UTF8
    $results += @{Test="5"; Endpoint="plan-product/stream"; Result="FAIL"; Duration="-"; Files="MISSING"}
    $allPassed = $false
}

# List all generated files for summary
Write-Host "`nGenerating file manifest..." -ForegroundColor Yellow
if ($LocalMode) {
    $projectPath = Join-Path $LocalWorkspace "$Company\$Project"
    if (Test-Path $projectPath) {
        Get-ChildItem -Path $projectPath -Filter "*.md" -Recurse -File | ForEach-Object { $_.FullName } | Out-File "$sessionDir\generated-files-list.txt" -Encoding UTF8
    }
} else {
    $projectPath = "/app/api_workspace/$($Company.ToLower())/$Project"
    docker exec $containerName find $projectPath -name "*.md" -type f 2>$null | Out-File "$sessionDir\generated-files-list.txt" -Encoding UTF8
}
$manifestCount = (Get-Content "$sessionDir\generated-files-list.txt" -ErrorAction SilentlyContinue | Where-Object { $_ -ne "" }).Count
Write-Host "  Found $manifestCount total file(s)" -ForegroundColor Green

# Capture logs
if (-not $LocalMode) {
    Write-Host "Capturing container logs..." -ForegroundColor Yellow
    docker logs $containerName --tail 200 2>&1 | Out-File "$sessionDir\container-logs.txt" -Encoding UTF8
} else {
    Write-Host "Skipping container logs (local mode)..." -ForegroundColor Yellow
    "Local mode - no container logs available" | Out-File "$sessionDir\container-logs.txt" -Encoding UTF8
}

# Create summary
Write-Host "Creating summary..." -ForegroundColor Yellow
$summaryLines = @()
$summaryLines += "# Test Harness Results - Port $Port"
$summaryLines += ""
$summaryLines += "**Date:** $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') GMT"
$summaryLines += "**Company:** $Company"
$summaryLines += "**Project:** $Project"
if ($LocalMode) {
    $summaryLines += "**Mode:** Local App"
    $summaryLines += "**Workspace:** $LocalWorkspace"
} else {
    $summaryLines += "**Mode:** Docker Container"
    $summaryLines += "**Container:** $containerName"
}
$summaryLines += "**Port:** $Port"
$summaryLines += "**Commit:** $(git rev-parse --short HEAD 2>$null)"
$summaryLines += ""
$summaryLines += "## Test Results"
$summaryLines += ""
$summaryLines += "| # | Endpoint | Result | Duration | Files Created |"
$summaryLines += "|---|----------|--------|----------|---------------|"

foreach ($r in $results) {
    $emoji = if ($r.Result -eq "PASS") { "✅" } else { "❌" }
    $files = if ($r.Files) { $r.Files } else { "-" }
    $summaryLines += "| $($r.Test) | ``$($r.Endpoint)`` | $emoji $($r.Result) | $($r.Duration) | $files |"
}

$passCount = ($results | Where-Object { $_.Result -eq "PASS" }).Count
$totalCount = $results.Count
$successRate = [math]::Round(($passCount/$totalCount)*100, 0)

$summaryLines += ""
$summaryLines += "**Success Rate:** $passCount/$totalCount ($successRate%)"
$summaryLines += ""

if ($allPassed) {
    $summaryLines += "## ✅ ALL TESTS PASSED"
    $summaryLines += ""
    $summaryLines += "**Shape-Spec Note:** Test includes 2-step interactive flow (questions then answers)"
    $summaryLines += ""
    $summaryLines += "Safe to commit to main branch."
} else {
    $summaryLines += "## ❌ TESTS FAILED"
    $summaryLines += ""
    $summaryLines += "**DO NOT COMMIT** - Fix failing tests before merging to main."
}

$summaryLines += ""
$summaryLines += "## Files"
$summaryLines += "- test1-health-response.json"
$summaryLines += "- test2-product-response.json"
$summaryLines += "- test3-global-response.json"
$summaryLines += "- test4a-shape-spec-questions.txt (initial request with questions)"
$summaryLines += "- test4b-shape-spec-spec.txt (spec generation after answers)"
$summaryLines += "- test5-plan-product-stream.txt"
$summaryLines += "- generated-files/ (all generated artifacts)"
$summaryLines += "- container-logs.txt"

$summaryLines | Out-File "$sessionDir\test-summary.md" -Encoding UTF8

# Create archive if not skipped
if (-not $SkipArchive) {
    Write-Host "Creating archive..." -ForegroundColor Yellow
    $archiveName = "test-harness-results-$timestamp.zip"
    $archivePath = Join-Path $fullOutputDir $archiveName
    Compress-Archive -Path "$sessionDir\*" -DestinationPath $archivePath -Force
    $zipFile = Get-Item $archivePath
    $zipSizeKB = [math]::Round($zipFile.Length / 1KB, 2)
    Write-Host "  Archive created: $archiveName ($zipSizeKB KB)" -ForegroundColor Green
}

# Final summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Test Harness Complete" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nResults:" -ForegroundColor Yellow
foreach ($r in $results) {
    $color = if ($r.Result -eq "PASS") { "Green" } else { "Red" }
    $emoji = if ($r.Result -eq "PASS") { "✅" } else { "❌" }
    $files = if ($r.Files) { " [$($r.Files)]" } else { "" }
    Write-Host "  $emoji $($r.Endpoint): $($r.Result) ($($r.Duration))$files" -ForegroundColor $color
}

Write-Host "`nSuccess Rate: $passCount/$totalCount ($successRate%)" -ForegroundColor $(if ($allPassed) { "Green" } else { "Red" })
Write-Host "Output: $sessionDir`n" -ForegroundColor White

if ($allPassed) {
    Write-Host "✅ ALL TESTS PASSED - Safe to commit`n" -ForegroundColor Green
    Write-Host "Note: Shape-spec test includes interactive QA flow (2 steps)" -ForegroundColor Cyan
    exit 0
} else {
    Write-Host "❌ TESTS FAILED - DO NOT COMMIT`n" -ForegroundColor Red
    exit 1
}
