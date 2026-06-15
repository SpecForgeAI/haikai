# Phase 1 — Implementation Tasks (sp_planning compliant)

**Goal:** Get ctags structural data flowing through the pipeline so the LLM receives metadata instead of raw code, and chunking respects symbol boundaries.

**Architecture:** CtagsProvider indexes files via `ctags --output-format=json`, outputs `StructuralAnalysis` per file. `file_analyzer.py` checks for structural data and formats it for LLM prompts. `ASTChunker` splits at function/class boundaries.

**Tech Stack:** Python 3.11+, universal-ctags (CLI), dataclasses (models), pytest

**Key Design Principles:**

1. **Test model contracts, not tool output.** `SymbolKind` defines our canonical vocabulary. `CtagsProvider.CTAGS_KIND_MAP` is the single mapping layer between ctags labels and our kinds. Tests assert against `SymbolKind` values. If ctags changes labels between versions, only the map updates — tests and consumers stay stable.

2. **Batch-first API.** `analyze_batch()` is the only public API on `CtagsProvider`. Single-file analysis goes through `analyze_batch([file])`. Having both `analyze()` and `analyze_batch()` invites the wrong one being called — in production, we always want batch (one subprocess for all files). The single-file path is an internal detail.

3. **No dropped content in chunking.** ASTChunker must account for ALL file content — module-level statements, decorators, constants between symbols, shebang lines, imports. The "gap region" between symbols gets attached to the next symbol's chunk. The chunker uses line coverage tracking to guarantee zero dropped lines.

---

### Task 1: Data Models (`src/ast/models.py`)

**Files:**
- Create: `src/ast/__init__.py`
- Create: `src/ast/models.py`
- Test: `tests/ast/__init__.py`
- Test: `tests/ast/test_models.py`

- [ ] **Step 1: Write failing test — SymbolKind contract**

```python
# tests/ast/test_models.py
from src.ast.models import SymbolInfo, SymbolKind, StructuralAnalysis, InheritanceInfo, ImportInfo

def test_symbol_info_accepts_canonical_kinds():
    """Contract: SymbolInfo.kind must be one of our canonical SymbolKind values."""
    for kind in [SymbolKind.CLASS, SymbolKind.METHOD, SymbolKind.FUNCTION, SymbolKind.VARIABLE]:
        sym = SymbolInfo(name="test", kind=kind)
        assert sym.kind == kind

def test_symbol_info_rejects_unknown_kinds():
    """Contract: non-canonical kinds are normalized to UNKNOWN.
    This is key — if ctags calls methods 'member' and we forget to map it,
    it becomes UNKNOWN rather than silently passing a tool-specific label."""
    sym = SymbolInfo(name="test", kind="member")  # ctags-specific label
    assert sym.kind == SymbolKind.UNKNOWN

def test_symbol_info_construction():
    sym = SymbolInfo(
        name="get_user",
        kind=SymbolKind.METHOD,
        scope="UserService",
        line_start=22,
        line_end=35,
        signature="(self, user_id: int) -> User",
    )
    assert sym.name == "get_user"
    assert sym.kind == SymbolKind.METHOD
    assert sym.scope == "UserService"
    assert sym.line_start == 22
    assert sym.line_end == 35

def test_structural_analysis_defaults():
    sa = StructuralAnalysis(file_path="test.py", language="python")
    assert sa.symbols == []
    assert sa.inheritance == []
    assert sa.imports == []
    assert sa.provider_used == "unknown"

def test_structural_analysis_with_symbols():
    sa = StructuralAnalysis(
        file_path="test.py",
        language="python",
        symbols=[
            SymbolInfo(name="UserService", kind=SymbolKind.CLASS, line_start=1, line_end=50),
            SymbolInfo(name="get_user", kind=SymbolKind.METHOD, scope="UserService", line_start=10, line_end=20),
        ],
        provider_used="ctags",
    )
    assert len(sa.symbols) == 2
    assert sa.symbols[0].kind == SymbolKind.CLASS
    assert sa.symbols[1].scope == "UserService"

def test_inheritance_info():
    info = InheritanceInfo(class_name="UserService", bases=["BaseService", "ABC"])
    assert info.class_name == "UserService"
    assert len(info.bases) == 2
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pytest tests/ast/test_models.py -v
```
Expected: `ModuleNotFoundError: No module named 'src.ast.models'`

- [ ] **Step 3: Implement models**

```python
# src/ast/__init__.py
# (empty)

# src/ast/models.py
from dataclasses import dataclass, field
from typing import Optional


class SymbolKind:
    """Canonical symbol kinds — OUR contract, not any tool's vocabulary.
    
    All providers (ctags, LSP, future) must map their output to these kinds.
    Tests assert against these. If a provider changes its labels, only
    the provider's mapping layer updates — not tests, not consumers.
    """
    CLASS = "class"
    FUNCTION = "function"
    METHOD = "method"
    VARIABLE = "variable"
    CONSTANT = "constant"
    INTERFACE = "interface"
    DECORATOR = "decorator"
    MODULE = "module"
    PROPERTY = "property"
    UNKNOWN = "unknown"

    ALL = {CLASS, FUNCTION, METHOD, VARIABLE, CONSTANT, INTERFACE,
           DECORATOR, MODULE, PROPERTY, UNKNOWN}


@dataclass
class SymbolInfo:
    name: str
    kind: str  # Must be a SymbolKind value — our canonical kinds
    scope: Optional[str] = None
    line_start: int = 0
    line_end: int = 0
    signature: Optional[str] = None
    is_async: bool = False
    is_abstract: bool = False
    decorators: list[str] = field(default_factory=list)
    visibility: str = "public"  # public, private, protected
    inherits: Optional[str] = None

    def __post_init__(self):
        if self.kind not in SymbolKind.ALL:
            self.kind = SymbolKind.UNKNOWN


@dataclass
class InheritanceInfo:
    class_name: str
    bases: list[str] = field(default_factory=list)
    interfaces: list[str] = field(default_factory=list)
    is_abstract: bool = False


@dataclass
class ImportInfo:
    module: str
    names: list[str] = field(default_factory=list)
    is_relative: bool = False
    line_number: int = 0


@dataclass
class StructuralAnalysis:
    file_path: str
    language: str
    symbols: list[SymbolInfo] = field(default_factory=list)
    inheritance: list[InheritanceInfo] = field(default_factory=list)
    imports: list[ImportInfo] = field(default_factory=list)
    provider_used: str = "unknown"
    analysis_depth: str = "basic"  # basic (ctags) or rich (LSP)
    language_version: Optional[str] = None
```

- [ ] **Step 4: Run test — verify it passes**

```bash
pytest tests/ast/test_models.py -v
```
Expected: All PASSED

- [ ] **Step 5: Commit**

```bash
git add src/ast/ tests/ast/
git commit -m "feat(ast): add structural analysis data models

- SymbolKind canonical vocabulary (contract, not tool labels)
- SymbolInfo with __post_init__ normalization to UNKNOWN
- InheritanceInfo, ImportInfo, StructuralAnalysis
- Full test coverage including kind rejection"
```

---

### Task 2: Provider Abstraction (`src/ast/provider.py`)

