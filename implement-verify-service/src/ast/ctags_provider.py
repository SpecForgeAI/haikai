import json
import logging
import os
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
        "--fields=+niaSstKzl",
        "--kinds-all=*",
        "-f", "-",
    ]

    # Inline fallback mappings — used ONLY when YAML config is missing.
    # Production should always use config/symbol_kind_mappings.yaml.
    _FALLBACK_KIND_MAP = {
        "class": SymbolKind.CLASS,
        "function": SymbolKind.FUNCTION,
        "member": SymbolKind.METHOD,
        "method": SymbolKind.METHOD,
        "property": SymbolKind.PROPERTY,
        "constant": SymbolKind.CONSTANT,
        "generator": SymbolKind.FUNCTION,
        "interface": SymbolKind.INTERFACE,
        "field": SymbolKind.VARIABLE,
        "enum": SymbolKind.CLASS,
        "struct": SymbolKind.CLASS,
        "variable": SymbolKind.VARIABLE,
        "local": SymbolKind.VARIABLE,
        "module": SymbolKind.MODULE,
        "namespace": SymbolKind.MODULE,
        "package": SymbolKind.MODULE,
        "decorator": SymbolKind.DECORATOR,
    }

    def __init__(self):
        self._kind_map = None  # Lazy-loaded from YAML

    def _get_kind_map(self) -> dict:
        """Load kind mappings from versioned YAML config.

        Falls back to inline defaults if YAML not found (with warning).
        Hard stop (VersionNotFoundError) if YAML exists but version not found.
        """
        if self._kind_map is not None:
            return self._kind_map

        try:
            from src.ast.kind_mapping_loader import load_kind_mappings, detect_ctags_version
            version = detect_ctags_version()
            if version:
                self._kind_map = load_kind_mappings("ctags", version)
                return self._kind_map
            else:
                logger.warning(
                    "Could not detect ctags version. "
                    "Using fallback kind mappings. "
                    "Install universal-ctags for version-verified mappings."
                )
                self._kind_map = self._FALLBACK_KIND_MAP
                return self._kind_map
        except FileNotFoundError:
            logger.warning(
                "config/symbol_kind_mappings.yaml not found. "
                "Using fallback kind mappings. "
                "Create the config file for version-verified mappings."
            )
            self._kind_map = self._FALLBACK_KIND_MAP
            return self._kind_map
        # VersionNotFoundError intentionally NOT caught — hard stop

    @property
    def name(self) -> str:
        return "ctags"

    # Cached set of file extensions ctags knows how to parse.
    _supported_extensions: Optional[set[str]] = None

    @classmethod
    def get_supported_extensions(cls) -> set[str]:
        """Return the set of file extensions ctags can parse.

        Queries ``ctags --list-maps`` once and caches the result.  Falls back
        to a minimal built-in set if ctags is not installed.
        """
        if cls._supported_extensions is not None:
            return cls._supported_extensions

        fallback = {
            ".py", ".pyi", ".java", ".ts", ".tsx", ".js", ".jsx",
            ".go", ".cs", ".rs", ".c", ".cpp", ".cc", ".cxx",
            ".h", ".hpp", ".hxx", ".rb",
        }

        if not shutil.which("ctags"):
            cls._supported_extensions = fallback
            return cls._supported_extensions

        try:
            result = subprocess.run(
                ["ctags", "--list-maps"],
                capture_output=True, text=True, encoding="utf-8",
                timeout=10,
            )
            if result.returncode != 0:
                cls._supported_extensions = fallback
                return cls._supported_extensions

            extensions = set()
            for line in result.stdout.splitlines():
                # Each line: "LanguageName  *.ext1 *.ext2 ..."
                parts = line.split()
                for part in parts[1:]:  # skip language name
                    if part.startswith("*."):
                        ext = part[1:]  # "*.rb" -> ".rb"
                        extensions.add(ext)

            cls._supported_extensions = extensions if extensions else fallback
        except Exception:
            cls._supported_extensions = fallback

        return cls._supported_extensions

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
            import tempfile

            # Use -L (file list) to avoid Windows ~32K command line length limit
            with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as f:
                f.write("\n".join(file_paths))
                filelist_path = f.name

            try:
                result = subprocess.run(
                    ["ctags"] + self.CTAGS_ARGS + ["-L", filelist_path],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=int(os.environ.get("CTAGS_TIMEOUT_SEC", "600")),
                )
            finally:
                os.remove(filelist_path)

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

        canonical_kind = self._get_kind_map().get(raw_kind, SymbolKind.UNKNOWN)

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
        """Parse ctags JSON output into per-file StructuralAnalysis.

        Returns dict keyed by the ORIGINAL paths the caller passed in,
        not ctags' path format. This ensures callers can look up results
        using the same paths they provided, regardless of OS path separators.
        """
        # Map normalized paths back to the original caller-provided paths
        norm_to_original = {os.path.normpath(p): p for p in requested_paths}

        file_tags: dict[str, list] = {}
        for line in output.strip().split("\n"):
            if not line.strip():
                continue
            try:
                tag = json.loads(line)
                path = os.path.normpath(tag.get("path", ""))
                file_tags.setdefault(path, []).append(tag)
            except json.JSONDecodeError:
                continue

        results = {}
        for norm_path, tags in file_tags.items():
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
            # Use the original path the caller provided as the key
            original_path = norm_to_original.get(norm_path, norm_path)
            results[original_path] = StructuralAnalysis(
                file_path=original_path,
                language=language,
                symbols=symbols,
                inheritance=inheritance,
                provider_used="ctags",
                analysis_depth="basic",
            )
        return results
