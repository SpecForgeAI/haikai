"""Test file discovery and AST parsing."""

import ast
import logging
from pathlib import Path
from typing import Optional

from src.skills.test_coverage.models import TestFunction, TestFile

logger = logging.getLogger(__name__)

# Directories to skip during discovery
SKIP_DIRS = {"__pycache__", ".git", "node_modules", ".venv", "venv", ".tox", ".eggs"}


class TestDiscovery:
    """Discover and parse test files in a repository."""

    def __init__(self, repo_path: str, test_dirs: Optional[list[str]] = None):
        self.repo_path = Path(repo_path)
        self.test_dirs = test_dirs or ["tests"]

    def discover(self) -> list[TestFile]:
        """Find all test files and parse their contents."""
        test_files = []
        for test_dir in self.test_dirs:
            dir_path = self.repo_path / test_dir
            if not dir_path.exists():
                logger.warning(f"Test directory not found: {dir_path}")
                continue
            test_files.extend(self._scan_directory(dir_path))
        return test_files

    def _scan_directory(self, directory: Path) -> list[TestFile]:
        """Recursively scan a directory for test files."""
        test_files = []
        for path in sorted(directory.rglob("*.py")):
            # Skip excluded directories
            if any(skip in path.parts for skip in SKIP_DIRS):
                continue
            # Match test file patterns
            if path.name.startswith("test_") or path.name.endswith("_test.py"):
                test_file = self._parse_test_file(path)
                if test_file and test_file.test_functions:
                    test_files.append(test_file)
        return test_files

    def _parse_test_file(self, path: Path) -> Optional[TestFile]:
        """Parse a test file and extract test functions."""
        try:
            source = path.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(path))
        except (SyntaxError, UnicodeDecodeError) as e:
            logger.warning(f"Cannot parse {path}: {e}")
            return None

        rel_path = str(path.relative_to(self.repo_path))
        imports = self._extract_imports(tree)
        tested_modules = self._identify_tested_modules(imports)
        # Check for module-level fixture references (e.g., FIXTURE = Path(...) / "fixtures" / ...)
        has_module_fixtures = self._detect_module_fixtures(source)
        test_functions = self._extract_test_functions(
            tree, rel_path, imports, has_module_fixtures=has_module_fixtures
        )

        return TestFile(
            path=rel_path,
            test_functions=test_functions,
            imports=imports,
            tested_modules=tested_modules,
        )

    def _extract_imports(self, tree: ast.Module) -> list[str]:
        """Extract all import statements from the AST."""
        imports = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    imports.append(alias.name)
            elif isinstance(node, ast.ImportFrom):
                if node.module:
                    imports.append(node.module)
        return imports

    def _identify_tested_modules(self, imports: list[str]) -> list[str]:
        """Identify which src modules are being tested based on imports."""
        tested = []
        for imp in imports:
            if imp.startswith("src."):
                tested.append(imp)
        return tested

    def _detect_module_fixtures(self, source: str) -> bool:
        """Detect if a file has module-level fixture references."""
        fixture_indicators = [
            "fixtures/", "fixture", "sample_", "test_data/",
            "FIXTURE", "read_bytes()", "read_text()",
        ]
        # Check top-level lines (not inside functions) for fixture patterns
        for line in source.split("\n"):
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and not stripped.startswith("def "):
                if any(ind in stripped for ind in fixture_indicators):
                    return True
        return False

    def _extract_test_functions(
        self, tree: ast.Module, file_path: str, file_imports: list[str],
        has_module_fixtures: bool = False,
    ) -> list[TestFunction]:
        """Extract test functions/methods from the AST."""
        functions = []
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef):
                # Extract test methods from test classes
                if node.name.startswith("Test"):
                    for item in node.body:
                        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                            if item.name.startswith("test_"):
                                func = self._build_test_function(
                                    item, file_path, file_imports, class_name=node.name,
                                    has_module_fixtures=has_module_fixtures,
                                )
                                functions.append(func)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if node.name.startswith("test_"):
                    # Only top-level test functions (not inside classes)
                    # Check parent by seeing if it's a direct child of the module
                    if any(node is child for child in tree.body):
                        func = self._build_test_function(
                            node, file_path, file_imports,
                            has_module_fixtures=has_module_fixtures,
                        )
                        functions.append(func)

        return functions

    def _build_test_function(
        self,
        node: ast.FunctionDef,
        file_path: str,
        file_imports: list[str],
        class_name: Optional[str] = None,
        has_module_fixtures: bool = False,
    ) -> TestFunction:
        """Build a TestFunction from an AST node."""
        decorators = []
        for dec in node.decorator_list:
            if isinstance(dec, ast.Name):
                decorators.append(dec.id)
            elif isinstance(dec, ast.Attribute):
                decorators.append(ast.dump(dec))
            elif isinstance(dec, ast.Call):
                if isinstance(dec.func, ast.Name):
                    decorators.append(dec.func.id)
                elif isinstance(dec.func, ast.Attribute):
                    decorators.append(ast.dump(dec.func))

        uses_mocks = self._detect_mocks(node, file_imports, decorators)
        reads_fixtures = self._detect_fixtures(node, file_imports) or has_module_fixtures
        tested_module = self._infer_tested_module(file_imports)
        is_resilience = self._detect_resilience(node)

        return TestFunction(
            name=node.name,
            file_path=file_path,
            class_name=class_name,
            imports=file_imports,
            uses_mocks=uses_mocks,
            reads_fixtures=reads_fixtures,
            tested_module=tested_module,
            decorators=decorators,
            is_resilience=is_resilience,
        )

    def _detect_mocks(
        self, node: ast.FunctionDef, imports: list[str], decorators: list[str]
    ) -> bool:
        """Detect if a test uses mocking."""
        # Check imports
        mock_imports = {"unittest.mock", "mock", "pytest_mock"}
        if any(imp in mock_imports or "mock" in imp.lower() for imp in imports):
            # Check if the function body actually uses mocks
            source = ast.dump(node)
            mock_indicators = [
                "MagicMock", "Mock(", "patch", "PropertyMock",
                "mock_", "monkeypatch", "create_autospec",
            ]
            if any(indicator in source for indicator in mock_indicators):
                return True

        # Check decorators for @patch
        for dec in decorators:
            if "patch" in str(dec).lower():
                return True

        return False

    def _detect_fixtures(self, node: ast.FunctionDef, imports: list[str]) -> bool:
        """Detect if a test reads real fixture files."""
        source = ast.dump(node)
        fixture_indicators = [
            "fixtures/", "fixture", "test_data/",
            "sample_", "read_text", "read_bytes",
            "open(", "Path(",
        ]
        # Check for real file operations in the test body
        for indicator in fixture_indicators:
            if indicator in source:
                return True
        return False

    def _infer_tested_module(self, imports: list[str]) -> Optional[str]:
        """Infer which source module this test targets."""
        src_imports = [imp for imp in imports if imp.startswith("src.")]
        if src_imports:
            return src_imports[0]
        return None

    def _detect_resilience(self, node: ast.FunctionDef) -> bool:
        """Detect if a test is a resilience/edge case test."""
        # Check function name
        resilience_keywords = {
            "error", "invalid", "empty", "none", "corrupt", "fail",
            "timeout", "missing", "broken", "malformed", "unknown",
            "negative", "bad", "wrong", "null", "unavailable",
        }
        name_lower = node.name.lower()
        if any(kw in name_lower for kw in resilience_keywords):
            return True

        # Check for pytest.raises or assertRaises in body
        source = ast.dump(node)
        if "pytest.raises" in source or "assertRaises" in source or "raises(" in source:
            return True

        return False