**Files:**
- Create: `src/ast/provider.py`
- Test: `tests/ast/test_provider.py`

- [ ] **Step 1: Write failing test — ProviderRegistry**

```python
# tests/ast/test_provider.py
from src.ast.provider import AnalysisProvider, ProviderRegistry
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


class MockProvider(AnalysisProvider):
    """Mock provider for testing registry behavior."""
    
    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        return {
            fp: StructuralAnalysis(
                file_path=fp, language="python", provider_used="mock",
                symbols=[SymbolInfo(name="MockClass", kind=SymbolKind.CLASS, line_start=1, line_end=10)]
            )
            for fp in file_paths
        }

    def is_available(self) -> bool:
        return True

    @property
    def name(self) -> str:
        return "mock"


class UnavailableProvider(AnalysisProvider):
    def analyze_batch(self, file_paths): return {}
    def is_available(self): return False
    @property
    def name(self): return "unavailable"


def test_registry_batch_returns_results():
    registry = ProviderRegistry()
    registry.register(MockProvider())
    results = registry.analyze_batch(["test.py", "test2.py"])
    assert "test.py" in results
    assert "test2.py" in results
    assert results["test.py"].provider_used == "mock"

def test_registry_single_file_via_batch():
    """Single file goes through batch API — no separate analyze() method."""
    registry = ProviderRegistry()
    registry.register(MockProvider())
    results = registry.analyze_batch(["test.py"])
    assert len(results) == 1
    assert results["test.py"].provider_used == "mock"

def test_registry_returns_empty_when_no_providers():
    registry = ProviderRegistry()
    results = registry.analyze_batch(["test.py"])
    assert results == {}

def test_registry_skips_unavailable_provider():
    registry = ProviderRegistry()
    registry.register(UnavailableProvider())
    results = registry.analyze_batch(["test.py"])
    assert results == {}

def test_env_var_disables_provider(monkeypatch):
    monkeypatch.setenv("AST_CTAGS_ENABLED", "false")
    registry = ProviderRegistry()
    assert registry.is_provider_enabled("ctags") is False

def test_env_var_enables_provider(monkeypatch):
    monkeypatch.setenv("AST_CTAGS_ENABLED", "true")
    registry = ProviderRegistry()
    assert registry.is_provider_enabled("ctags") is True
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pytest tests/ast/test_provider.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement provider abstraction**

```python
# src/ast/provider.py
from abc import ABC, abstractmethod
from typing import Optional
import logging
import yaml
import os

from src.ast.models import StructuralAnalysis

logger = logging.getLogger(__name__)


class AnalysisProvider(ABC):
    """Base class for structural analysis providers.
    
    Public API is analyze_batch() only. Single-file analysis
    goes through analyze_batch([file]). This ensures we always
    use the efficient batch path — no accidental per-file subprocess spawning.
    """

    @abstractmethod
    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Analyze multiple files. This is the ONLY public analysis method.
        For single files, call analyze_batch([path]).
        Returns dict of file_path → StructuralAnalysis."""
        pass

    @abstractmethod
    def is_available(self) -> bool:
        """Check if provider binary/service is available."""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider name for logging and caching."""
        pass


class ProviderRegistry:
    def __init__(self, config_path: Optional[str] = None):
        self._providers: list[AnalysisProvider] = []
        self._config = self._load_config(config_path)

    def _load_config(self, config_path: Optional[str]) -> dict:
        if config_path and os.path.exists(config_path):
            with open(config_path) as f:
                return yaml.safe_load(f) or {}
        return {
            "providers": {
                "ctags": {"enabled": os.environ.get("AST_CTAGS_ENABLED", "true").lower() == "true"},
                "lsp": {"enabled": os.environ.get("AST_LSP_ENABLED", "false").lower() == "true"},
                "llm": {"enabled": os.environ.get("AST_LLM_ENABLED", "true").lower() == "true"},
            }
        }

    def is_provider_enabled(self, provider_name: str) -> bool:
        providers = self._config.get("providers", {})
        return providers.get(provider_name, {}).get("enabled", False)

    def register(self, provider: AnalysisProvider) -> None:
        self._providers.append(provider)
        logger.info(f"Registered analysis provider: {provider.name}")

    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Analyze files using the first available enabled provider.
        Single entry point for all analysis — batch is the only public API."""
        for provider in self._providers:
            if not self.is_provider_enabled(provider.name):
                continue
            if not provider.is_available():
                logger.warning(f"Provider {provider.name} not available, skipping")
                continue
            try:
                results = provider.analyze_batch(file_paths)
                if results:
                    return results
            except Exception as e:
                logger.error(f"Provider {provider.name} failed: {e}")
                continue
        return {}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
pytest tests/ast/test_provider.py -v
```
Expected: All PASSED

- [ ] **Step 5: Commit**

```bash
git add src/ast/provider.py tests/ast/test_provider.py
git commit -m "feat(ast): add provider abstraction — batch-only public API

- AnalysisProvider ABC: analyze_batch() is the only public method
- ProviderRegistry with config loading and env var overrides
- No single-file analyze() — batch handles all cases
- Graceful fallback when provider unavailable"
```

---

### Task 3: CtagsProvider (`src/ast/ctags_provider.py`)

**Files:**
- Create: `src/ast/ctags_provider.py`
- Test: `tests/ast/test_ctags_provider.py`
- Fixture: `tests/fixtures/sample_python.py`

- [ ] **Step 1: Create test fixture — known Python file with various symbol types**

```python
# tests/fixtures/sample_python.py
"""Sample file for ctags testing — known structure.

