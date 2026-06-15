# Refactoring Summary: Directory-Based Architecture

## Branch
`refactor/directory-based-architecture`

## Overview
Complete refactoring from project-name-based to directory-based configuration with three exclusive operational modes.

## Changes Made

### 1. New Files Created

#### `src/models.py`
- **OperationMode** enum: `GET_METAMODEL`, `CREATE_PRODUCT_STANDARDS`, `CREATE_GLOBAL_STANDARDS`
- **Request models** with Pydantic validation:
  - `GetMetamodelRequest`: metamodel_id + project_dir
  - `CreateProductStandardsRequest`: project_dir + global_dir + optional sources
  - `CreateGlobalStandardsRequest`: global_dir + required sources
- **OperationResponse**: Standardized response with success, outputs, errors

#### `src/operation_executor.py`
- **OperationExecutor** class: Core business logic layer
- Decoupled from transport (CLI/SDK/API)
- Executes operations based on request type
- Maps directories to orchestrator based on mode

### 2. Refactored Files

#### `src/metamodel_gateway.py`
**Before**: Mixed responsibilities, used project_name
**After**: 
- Clean separation: `get_from_endpoint()`, `load_from_file()`, `persist()`
- Takes `output_dir` directly (no project_name)
- Full type hints
- Better error handling

#### `src/standards_orchestrator.py`
**Removed**:
- `self.project_name`
- `fetch_metamodel_only()` method

**Added**:
- `self.mode` attribute
- `get_metamodel(metamodel_id)` method
- `create_product_standards()` method (renamed from `run_product_standards_only`)

**Changed**:
- `__init__()` now takes `mode` in config
- `ReportGenerator` initialized with `output_dir` instead of `project_name`
- `MetamodelGateway` initialized with `output_dir`

#### `src/report_generator.py`
**Changed**:
- Constructor takes `output_dir` instead of `project_name`
- Reports show `output_dir` instead of project name
- JSON report uses `output_dir` field

#### `src/cli.py`
**Complete rewrite**:
- Changed from single command to Click group with subcommands
- Three subcommands: `get-metamodel`, `create-product-standards`, `create-global-standards`
- Each subcommand has specific required/optional parameters
- Uses new models and OperationExecutor

#### `run.py`
**Complete rewrite**:
- New `StandardsExtractorClient` class
- Three methods matching CLI subcommands
- Clean Python API
- Returns `OperationResponse` objects

#### `run_simple.py`
**Simplified**:
- Single `run_extractor(operation, **kwargs)` helper
- Examples for all three operations

### 3. Architecture Changes

#### Mode System
```
OLD: Single workflow with optional flags (product_tech_standards, metamodel_get_architecture)
NEW: Three exclusive modes with separate entry points
```

#### Directory Mapping
```python
# Mode → output_dir mapping in orchestrator
if mode == 'get_metamodel' or mode == 'create_product_standards':
    self.output_dir = project_dir
elif mode == 'create_global_standards':
    self.output_dir = global_dir
```

#### Output Paths
- **get_metamodel**: `{project_dir}/metamodel/architecture.json`
- **create_product_standards**: `{project_dir}/product/tech-stack.md`
- **create_global_standards**: `{global_dir}/global/*.md`

### 4. CLI Examples

```bash
# Get metamodel
standards-extractor get-metamodel \
  --metamodel-id proj_123 \
  --project-dir /workspace/my-project

# Create product standards
standards-extractor create-product-standards \
  --project-dir /workspace/my-project \
  --global-dir /workspace/global-standards

# Create global standards
standards-extractor create-global-standards \
  --global-dir /workspace/global-standards \
  --sources ./my-codebase \
  --sources https://github.com/org/repo
```

### 5. SDK Examples

```python
from run import StandardsExtractorClient
from pathlib import Path

client = StandardsExtractorClient()

# Get metamodel
response = client.get_metamodel(
    metamodel_id="proj_123",
    project_dir=Path("/workspace/my-project")
)

# Create product standards
response = client.create_product_standards(
    project_dir=Path("/workspace/my-project"),
    global_dir=Path("/workspace/global-standards")
)

# Create global standards
response = client.create_global_standards(
    global_dir=Path("/workspace/global-standards"),
    sources=["./my-codebase"]
)
```

## Breaking Changes

1. **Removed `project_name`** from all interfaces
2. **CLI changed** from single command to subcommands
3. **run.py API changed** completely
4. **Config structure changed** in orchestrator

## Test Status

- ✅ All files compile without errors
- ✅ All modules import successfully
- ✅ CLI help commands work
- ⚠️ 10 orchestrator tests fail (expected - need updates for new architecture)

## Next Steps

1. Update tests to match new architecture
2. Test with real usage scenarios
3. Update documentation
4. Consider adding REST API layer (future)

## Files Backed Up

- `src/cli.py.backup`
- `run.py.backup`
- `run_simple.py.backup`
