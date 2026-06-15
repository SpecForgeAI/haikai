# Test Harness Setup Guide

This guide helps you set up automated testing for the Standards Extractor API.

## Quick Setup (5 minutes)

### 1. Verify Files Are Present
```powershell
ls tests/integration/
```

You should see:
- `test-harness.ps1` - Main test script
- `README.md` - Documentation
- `pre-commit.sample` - Git hook template
- `SETUP.md` - This file

### 2. Run Your First Test
```powershell
# From project root
.\run-tests.ps1
```

Expected output:
```
[1/5] Health Check... ✅ PASS (0.04s)
[2/5] Product Standards... ✅ PASS (40s)
[3/5] Global Standards... ✅ PASS (0.08s)
[4/5] Shape-Spec Stream... ✅ PASS (25s)
[5/5] Plan-Product Stream... ✅ PASS (15s)

✅ ALL TESTS PASSED - Safe to commit
```

### 3. Review Test Output
```powershell
ls tests/integration/test-results/
```

Each test run creates a timestamped folder with:
- Test results
- Generated files
- Container logs
- ZIP archive (optional)

## Optional: Git Pre-Commit Hook

Automatically run tests before every commit.

### Install Hook
```bash
# Copy the sample hook
cp tests/integration/pre-commit.sample .git/hooks/pre-commit

# Make executable (Linux/Mac)
chmod +x .git/hooks/pre-commit
```

### Test Hook
```bash
# Make a test change
echo "test" >> README.md

# Try to commit (tests will run first)
git add README.md
git commit -m "Test commit"
```

If tests fail, commit will be blocked. To bypass (emergency only):
```bash
git commit --no-verify -m "Emergency commit"
```

### Uninstall Hook
```bash
rm .git/hooks/pre-commit
```

## Container Setup

### Ensure Container is Running
```powershell
docker ps | Select-String "8003"
```

If not running:
```powershell
docker-compose -f docker-compose.port8003.yml up -d --build
```

### Verify Container Health
```powershell
curl http://localhost:8003/health
```

Expected response:
```json
{"status":"healthy","service":"standards-extractor"}
```

## Configuration

### Port Configuration
Test different containers by changing the port:

```powershell
# Test main container (port 8000)
.\run-tests.ps1 -Port 8000

# Test dev container (port 8003, default)
.\run-tests.ps1 -Port 8003
```

### Skip Archive Creation
For faster testing during development:
```powershell
.\run-tests.ps1 -SkipArchive
```

### Custom Output Location
Edit `test-harness.ps1`:
```powershell
param(
    [int]$Port = 8003,
    [switch]$SkipArchive,
    [string]$OutputDir = "custom-test-results"  # Change this
)
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Integration Tests

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Start Container
        run: |
          docker-compose -f docker-compose.yml up -d
          Start-Sleep -Seconds 30
      
      - name: Run Integration Tests
        run: .\run-tests.ps1 -Port 8000
      
      - name: Upload Test Results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: tests/integration/test-results/
```

### GitLab CI Example
```yaml
test:
  stage: test
  script:
    - docker-compose up -d
    - sleep 30
    - pwsh run-tests.ps1 -Port 8000
  artifacts:
    when: always
    paths:
      - tests/integration/test-results/
```

## Troubleshooting

### "Container not found" Error
```powershell
# Check running containers
docker ps -a | Select-String "standards"

# Start correct container for your port
docker-compose -f docker-compose.port8003.yml up -d
```

### "Connection refused" Error
```powershell
# Wait for container to be healthy
docker ps --format "table {{.Names}}\t{{.Status}}"

# Check container logs
docker logs standards-extractor-api-8003 --tail 50
```

### "Authentication failed" Error
Verify `.env.docker` contains:
```env
STANDARDS_API_KEY=changeit
ANTHROPIC_API_KEY=sk-ant-oat01-...
```

### Tests Timeout
Increase timeout in `test-harness.ps1`:
```powershell
Invoke-RestMethod ... -TimeoutSec 240  # Increase from 120
```

## Maintenance

### Clean Old Test Results
```powershell
# Remove results older than 7 days
$cutoff = (Get-Date).AddDays(-7)
Get-ChildItem tests/integration/test-results -Directory |
    Where-Object { $_.CreationTime -lt $cutoff } |
    Remove-Item -Recurse -Force
```

### Update Baseline Performance
Edit expected durations in `README.md` if performance characteristics change.

### Add New Tests
Edit `test-harness.ps1` and add new test blocks:
```powershell
# Test 6: New Endpoint
Write-Host "[6/6] New Endpoint..." -ForegroundColor Yellow -NoNewline
try {
    $response = Invoke-RestMethod -Uri "http://localhost:$Port/api/v1/new-endpoint" ...
    # ... test logic
} catch {
    # ... error handling
}
```

## Support

For issues or questions:
1. Review test output in `test-results/` directory
2. Check container logs: `docker logs <container-name>`
3. Consult main README.md for API documentation
4. Review `tests/integration/README.md` for detailed documentation

---

**Setup Complete!** 🎉

Run `.\run-tests.ps1` before every commit to ensure code quality.