Module-level docstring — this is module-level content that
the chunker must NOT drop.
"""
from abc import ABC, abstractmethod
import os

# Module-level constant
CONSTANT_VALUE = 42
MAX_RETRIES = 3

class BaseService(ABC):
    @abstractmethod
    def execute(self) -> None:
        pass

class UserService(BaseService):
    def __init__(self, db):
        self.db = db

    def get_user(self, user_id: int):
        return self.db.query(user_id)

    def save_user(self, user) -> None:
        self.db.save(user)

    async def fetch_remote_user(self, url: str):
        pass

def standalone_function(x: int, y: int) -> int:
    return x + y

# Module-level statement between symbols
_registry = {}

def another_function():
    pass
```

- [ ] **Step 2: Write failing tests — contract-based, not tool-label-based**

```python
# tests/ast/test_ctags_provider.py
import shutil
import pytest
from src.ast.ctags_provider import CtagsProvider
from src.ast.models import SymbolKind


@pytest.fixture
def provider():
    return CtagsProvider()


@pytest.fixture(autouse=True)
def skip_if_no_ctags():
    if not shutil.which("ctags"):
        pytest.skip("ctags not installed")


# ── Mapping layer tests (NO ctags binary needed) ──

class TestKindMapping:
    """Test the mapping layer in isolation. These are pure unit tests
    that validate our contract boundary with ctags."""

    def test_member_maps_to_method(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "get_user", "kind": "member", "line": 10})
        assert sym.kind == SymbolKind.METHOD

    def test_function_maps_to_function(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "main", "kind": "function", "line": 1})
        assert sym.kind == SymbolKind.FUNCTION

    def test_unknown_kind_maps_to_unknown(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "x", "kind": "somethingnew", "line": 1})
        assert sym.kind == SymbolKind.UNKNOWN

    def test_field_maps_to_variable(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "count", "kind": "field", "line": 5})
        assert sym.kind == SymbolKind.VARIABLE

    def test_class_maps_to_class(self):
        provider = CtagsProvider()
        sym = provider._map_tag({"name": "Foo", "kind": "class", "line": 1})
        assert sym.kind == SymbolKind.CLASS


# ── Integration tests (need ctags binary) ──

class TestBatchAnalyze:
    """Test the batch API — the only public analysis method."""

    def test_batch_single_file(self, provider):
        """Single file goes through batch. No separate single-file API."""
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        assert "tests/fixtures/sample_python.py" in results
        result = results["tests/fixtures/sample_python.py"]
        assert result.provider_used == "ctags"

    def test_batch_multiple_files(self, provider):
        results = provider.analyze_batch([
            "tests/fixtures/sample_python.py",
            "src/ast/models.py",
        ])
        assert len(results) >= 1

    def test_batch_finds_expected_symbols(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        names = [s.name for s in result.symbols]
        assert "BaseService" in names
        assert "UserService" in names
        assert "get_user" in names
        assert "save_user" in names
        assert "standalone_function" in names

    def test_batch_empty_list(self, provider):
        results = provider.analyze_batch([])
        assert results == {}


class TestContractCompliance:
    """All symbols must use our canonical kinds, not ctags labels."""

    def test_all_kinds_are_canonical(self, provider):
        """No raw tool labels should leak into StructuralAnalysis."""
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        for symbol in result.symbols:
            assert symbol.kind in SymbolKind.ALL, (
                f"Symbol '{symbol.name}' has non-canonical kind '{symbol.kind}'. "
                f"CtagsProvider must map this to a SymbolKind value."
            )

    def test_classes_are_classes(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        user_service = next(s for s in result.symbols if s.name == "UserService")
        assert user_service.kind == SymbolKind.CLASS

    def test_methods_are_methods(self, provider):
        """Methods inside classes are SymbolKind.METHOD, not 'member'."""
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        get_user = next(s for s in result.symbols if s.name == "get_user")
        assert get_user.kind == SymbolKind.METHOD
        assert get_user.scope is not None  # scoped to a class

    def test_standalone_functions(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        func = next(s for s in result.symbols if s.name == "standalone_function")
        assert func.kind == SymbolKind.FUNCTION

    def test_inheritance_detected(self, provider):
        results = provider.analyze_batch(["tests/fixtures/sample_python.py"])
        result = results["tests/fixtures/sample_python.py"]
        user_service = next(s for s in result.symbols if s.name == "UserService")
        assert "BaseService" in (user_service.inherits or "")


class TestAvailability:
    def test_is_available(self, provider):
        assert provider.is_available() is True

    def test_unavailable_when_no_binary(self, monkeypatch):
        monkeypatch.setattr("shutil.which", lambda x: None)
        provider = CtagsProvider()
        assert provider.is_available() is False
```

- [ ] **Step 3: Run test — verify it fails**

```bash
pytest tests/ast/test_ctags_provider.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 4: Implement CtagsProvider — batch-only public API**

```python
# src/ast/ctags_provider.py
import json
import logging
import shutil
import subprocess
from typing import Optional

from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind, InheritanceInfo
from src.ast.provider import AnalysisProvider

logger = logging.getLogger(__name__)


class CtagsProvider(AnalysisProvider):
    """Structural analysis via universal-ctags.
    
    Public API is analyze_batch() only. Internally runs one ctags subprocess
    for all files — no per-file subprocess spawning.
    """
    
    CTAGS_ARGS = [
        "--output-format=json",
        "--fields=+niaSstKz",
        "--kinds-all=*",
        "-f", "-",
    ]

    # Mapping from ctags kind labels → our canonical SymbolKind.
    # This is the ONLY place that knows about ctags vocabulary.
    # If ctags changes labels between versions, update HERE only.
    CTAGS_KIND_MAP = {
        # Python
        "class": SymbolKind.CLASS,
        "function": SymbolKind.FUNCTION,
        "member": SymbolKind.METHOD,      # ctags calls methods "member"
        "method": SymbolKind.METHOD,       # some ctags versions
        "variable": SymbolKind.VARIABLE,
        "local": SymbolKind.VARIABLE,
        # JavaScript / TypeScript
        "property": SymbolKind.PROPERTY,
        "constant": SymbolKind.CONSTANT,
        "generator": SymbolKind.FUNCTION,
        # Java / C# / Go
        "interface": SymbolKind.INTERFACE,
        "field": SymbolKind.VARIABLE,
        "enum": SymbolKind.CLASS,
        "struct": SymbolKind.CLASS,
        # General
        "module": SymbolKind.MODULE,
        "namespace": SymbolKind.MODULE,
        "package": SymbolKind.MODULE,
        "decorator": SymbolKind.DECORATOR,
    }

    @property
    def name(self) -> str:
        return "ctags"

    def is_available(self) -> bool:
        return shutil.which("ctags") is not None

    def analyze_batch(self, file_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Analyze multiple files in one ctags invocation.
        
        This is the only public analysis method. For a single file,
        call analyze_batch([file_path]).
        """
        if not self.is_available() or not file_paths:
            return {}

        try:
            result = subprocess.run(
                ["ctags"] + self.CTAGS_ARGS + list(file_paths),
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                logger.error(f"ctags batch failed: {result.stderr}")
                return {}

            return self._parse_batch_output(result.stdout, file_paths)
        except subprocess.TimeoutExpired:
            logger.error(f"ctags timed out for {len(file_paths)} files")
            return {}
        except Exception as e:
            logger.error(f"ctags batch error: {e}")
            return {}

    def _map_tag(self, tag: dict) -> Optional[SymbolInfo]:
        """Map a single ctags JSON tag to our canonical SymbolInfo.
        
        This is the contract boundary — ctags labels enter here,
        canonical SymbolKind values come out.
        """
        name = tag.get("name")
        raw_kind = tag.get("kind")
        if not name or not raw_kind:
            return None

        canonical_kind = self.CTAGS_KIND_MAP.get(raw_kind, SymbolKind.UNKNOWN)

        return SymbolInfo(
            name=name,
            kind=canonical_kind,
            scope=tag.get("scope"),
            line_start=tag.get("line", 0),
            line_end=tag.get("end", tag.get("line", 0)),
            signature=tag.get("signature"),
            inherits=tag.get("inherits"),
        )

    def _parse_batch_output(self, output: str, requested_paths: list[str]) -> dict[str, StructuralAnalysis]:
        """Parse ctags JSON output into per-file StructuralAnalysis."""
        file_tags: dict[str, list] = {}
        for line in output.strip().split("\n"):
            if not line.strip():
                continue
            try:
                tag = json.loads(line)
                path = tag.get("path", "")
                file_tags.setdefault(path, []).append(tag)
            except json.JSONDecodeError:
                continue

        results = {}
        for path, tags in file_tags.items():
            symbols = []
            inheritance = []
            language = "unknown"
            for tag in tags:
                if language == "unknown" and "language" in tag:
                    language = tag["language"]
                symbol = self._map_tag(tag)
                if symbol:
                    symbols.append(symbol)
                    if symbol.inherits:
                        inheritance.append(
                            InheritanceInfo(
                                class_name=symbol.name,
                                bases=[b.strip() for b in symbol.inherits.split(",")],
                            )
                        )
            results[path] = StructuralAnalysis(
                file_path=path,
                language=language,
                symbols=symbols,
                inheritance=inheritance,
                provider_used="ctags",
                analysis_depth="basic",
            )
        return results
```

- [ ] **Step 5: Run tests — verify pass**

```bash
pytest tests/ast/test_ctags_provider.py -v
```
Expected: All PASSED

- [ ] **Step 6: Commit**

```bash
git add src/ast/ctags_provider.py tests/ast/test_ctags_provider.py tests/fixtures/sample_python.py
git commit -m "feat(ast): add CtagsProvider — batch-only, contract-mapped

- analyze_batch() is the only public API (one subprocess for all files)
- CTAGS_KIND_MAP: single mapping layer ctags→canonical
- _map_tag() is the contract boundary
- Tests validate SymbolKind contracts, not ctags labels
- Mapping tests run without ctags binary"
```

---

### Task 4: AST Chunker (`src/chunking/ast_chunker.py`)

**Files:**
- Create: `src/chunking/ast_chunker.py`
- Modify: `src/chunking/chunker_factory.py`
- Test: `tests/chunking/test_ast_chunker.py`

**Key design decision:** The chunker must cover ALL lines in the file, not just symbol regions. Content between symbols (module-level statements, constants, decorators, imports) is assigned to "gap regions" that get prepended to the next symbol's chunk. A line coverage check at the end verifies zero lines were dropped.

- [ ] **Step 1: Write failing tests — including gap coverage**

```python
# tests/chunking/test_ast_chunker.py
from src.chunking.ast_chunker import ASTChunker
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


class TestNoDroppedContent:
    """The chunker must never drop content between symbols."""

    def test_module_level_code_preserved(self):
        """Module-level imports, constants, and statements must appear in output."""
        source = '''"""Module docstring."""
import os
from typing import List

CONSTANT = 42
MAX_SIZE = 100

class MyClass:
    def method(self):
        pass

# Between symbols
_cache = {}

def standalone():
    pass
'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="MyClass", kind=SymbolKind.CLASS, line_start=8, line_end=10),
                SymbolInfo(name="method", kind=SymbolKind.METHOD, scope="MyClass", line_start=9, line_end=10),
                SymbolInfo(name="standalone", kind=SymbolKind.FUNCTION, line_start=15, line_end=16),
            ],
        )
        chunker = ASTChunker(structural)
        chunks = chunker.chunk(source)
        all_output = "\n".join(chunks)

        # Everything must be present
        assert '"""Module docstring."""' in all_output
        assert "import os" in all_output
        assert "CONSTANT = 42" in all_output
        assert "MAX_SIZE = 100" in all_output
        assert "_cache = {}" in all_output
        assert "class MyClass:" in all_output
        assert "def standalone():" in all_output

    def test_line_coverage_complete(self):
        """Every line in the source must appear in exactly one chunk."""
        source = '''line 1
line 2
line 3
line 4
line 5'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="something", kind=SymbolKind.FUNCTION, line_start=3, line_end=4),
            ],
        )
        chunker = ASTChunker(structural)
        chunks = chunker.chunk(source)

        source_lines = source.split('\n')
        output_lines = []
        for chunk in chunks:
            output_lines.extend(chunk.split('\n'))

        # Every source line must appear
        for line in source_lines:
            if line.strip():  # skip blank lines
                assert line in '\n'.join(chunks), f"Line dropped: '{line}'"

    def test_no_content_when_no_symbols(self):
        """When there are no symbols, return the whole file as one chunk."""
        source = "# just a comment\nx = 1\n"
        structural = StructuralAnalysis(file_path="test.py", language="python", symbols=[])
        chunker = ASTChunker(structural)
        chunks = chunker.chunk(source)
        assert len(chunks) == 1
        assert chunks[0] == source


