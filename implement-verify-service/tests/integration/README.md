# Integration Test Harness

Comprehensive test suite for validating all critical API endpoints before committing to main.

## Quick Start

### Run All Tests (Default Port 8003)
```powershell
.\test-harness.ps1
```

### Run on Different Port
```powershell
.\test-harness.ps1 -Port 8000
```

### Skip Archive Creation
```powershell
.\test-harness.ps1 -SkipArchive
```

## What It Tests

| # | Endpoint | Purpose | Validates | Critical? |
|---|----------|---------|-----------|-----------|
| 1 | `/health` | API health check | HTTP 200 | ✅ Yes |
| 2 | `standards/product/generate` | Product standards from repo | `tech-stack.md` created | ✅ Yes |
| 3 | `standards/global/generate` | Global standards generation | `global/*.md` files created | ✅ Yes |
| 4 | `shape-spec/stream` | SSE streaming with OAuth | `specs/*.md` files created | ✅ Yes |
| 5 | `plan-product/stream` | SSE streaming with OAuth | `implementation/*.md` files created | ✅ Yes |

## Test Coverage

### Authentication
- ✅ API Key authentication (`Bearer changeit`)
- ✅ OAuth token handling (`OAuthChatExecutor`)
- ✅ Proper auth headers on all endpoints

### Core Functionality
- ✅ RESTful endpoints (health, standards generation)
- ✅ SSE streaming endpoints (shape-spec, plan-product)
- ✅ **File generation verification** (tests fail if expected files are missing)
- ✅ File content captured in test results
- ✅ Container health and logs

### File Validation
Each endpoint that generates files is validated to ensure files are actually created:
- **Test 2 (Product Standards)**: Verifies `tech-stack.md` exists in `haikai/product/`
- **Test 3 (Global Standards)**: Verifies at least one `.md` file in `haikai/standards/global/`
- **Test 4 (Shape-Spec)**: Verifies at least one `.md` file in `haikai/specs/`
- **Test 5 (Plan-Product)**: Verifies at least one `.md` file in `haikai/implementation/`

**Tests fail if expected files are missing**, even if the HTTP request returns 200 OK. This ensures the API is actually generating content, not just returning success responses.

### Performance Baselines
| Test | Expected Duration |
|------|-------------------|
| Health Check | < 1s |
| Product Standards | 20-45s |
| Global Standards | < 1s |
| Shape-Spec Stream | 15-30s |
| Plan-Product Stream | 10-30s |

## Exit Codes

- **0**: All tests passed ✅ (safe to commit)
- **1**: One or more tests failed ❌ (DO NOT commit)

## Output

### Directory Structure
```
tests/integration/test-results/
└── YYYYMMDD-HHMMSS/
    ├── test-summary.md                           # Results summary with file counts
    ├── test1-health-response.json                # Health check
    ├── test2-product-response.json               # Product standards
    ├── test3-global-response.json                # Global standards
    ├── test4a-shape-spec-questions.txt           # Shape-spec initial questions
    ├── test4b-shape-spec-spec.txt                # Shape-spec final output
    ├── test5-plan-product-stream.txt             # SSE output (plan-product)
    ├── generated-files/
    │   ├── tech-stack.md                         # Test 2: Product standards
    │   ├── global-*.md                           # Test 3: Global standards
    │   ├── spec-*.md                             # Test 4: Shape-spec files
    │   └── plan-*.md                             # Test 5: Implementation plans
    ├── generated-files-list.txt                  # Manifest of all files
    └── container-logs.txt                        # Container debug logs
```

### Archive (Optional)
ZIP archive created at: `test-results/test-harness-results-YYYYMMDD-HHMMSS.zip`

## Pre-Commit Workflow

### Recommended Process
1. Make code changes on feature branch
2. Build and start container:
   ```powershell
   docker-compose -f docker-compose.port8003.yml up -d --build
   ```
3. Run test harness:
   ```powershell
   .\tests\integration\test-harness.ps1 -Port 8003
   ```
4. Check exit code and review results
5. If all tests pass (exit 0), proceed with commit:
   ```bash
   git add .
   git commit -m "Your commit message"
   git push
   ```
6. If any tests fail (exit 1), fix issues before committing

### Integration with CI/CD
```yaml
# Example GitHub Actions workflow
- name: Run Integration Tests
  run: |
    docker-compose -f docker-compose.yml up -d
    sleep 30  # Wait for container health
    pwsh tests/integration/test-harness.ps1 -Port 8000
```

## Troubleshooting

### Container Not Running
```powershell
docker ps | Select-String "8003"
docker-compose -f docker-compose.port8003.yml up -d
```

### Authentication Errors
Check `.env.docker` contains:
- `STANDARDS_API_KEY=changeit`
- `ANTHROPIC_API_KEY=sk-ant-oat01-...` (OAuth token)

### Timeout Errors
- Product standards may take 30-60s depending on repo size
- SSE streaming tests may take 20-40s
- Default timeout: 120s per test

### Port Conflicts
Use `-Port` parameter to test different containers:
```powershell
.\test-harness.ps1 -Port 8000  # Main container
.\test-harness.ps1 -Port 8001  # Test container
.\test-harness.ps1 -Port 8003  # Development container (default)
```

## Maintenance

### Update Baseline Expectations
Edit `test-harness.ps1` if:
- New critical endpoints are added
- Performance baselines change significantly
- Authentication mechanisms change

### Archive Cleanup
```powershell
# Remove old test results (keep last 7 days)
$cutoffDate = (Get-Date).AddDays(-7)
Get-ChildItem tests/integration/test-results -Directory | 
    Where-Object { $_.CreationTime -lt $cutoffDate } | 
    Remove-Item -Recurse -Force
```

## Known Limitations

- Tests require Docker container to be running
- Tests use real Anthropic API (costs apply)
- Tests create temporary project directories in `/app/api_workspace/test/`
- PowerShell-specific (Windows/cross-platform PowerShell Core)

## Support

If tests consistently fail on known-good code:
1. Check container logs: `docker logs standards-extractor-api-8003`
2. Verify OAuth token is valid
3. Ensure network connectivity to Anthropic API
4. Review test output in `test-results/` directory

---

**Last Updated:** 2026-02-04  
**Version:** 1.0  
**Maintainer:** Standards Extractor Team
