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