class TestSymbolBoundaries:
    """Functions and classes must never be split across chunks."""

    def test_no_mid_function_split(self):
        source_lines = ['class BigService:']
        for i in range(20):
            source_lines.append(f'    def method_{i}(self):')
            for j in range(10):
                source_lines.append(f'        line_{j} = {j}')
            source_lines.append(f'        return {i}')
            source_lines.append('')
        source = '\n'.join(source_lines)

        symbols = [SymbolInfo(name="BigService", kind=SymbolKind.CLASS, line_start=1, line_end=len(source_lines))]
        for i in range(20):
            start = 2 + i * 13
            symbols.append(SymbolInfo(
                name=f"method_{i}", kind=SymbolKind.METHOD, scope="BigService",
                line_start=start, line_end=start + 11,
            ))
        structural = StructuralAnalysis(file_path="test.py", language="python", symbols=symbols)
        chunker = ASTChunker(structural, max_chunk_chars=500)
        chunks = chunker.chunk(source)

        for chunk in chunks:
            defs = chunk.count('def method_')
            returns = chunk.count('return')
            assert defs == returns, f"Chunk has {defs} defs but {returns} returns — function split!"

    def test_chunks_at_class_boundaries(self):
        source = '''class First:
    def a(self):
        return 1

class Second:
    def b(self):
        return 2
'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="First", kind=SymbolKind.CLASS, line_start=1, line_end=3),
                SymbolInfo(name="a", kind=SymbolKind.METHOD, scope="First", line_start=2, line_end=3),
                SymbolInfo(name="Second", kind=SymbolKind.CLASS, line_start=5, line_end=7),
                SymbolInfo(name="b", kind=SymbolKind.METHOD, scope="Second", line_start=6, line_end=7),
            ],
        )
        chunker = ASTChunker(structural, max_chunk_chars=100)
        chunks = chunker.chunk(source)

        # If "class First:" is in a chunk, "return 1" must also be
        for chunk in chunks:
            if "class First:" in chunk:
                assert "return 1" in chunk


class TestScopeHandling:
    """Chunker must handle symbols correctly regardless of how ctags reports scope."""

    def test_scoped_methods_not_treated_as_top_level(self):
        """Methods with scope set should not become separate top-level chunks."""
        source = '''class MyClass:
    def method_a(self):
        return 1
    def method_b(self):
        return 2
'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="MyClass", kind=SymbolKind.CLASS, line_start=1, line_end=5),
                SymbolInfo(name="method_a", kind=SymbolKind.METHOD, scope="MyClass", line_start=2, line_end=3),
                SymbolInfo(name="method_b", kind=SymbolKind.METHOD, scope="MyClass", line_start=4, line_end=5),
            ],
        )
        chunker = ASTChunker(structural)
        chunks = chunker.chunk(source)

        # Class and its methods should be together (if chunk size allows)
        assert any("class MyClass:" in c and "method_a" in c and "method_b" in c for c in chunks)


