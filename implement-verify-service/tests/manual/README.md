# Manual Tests & Test Documentation

This directory contains manual test scripts, test results documentation, and sample data for the Standards Extractor API.

## Test Results

**TEST_RESULTS.md** - Comprehensive test results from 2026-02-01 session:
- HTTP download resilience fixes
- Cloudscraper 403 bypass implementation
- 9 architecture document URLs tested (5 success, 4 failed)
- PDF parsing verification

## Sample Data

**cloud-platform-architecture.json** - Sample architecture metamodel for testing product standards generation:
- Company: CloudTech Enterprises
- Project: CloudDataPlatform
- 11 services across 6 components (Kafka, Spark, Delta Lake, React, PyTorch, etc.)

## Manual Test Scripts

**PowerShell:**
- `test-request.ps1` - Example API request with authentication

**Python:**
- `test_ask_questions.py` - Question-answering API tests
- `test_chat_api.py` - Chat interface tests
- `test_file.py` - File processing tests
- `test_full_metamodel_workflow.py` - Complete metamodel workflow
- `test_integrated_metamodel.py` - Metamodel integration tests
- `test_job_queue.py` - Job queue functionality tests
- `test_metamodel_llm.py` - LLM-based metamodel generation
- `test_optional_project_name.py` - Project name handling tests
- `test_product_tech_stack.py` - Product tech stack extraction tests
- `test_strategy_synthesis.py` - Strategy synthesis tests

## Running Manual Tests

### API Tests (PowerShell)
```powershell
# Set API key
$env:STANDARDS_API_KEY = "changeit"

# Run test request
.\test-request.ps1
```

### Python Tests
```bash
# Ensure container is running
docker ps | grep standards-extractor

# Run individual test
python tests/manual/test_chat_api.py
```

## Automated Tests

For automated unit/integration tests, see the parent `tests/` directory.

## Test Data Notes

**Known 404 URLs (documented failures):**
- `fmi.org/our-insights/building-a-capable-technology-stack` - Page moved
- `cordis.europa.eu/.../D419Pathssystemarchitecturereport.pdf` - PDF deleted
- `example.com/SVT_Analytics_Software_Architecture_Document.pdf` - Placeholder domain

**Known 403 URLs (anti-bot protection):**
- `docs.aws.amazon.com/security-reference-architecture.pdf` - Aggressive protection (even cloudscraper blocked)

These failures are expected and documented in TEST_RESULTS.md.