class TestFactoryIntegration:

    def test_factory_selects_ast_chunker_when_structural(self):
        from src.chunking.chunker_factory import ChunkerFactory
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[SymbolInfo(name="Foo", kind=SymbolKind.CLASS, line_start=1, line_end=10)]
        )
        factory = ChunkerFactory()
        chunker = factory.get_chunker("test.py", "class Foo: pass", structural_analysis=sa)
        assert isinstance(chunker, ASTChunker)

    def test_factory_falls_back_without_structural(self):
        from src.chunking.chunker_factory import ChunkerFactory
        factory = ChunkerFactory()
        chunker = factory.get_chunker("test.py", "class Foo: pass")
        assert not isinstance(chunker, ASTChunker)
```

- [ ] **Step 2: Run test — verify it fails**

```bash
pytest tests/chunking/test_ast_chunker.py -v
```
Expected: `ModuleNotFoundError`

- [ ] **Step 3: Implement ASTChunker with gap region handling**

```python
# src/chunking/ast_chunker.py
from typing import List, Dict, Any
from src.chunking.base_chunker import BaseChunker, ChunkResult
from src.ast.models import StructuralAnalysis, SymbolInfo


class ASTChunker(BaseChunker):
    """Chunks files at symbol boundaries, never splitting mid-function/class.
    
    Key invariant: ALL lines in the file appear in exactly one chunk.
    Content between symbols (module-level statements, constants, decorators)
    is captured as "gap regions" and prepended to the next symbol's chunk.
    """

    def __init__(self, structural_analysis: StructuralAnalysis, max_chunk_chars: int = 75000):
        super().__init__()
        self.structural = structural_analysis
        self.max_chunk_chars = max_chunk_chars

    def supports(self, file_path: str, content: str) -> bool:
        return bool(self.structural and self.structural.symbols)

    def chunk(self, content: str) -> ChunkResult:
        lines = content.split('\n')
        total_lines = len(lines)

        top_level = self._get_top_level_symbols()

        if not top_level:
            return ChunkResult(chunks=[content] if content.strip() else [], metadata={"strategy": "ast_no_symbols"})

        # Build regions: each region is a (start_line, end_line) tuple (1-indexed)
        # Gap regions between symbols are merged into the next symbol's region
        regions = self._build_regions_with_gaps(top_level, total_lines)

        # Build chunks respecting max size
        chunks = []
        current_lines = []
        current_size = 0

        for region_start, region_end in regions:
            region_lines = lines[region_start - 1 : region_end]  # convert to 0-indexed
            region_text = '\n'.join(region_lines)
            region_size = len(region_text)

            if current_size + region_size > self.max_chunk_chars and current_lines:
                chunks.append('\n'.join(current_lines))
                current_lines = []
                current_size = 0

            current_lines.extend(region_lines)
            current_size += region_size

        if current_lines:
            chunks.append('\n'.join(current_lines))

        return ChunkResult(
            chunks=chunks if chunks else [content],
            metadata={"strategy": "ast", "symbol_count": len(top_level), "chunk_count": len(chunks)}
        )

    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge chunk analyses by combining all fields."""
        if not chunk_analyses:
            return {}
        if len(chunk_analyses) == 1:
            return chunk_analyses[0]

        merged = dict(chunk_analyses[0])
        for analysis in chunk_analyses[1:]:
            for key, value in analysis.items():
                if key in merged and isinstance(merged[key], list) and isinstance(value, list):
                    merged[key].extend(value)
                elif key not in merged:
                    merged[key] = value
        return merged

    def _get_top_level_symbols(self) -> list[SymbolInfo]:
        """Get top-level symbols for chunking boundaries.
        
        Top-level = symbols that define chunk boundaries. This includes:
        - Classes (any kind=class regardless of scope reporting)
        - Standalone functions (kind=function with no scope)
        
        Methods inside classes are NOT top-level — they're part of their class chunk.
        
        We identify top-level by checking:
        1. kind is CLASS → always top-level
        2. kind is FUNCTION and scope is None → top-level standalone function
        3. kind is FUNCTION and scope is set → method-like, not top-level
        
        This avoids depending on ctags' scope reporting format, which varies.
        """
        from src.ast.models import SymbolKind

        top_level = []
        for s in self.structural.symbols:
            if s.kind == SymbolKind.CLASS:
                # Classes are always chunk boundaries
                top_level.append(s)
            elif s.kind == SymbolKind.FUNCTION and s.scope is None:
                # Standalone functions (not methods)
                top_level.append(s)

        return sorted(top_level, key=lambda s: s.line_start)

    def _build_regions_with_gaps(self, top_level: list[SymbolInfo], total_lines: int) -> list[tuple[int, int]]:
        """Build line regions that cover ALL lines in the file.
        
        For each top-level symbol, the region starts from the end of the
        previous symbol (or line 1 for the first). This captures gap content
        (module-level statements, constants, comments) and attaches it to
        the next symbol's chunk.
        
        Returns: list of (start_line, end_line) tuples, 1-indexed, covering
        every line in the file exactly once.
        """
        if not top_level:
            return [(1, total_lines)]

        regions = []
        prev_end = 0  # line after previous symbol ends (0 = start of file)

        for symbol in top_level:
            # Region starts from where the previous one ended + 1
            # (or line 1 for the first symbol, which captures file header)
            region_start = prev_end + 1
            region_end = max(symbol.line_end, symbol.line_start)
            regions.append((region_start, region_end))
            prev_end = region_end

        # Capture trailing content after last symbol
        if prev_end < total_lines:
            # Attach to last region
            last_start, last_end = regions[-1]
            regions[-1] = (last_start, total_lines)

        return regions
```

- [ ] **Step 4: Modify chunker_factory.py**

```python
# In src/chunking/chunker_factory.py
# Change get_chunker signature and add AST priority:

def get_chunker(self, file_path: str, content: str, structural_analysis=None) -> BaseChunker:
    """Get appropriate chunker for the given file.
    
    Args:
        file_path: Path to the file
        content: File content
        structural_analysis: Optional StructuralAnalysis for AST-aware chunking
    """
    # AST chunker takes priority when structural data is available
    if structural_analysis and structural_analysis.symbols:
        from .ast_chunker import ASTChunker
        return ASTChunker(structural_analysis)
    
    self._lazy_init()
    
    for chunker in self._chunkers:
        if chunker.supports(file_path, content):
            return chunker
    
    return self._chunkers[-1]
```

- [ ] **Step 5: Run all tests — verify pass including no regressions**

```bash
pytest tests/chunking/ -v
```
Expected: All PASSED

- [ ] **Step 6: Commit**

```bash
git add src/chunking/ast_chunker.py src/chunking/chunker_factory.py tests/chunking/test_ast_chunker.py
git commit -m "feat(ast): AST chunker with gap region coverage — zero dropped lines

- Top-level symbols (classes, standalone functions) define chunk boundaries
- Gap regions (imports, constants, module-level code) prepended to next chunk
- Line coverage invariant: every source line appears in exactly one chunk
- ChunkerFactory prefers ASTChunker when structural data available
- Tests verify: no mid-function splits, no dropped content, scope handling"
```

---

### Task 5: Pipeline Integration (`src/file_analyzer.py` + `src/ast/formatter.py`)

This is the riskiest task — it modifies the existing pipeline. Every change is specified with before/after code and exact line references.

**Files:**
- Create: `src/ast/formatter.py`
- Modify: `src/file_analyzer.py` (see exact changes below)
- Test: `tests/ast/test_formatter.py`
- Test: `tests/ast/test_pipeline_integration.py`

#### 5a: Structural Output Formatter

- [ ] **Step 1: Write failing test — formatter produces compact output**

```python
# tests/ast/test_formatter.py
from src.ast.formatter import format_structural_output
from src.ast.models import (
    StructuralAnalysis, SymbolInfo, SymbolKind,
    InheritanceInfo, ImportInfo,
)


class TestFormatter:

    def test_format_basic(self):
        sa = StructuralAnalysis(
            file_path="test.py",
            language="python",
            symbols=[
                SymbolInfo(name="UserService", kind=SymbolKind.CLASS,
                           line_start=1, line_end=50, inherits="BaseService"),
                SymbolInfo(name="get_user", kind=SymbolKind.METHOD,
                           scope="UserService", line_start=10, line_end=20,
                           signature="(self, user_id: int) -> User"),
                SymbolInfo(name="save_user", kind=SymbolKind.METHOD,
                           scope="UserService", line_start=25, line_end=35,
                           signature="(self, user: User) -> None"),
            ],
            inheritance=[InheritanceInfo(class_name="UserService", bases=["BaseService"])],
            imports=[ImportInfo(module="fastapi", names=["FastAPI", "APIRouter"])],
        )
        output = format_structural_output(sa)

        # Must mention key symbols
        assert "UserService" in output
        assert "get_user" in output
        assert "BaseService" in output
        assert "fastapi" in output

        # Must be compact — significantly shorter than typical raw code
        assert len(output) < 1000

    def test_format_empty(self):
        sa = StructuralAnalysis(file_path="test.py", language="python")
        output = format_structural_output(sa)
        assert output == ""

    def test_format_preserves_signatures(self):
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="process", kind=SymbolKind.FUNCTION,
                           signature="(data: list[dict], limit: int = 100) -> Result"),
            ],
        )
        output = format_structural_output(sa)
        assert "(data: list[dict], limit: int = 100) -> Result" in output

    def test_format_groups_by_scope(self):
        """Methods should appear under their class, not flat."""
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="MyClass", kind=SymbolKind.CLASS, line_start=1, line_end=30),
                SymbolInfo(name="method_a", kind=SymbolKind.METHOD, scope="MyClass", line_start=5, line_end=10),
                SymbolInfo(name="method_b", kind=SymbolKind.METHOD, scope="MyClass", line_start=15, line_end=20),
                SymbolInfo(name="standalone", kind=SymbolKind.FUNCTION, line_start=35, line_end=40),
            ],
        )
        output = format_structural_output(sa)
        # Class should appear before its methods
        class_pos = output.index("MyClass")
        method_a_pos = output.index("method_a")
        assert class_pos < method_a_pos
```

- [ ] **Step 2: Run test — verify fail, then implement**

```python
# src/ast/formatter.py
"""Format StructuralAnalysis into compact text for LLM prompts.

This replaces raw source code in the LLM prompt. The output should be
information-dense and significantly smaller than the original code.
"""
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


def format_structural_output(analysis: StructuralAnalysis) -> str:
    """Format structural analysis as compact text for LLM consumption.
    
    Returns empty string if no structural data available.
    """
    if not analysis.symbols:
        return ""

    sections = []

    # Imports
    if analysis.imports:
        import_lines = [f"  {imp.module}" + (f" ({', '.join(imp.names)})" if imp.names else "")
                        for imp in analysis.imports]
        sections.append("Imports:\n" + "\n".join(import_lines))

    # Group symbols by scope
    top_level = [s for s in analysis.symbols if s.scope is None]
    by_scope: dict[str, list[SymbolInfo]] = {}
    for s in analysis.symbols:
        if s.scope:
            by_scope.setdefault(s.scope, []).append(s)

    # Format top-level symbols
    symbol_lines = []
    for sym in sorted(top_level, key=lambda s: s.line_start):
        symbol_lines.append(_format_symbol(sym, indent=0))
        # Add scoped children
        if sym.name in by_scope:
            for child in sorted(by_scope[sym.name], key=lambda s: s.line_start):
                symbol_lines.append(_format_symbol(child, indent=1))

    if symbol_lines:
        sections.append("Symbols:\n" + "\n".join(symbol_lines))

    # Inheritance
    if analysis.inheritance:
        inh_lines = [f"  {i.class_name} → {', '.join(i.bases)}" for i in analysis.inheritance]
        sections.append("Inheritance:\n" + "\n".join(inh_lines))

    return "\n\n".join(sections)


def _format_symbol(sym: SymbolInfo, indent: int = 0) -> str:
    prefix = "  " * (indent + 1)
    parts = [f"{prefix}{sym.kind}: {sym.name}"]
    if sym.signature:
        parts[0] += sym.signature
    if sym.inherits:
        parts[0] += f" extends {sym.inherits}"
    extras = []
    if sym.is_async:
        extras.append("async")
    if sym.is_abstract:
        extras.append("abstract")
    if extras:
        parts[0] += f" [{', '.join(extras)}]"
    return parts[0]
```

- [ ] **Step 3: Run formatter tests**

```bash
pytest tests/ast/test_formatter.py -v
```
Expected: All PASSED

- [ ] **Step 4: Commit formatter**

```bash
git add src/ast/formatter.py tests/ast/test_formatter.py
git commit -m "feat(ast): structural output formatter for LLM prompts

- Compact text format: symbols grouped by scope, signatures preserved
- Imports and inheritance sections
- Empty string for no structural data
- Significantly smaller than raw code (~200 tokens vs ~2000)"
```

#### 5b: file_analyzer.py Integration

The existing `file_analyzer.py` has these integration points:

1. **`__init__`** (line ~79): Add `ProviderRegistry` initialization
2. **`analyze_file`** (line ~96): Add structural analysis before LLM call
3. **`analyze_file`** (line ~111): Pass structural data to chunker_factory
4. **`_analyze_single_chunk`** (line ~172): Use structural data in chunk analysis
5. **`analyze_batch`** (line ~206): Pre-analyze all files structurally before iterating

- [ ] **Step 5: Write integration test**

```python
# tests/ast/test_pipeline_integration.py
"""Integration test: structural analysis flows through the pipeline."""
import pytest
from unittest.mock import MagicMock, patch
from src.file_analyzer import FileAnalyzer


class TestPipelineIntegration:

    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.generate.return_value = '{"standards": [], "patterns": []}'
        return llm

    def test_structural_data_reduces_prompt_size(self, mock_llm, tmp_path):
        """When structural data is available, the prompt sent to LLM
        should contain structural output, not raw code."""
        # Create a test file
        test_file = tmp_path / "test_code.py"
        test_file.write_text('''
class UserService:
    def get_user(self, user_id: int):
        """Get user by ID from the database."""
        result = self.db.query("SELECT * FROM users WHERE id = %s", user_id)
        if not result:
            raise UserNotFoundError(user_id)
        return User(**result)

    def save_user(self, user) -> None:
        """Save user to the database."""
        self.db.execute("INSERT INTO users ...", user.dict())
''')
        analyzer = FileAnalyzer(mock_llm, config_dir=str(tmp_path))

        from src.strategies.base_strategy import FileAnalysisContext
        context = FileAnalysisContext(
            path=str(test_file),
            category="code",
            standard_file="test.md"
        )
        analyzer.analyze_file(context)

        # Check what was sent to LLM
        if mock_llm.generate.called:
            call_args = mock_llm.generate.call_args[0][0]
            user_message = call_args[-1]["content"]

            # If ctags is available, prompt should be smaller than raw code
            import shutil
            if shutil.which("ctags"):
                raw_size = len(test_file.read_text())
                prompt_size = len(user_message)
                # Structural prompt should be significantly smaller
                # (exact ratio depends on prompt template, but direction matters)
                print(f"Raw: {raw_size} chars, Prompt: {prompt_size} chars")

    def test_pipeline_works_without_ctags(self, mock_llm, tmp_path):
        """Without ctags, pipeline falls back to raw code — no errors."""
        test_file = tmp_path / "test.py"
        test_file.write_text("x = 1\n")

        with patch("shutil.which", return_value=None):
            analyzer = FileAnalyzer(mock_llm, config_dir=str(tmp_path))
            from src.strategies.base_strategy import FileAnalysisContext
            context = FileAnalysisContext(
                path=str(test_file), category="code", standard_file="test.md"
            )
            # Should not raise
            analyzer.analyze_file(context)

    def test_batch_pre_analyzes_structurally(self, mock_llm, tmp_path):
        """analyze_batch should run ctags once for all files, not per-file."""
        for i in range(5):
            f = tmp_path / f"file_{i}.py"
            f.write_text(f"def func_{i}(): pass\n")

        analyzer = FileAnalyzer(mock_llm, config_dir=str(tmp_path))

        from src.strategies.base_strategy import FileAnalysisContext
        contexts = [
            FileAnalysisContext(path=str(tmp_path / f"file_{i}.py"), category="code", standard_file="test.md")
            for i in range(5)
        ]
        analyzer.analyze_batch(contexts, show_progress=False)

    def test_analyze_file_without_batch_uses_raw_code(self, mock_llm, tmp_path):
        """If analyze_file is called directly (not through analyze_batch),
        it just reads the file and uses raw code. No structural analysis,
        no subprocess, no warnings — it simply doesn't know about AST."""
        test_file = tmp_path / "test.py"
        test_file.write_text("def hello(): pass\n")

        analyzer = FileAnalyzer(mock_llm, config_dir=str(tmp_path))

        from src.strategies.base_strategy import FileAnalysisContext
        context = FileAnalysisContext(
            path=str(test_file), category="code", standard_file="test.md"
        )

        with patch("subprocess.run") as mock_subprocess:
            analyzer.analyze_file(context)
            # No ctags subprocess spawned — analyze_file doesn't know about ctags
            for call in mock_subprocess.call_args_list:
                args = call[0][0] if call[0] else []
                assert "ctags" not in str(args), \
                    "analyze_file spawned ctags — structural analysis belongs in analyze_batch only"
```

- [ ] **Step 6: Implement file_analyzer.py changes**

Exact modifications to `src/file_analyzer.py`:

**Change 1: Add imports (top of file, after existing imports)**

```python
# ADD after line 12 (after "from .chunking import ChunkerFactory")
from .ast.provider import ProviderRegistry
from .ast.ctags_provider import CtagsProvider
from .ast.formatter import format_structural_output
```

**Change 2: `__init__` — add provider registry (after line ~86)**

```python
# ADD inside __init__, after self.chunker_factory = ChunkerFactory()
        
        # Structural analysis provider
        self._provider_registry = ProviderRegistry(
            config_path=str(Path(config_dir) / "analysis_providers.yaml")
        )
        ctags = CtagsProvider()
        if ctags.is_available():
            self._provider_registry.register(ctags)
```

**Change 3: `analyze_batch` — structural analysis as content transformation (replace lines ~206-222)**

`analyze_batch` is the only place structural analysis happens. It transforms content
before handing off to `analyze_file`. `analyze_file` itself is unchanged — it just
receives content (which may be structural output or raw code) and sends it to the LLM.

```python
    def analyze_batch(self, contexts: List[FileAnalysisContext],
                      show_progress: bool = True) -> List[Dict]:
        """
        Analyze a batch of files.
        
        Runs structural analysis (ctags) on all files in one batch call,
        then for each file: if structural data exists, the formatted structural
        output replaces raw code as the content passed to analyze_file.
        analyze_file doesn't know about structural analysis — it just gets content.
        """
        # Step 1: Structural analysis — one ctags subprocess for all files
        file_paths = [ctx.path for ctx in contexts]
        structural_results = self._provider_registry.analyze_batch(file_paths)
        if structural_results:
            logger.info(f"Structural analysis: {len(structural_results)} files indexed")

        # Step 2: For each file, transform content if structural data available
        results = []
        iterator = tqdm(contexts, desc="Analyzing files") if show_progress else contexts
        
        for context in iterator:
            # Check if we have structural data for this file
            structural = structural_results.get(context.path)
            if structural:
                formatted = format_structural_output(structural)
                if formatted:
                    # Replace the file content with structural output
                    # analyze_file will use this instead of reading raw code
                    context = self._with_structural_content(context, formatted, structural)

            analysis = self.analyze_file(context)
            if analysis:
                results.append(analysis)
        
        return results

    def _with_structural_content(self, context: FileAnalysisContext,
                                  formatted: str, structural) -> FileAnalysisContext:
        """Create a new context with structural content attached.
        
        We attach the pre-formatted content and structural metadata to the context
        so analyze_file can use it without knowing about structural analysis.
        """
        # Create a copy with structural content attached
        new_context = FileAnalysisContext(
            path=context.path,
            category=context.category,
            standard_file=context.standard_file,
        )
        new_context._structural_content = formatted
        new_context._structural_analysis = structural
        return new_context
```

**Change 4: `analyze_file` — minimal change: use pre-formatted content if attached**

`analyze_file` stays simple. The only change: if the context has pre-formatted
structural content (set by `analyze_batch`), use that instead of reading the file.

```python
    def analyze_file(self, context: FileAnalysisContext) -> Optional[Dict]:
        """Analyze a single file. Unchanged from current behavior except:
        if context has structural content (set by analyze_batch), use that."""
        try:
            # Use structural content if available (set by analyze_batch),
            # otherwise read raw file content (current behavior)
            structural_content = getattr(context, '_structural_content', None)
            structural = getattr(context, '_structural_analysis', None)

            if structural_content:
                content = structural_content
                logger.info(f"Using structural data for {context.path} "
                           f"({len(content)} chars)")
            else:
                content = self._read_file(context.path)
                if content is None:
                    return None

            if len(content) > self.max_file_size_bytes:
                content = content[:self.max_file_size_bytes]
                content += "\n\n... (file truncated due to size)"
            
            # Get chunker — pass structural data for AST-aware chunking
            chunker = self.chunker_factory.get_chunker(
                context.path, content,
                structural_analysis=structural
            )

            if chunker.should_chunk(content):
                logger.info(f"File requires chunking: {context.path}")
                return self._analyze_with_chunking(context, content, chunker)
            
            # Select strategy and get prompts — content is either
            # structural output (~200 tokens) or raw code (~2000 tokens)
            strategy = self._get_strategy(context.category)
            system_prompt, user_prompt, max_tokens = strategy.get_prompts(
                context.path, content, context
            )
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            
            try:
                response = self.llm_client.generate(messages)
                if not response or len(response) == 0:
                    logger.error(f"LLM returned empty response for {context.path}")
                    return None
            except Exception as e:
                logger.error(f"LLM generation failed for {context.path}: {type(e).__name__}: {str(e)}")
                return None
            
            analysis = self._parse_json_response(response)
            
            if analysis:
                analysis['source_file'] = context.path
                analysis['category'] = context.category
                analysis['standard_file'] = context.standard_file
                analysis['structural_analysis_used'] = structural is not None
                
                strategy_metadata = strategy.get_metadata(
                    context.path, content, context
                )
                analysis.update(strategy_metadata)
            
            return analysis
            
        except Exception as e:
            import traceback
            logger.error(f"Error analyzing file {context.path}: {str(e)}\n{traceback.format_exc()}")
            return None
```

- [ ] **Step 7: Run integration tests**

```bash
pytest tests/ast/test_pipeline_integration.py -v
```
Expected: All PASSED

- [ ] **Step 8: Run full test suite — verify no regressions**

```bash
pytest tests/ -v --tb=short
```
Expected: All existing tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/file_analyzer.py src/ast/formatter.py tests/ast/
git commit -m "feat(ast): integrate structural analysis into pipeline

- analyze_batch pre-indexes all files via ctags (one subprocess)
- analyze_file uses structural data when available
- Structural output replaces raw code in LLM prompts
- Backward compatible: falls back to raw code without ctags
- structural_analysis_used flag in analysis results"
```

---

### Task 6: Config + Docker + Verification Gates

**Files:**
- Create: `config/analysis_providers.yaml`
- Modify: `Dockerfile`
- Test: `tests/ast/test_token_reduction.py`

- [ ] **Step 1: Create config yaml**

```yaml
# config/analysis_providers.yaml
providers:
  ctags:
    enabled: true
  lsp:
    enabled: false
  llm:
    enabled: true
```

- [ ] **Step 2: Add ctags to Dockerfile**

```dockerfile
# ADD after existing apt-get install line
RUN apt-get update && apt-get install -y universal-ctags && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2b: Add tiktoken to requirements.txt**

```
# ADD to requirements.txt
tiktoken
```

- [ ] **Step 3: Write token reduction benchmark (Gate 1.3)**

```python
# tests/ast/test_token_reduction.py
import shutil
import pytest


@pytest.fixture(autouse=True)
def skip_if_no_ctags():
    if not shutil.which("ctags"):
        pytest.skip("ctags not installed")


import tiktoken

def _count_tokens(text: str) -> int:
    """Count tokens using tiktoken (cl100k_base, used by GPT-4/Claude)."""
    enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


def test_per_file_token_reduction():
    """Gate 1.3: structural prompt uses ≥80% fewer tokens than raw code.
    
    This is the headline metric. Measured in actual tokens (via tiktoken),
    not character count. If this fails, the structural output is too
    verbose or the formatter needs work.
    """
    from src.ast.ctags_provider import CtagsProvider
    from src.ast.formatter import format_structural_output

    provider = CtagsProvider()
    test_file = "src/file_analyzer.py"

    with open(test_file) as f:
        raw_content = f.read()

    results = provider.analyze_batch([test_file])
    structural = results.get(test_file)
    assert structural is not None, "ctags should produce results for file_analyzer.py"

    structural_output = format_structural_output(structural)
    assert structural_output, "Formatter should produce non-empty output"

    raw_tokens = _count_tokens(raw_content)
    structural_tokens = _count_tokens(structural_output)
    reduction = 1 - (structural_tokens / raw_tokens) if raw_tokens > 0 else 0

    print(f"\n{'='*50}")
    print(f"Token reduction gate (Gate 1.3)")
    print(f"  Raw code:        {raw_tokens:>6} tokens")
    print(f"  Structural:      {structural_tokens:>6} tokens")
    print(f"  Reduction:       {reduction:>6.0%}")
    print(f"  Threshold:       ≥80%")
    print(f"{'='*50}")

    assert reduction >= 0.80, (
        f"Expected ≥80% token reduction, got {reduction:.0%}. "
        f"Raw: {raw_tokens} tokens, Structural: {structural_tokens} tokens. "
        f"Structural output may be too verbose."
    )


def test_backward_compatibility_without_ctags():
    """Gate 1.4: with ctags disabled, pipeline is unchanged."""
    import os
    os.environ["AST_CTAGS_ENABLED"] = "false"
    try:
        from src.ast.provider import ProviderRegistry
        registry = ProviderRegistry()
        assert registry.is_provider_enabled("ctags") is False
        results = registry.analyze_batch(["src/file_analyzer.py"])
        assert results == {}
    finally:
        os.environ.pop("AST_CTAGS_ENABLED", None)
```

- [ ] **Step 4: Run verification gates**

```bash
pytest tests/ast/test_token_reduction.py -v -s
```
Expected: PASSED with ≥80% reduction shown

- [ ] **Step 5: Commit and push**

```bash
git add config/ Dockerfile tests/ast/test_token_reduction.py
git commit -m "feat(ast): config, Docker, and verification gates

- analysis_providers.yaml: ctags+LLM enabled, LSP disabled
- Dockerfile: install universal-ctags
- Gate 1.3: token reduction benchmark (≥80%)
- Gate 1.4: backward compatibility without ctags"
```

---

## Execution Strategy (sp_subagent_dev)

### Dispatch Order

Tasks 1-6 are **sequential** — each depends on the previous.

| Task | Model Tier | Why |
|------|-----------|-----|
| Task 1: Models | Fast/cheap | Pure data classes, isolated, no integration |
| Task 2: Provider | Fast/cheap | ABC + registry, straightforward |
| Task 3: CtagsProvider | Standard | Subprocess, JSON parsing, mapping layer |
| Task 4: AST Chunker | Standard | Algorithm work, gap region handling, factory integration |
| Task 5: Pipeline Integration | Most capable | Multi-file modification, existing codebase, riskiest task |
| Task 6: Config + Docker | Fast/cheap | Mechanical, plus benchmark test |

### Review Protocol (per task)

1. **Spec review** — does the code match the task spec?
2. **Code quality review** — clean, readable, proper error handling?
3. **Contract check** — no raw ctags labels in tests or consumer code?
4. **Test verification** — `pytest` output shown (sp_verification: actual output, not "should pass")

### Completion Gate

Phase 1 is complete when:
- All 6 tasks committed with passing tests
- Gate 1.1: ctags produces valid StructuralAnalysis (≥200 symbols from project)
- Gate 1.2: AST chunker never splits mid-function, never drops content
- Gate 1.3: ≥80% per-file token reduction (measured, not estimated)
- Gate 1.4: Backward compatibility (all existing tests pass with ctags disabled)
- Gate 1.5: Docker build with ctags
