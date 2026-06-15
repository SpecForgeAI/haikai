"""Tests for src/pipeline tools — AstIndex, ast_query, plan_batches (D9/D13).

Includes the D1 anti-pattern guards (count == 0 convention — see
tests/test_anti_pattern_guards.py for the pattern).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from src.pipeline.index import AstIndex, SemanticFilterError
from src.pipeline.tools.plan_batches import plan

INDEX_TSV = """# file\tkind\tname\tscope\tsignature\tline\tflags
app/users.py\tfunction\tget_users\t-\t()\t10\tdecorated
app/users.py\tmethod\tsave\tUserRepo\t(self, user)\t25\t-
app/orders.py\tfunction\tcreate_order\t-\t(req)\t5\tdecorated
lib/util.py\tfunction\thelper\t-\t()\t3\t-
"""

CALLS_TSV = """# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence
app/users.py\tget_users\t-\trepo.find_all\t12\t0.80
app/orders.py\tcreate_order\t-\tdb.execute\t8\t0.90
"""


@pytest.fixture
def snapshot(tmp_path: Path) -> Path:
    (tmp_path / "_index.txt").write_text(INDEX_TSV, encoding="utf-8")
    (tmp_path / "_calls.txt").write_text(CALLS_TSV, encoding="utf-8")
    (tmp_path / "_meta.yaml").write_text("repo: fixture\nsymbol_count: 4\n", encoding="utf-8")
    return tmp_path


class TestAstIndex:
    def test_has_symbol_start_line(self, snapshot):
        assert AstIndex(snapshot).has("app/users.py", 10)

    def test_has_call_line(self, snapshot):
        assert AstIndex(snapshot).has("app/users.py", 12)

    def test_has_rejects_unknown_location(self, snapshot):
        index = AstIndex(snapshot)
        assert not index.has("app/users.py", 99)
        assert not index.has("nope.py", 10)

    def test_has_normalises_path_separators(self, snapshot):
        assert AstIndex(snapshot).has("app\\users.py", 10)

    def test_norm_strips_prefix_not_charset(self):
        # P1a: lstrip("./") is a charset strip — ".github/wf.yml" must NOT become "github/wf.yml"
        from src.pipeline.index import _norm

        assert _norm("./app/users.py") == "app/users.py"
        assert _norm(".github/wf.yml") == ".github/wf.yml"
        assert _norm("..weird/x.py") == "..weird/x.py"
        assert _norm("./.github/wf.yml") == ".github/wf.yml"

    def test_has_dot_prefixed_paths(self, tmp_path):
        (tmp_path / "_index.txt").write_text(
            "# file\tkind\tname\tscope\tsignature\tline\tflags\n"
            ".github/gen.py\tfunction\tgen\t-\t()\t4\t-\n",
            encoding="utf-8",
        )
        (tmp_path / "_calls.txt").write_text("# h\n", encoding="utf-8")
        index = AstIndex(tmp_path)
        assert index.has(".github/gen.py", 4)
        assert not index.has("github/gen.py", 4)  # distinct path must not collide

    def test_query_mechanical_filters(self, snapshot):
        index = AstIndex(snapshot)
        decorated = index.query(has_decorator=True)
        assert {r["name"] for r in decorated} == {"get_users", "create_order"}
        methods = index.query(node_kinds=["method"])
        assert [r["name"] for r in methods] == ["save"]
        named = index.query(name_regex="^get_")
        assert [r["name"] for r in named] == ["get_users"]
        globbed = index.query(file_glob="lib/*.py")
        assert [r["name"] for r in globbed] == ["helper"]

    def test_has_decorator_matches_decorated_flag_only(self, tmp_path):
        # P1d: the store writes async/abstract/extends: into flags — a bool
        # "flags non-empty" check matched async symbols as "decorated".
        (tmp_path / "_index.txt").write_text(
            "# file\tkind\tname\tscope\tsignature\tline\tflags\n"
            "a.py\tfunction\tplain\t-\t()\t1\t-\n"
            "a.py\tfunction\tasync_fn\t-\t()\t2\tasync\n"
            "a.py\tfunction\troute_fn\t-\t()\t3\tdecorated,async\n",
            encoding="utf-8",
        )
        (tmp_path / "_calls.txt").write_text("# h\n", encoding="utf-8")
        index = AstIndex(tmp_path)
        assert [r["name"] for r in index.query(has_decorator=True)] == ["route_fn"]
        assert {r["name"] for r in index.query(has_decorator=False)} == {"plain", "async_fn"}

    def test_store_writes_decorated_flag_with_names(self, tmp_path):
        # The store must emit the flag the filter reads (helper + consumer in
        # sync) — including decorator NAMES for pattern filtering (#4).
        from src.ast.models import StructuralAnalysis, SymbolInfo
        from src.ast.store import FileStore

        sym = SymbolInfo(name="route_fn", kind="function", scope=None, line_start=3, line_end=4)
        sym.decorators = ["@GetMapping(\"/users\")", "Deprecated"]
        analysis = StructuralAnalysis(file_path="a.py", language="python", symbols=[sym])
        store = FileStore(base_path=str(tmp_path))
        store.write_index(tmp_path, {"a.py": analysis})
        text = (tmp_path / "_index.txt").read_text(encoding="utf-8")
        assert "decorated:GetMapping|Deprecated" in text

    def test_has_decorator_name_pattern(self, tmp_path):
        # #4: a string filter is a regex over decorator names — the LLM
        # supplies the framework pattern; this layer just matches it.
        (tmp_path / "_index.txt").write_text(
            "# file\tkind\tname\tscope\tsignature\tline\tflags\n"
            "a.py\tfunction\tlist_users\t-\t()\t1\tdecorated:GetMapping\n"
            "a.py\tfunction\tmake_user\t-\t()\t2\tdecorated:PostMapping|Transactional\n"
            "a.py\tfunction\tlegacy\t-\t()\t3\tdecorated:Deprecated\n"
            "a.py\tfunction\told_snapshot\t-\t()\t4\tdecorated\n"  # no names recorded
            "a.py\tfunction\tplain\t-\t()\t5\t-\n",
            encoding="utf-8",
        )
        (tmp_path / "_calls.txt").write_text("# h\n", encoding="utf-8")
        index = AstIndex(tmp_path)
        mappings = index.query(has_decorator=r"(Get|Post)Mapping")
        assert [r["name"] for r in mappings] == ["list_users", "make_user"]
        # boolean still works; bare "decorated" (old snapshot) matches True
        assert {r["name"] for r in index.query(has_decorator=True)} == {
            "list_users", "make_user", "legacy", "old_snapshot"
        }

    def test_query_rejects_semantic_kinds(self, snapshot):
        index = AstIndex(snapshot)
        for value in ("endpoint", "route", "handler", "controller", "query"):
            with pytest.raises(SemanticFilterError):
                index.query(node_kinds=[value])

    def test_candidate_count(self, snapshot):
        index = AstIndex(snapshot)
        assert index.candidate_count("app/users.py") == 3  # 2 symbols + 1 call
        assert index.candidate_count("lib/util.py") == 1


class TestPlanBatches:
    def test_batches_cover_all_kinds_and_are_stable(self, snapshot):
        first = plan(str(snapshot), ["endpoints", "queries"])
        second = plan(str(snapshot), ["endpoints", "queries"])
        assert first == second  # stable ids (D13)
        kinds = {b["kind"] for b in first}
        assert kinds == {"endpoints", "queries"}
        for batch in first:
            assert batch["id"].startswith(batch["kind"] + "-")
            assert batch["scope"]["files"]
            assert batch["candidate_count"] >= 1

    def test_single_oversize_file_is_planned_not_dead_ended(self, tmp_path):
        # C5: one file with >2*MAX candidates is unsplittable; it must be
        # planned as an explicit oversize batch, not refused forever.
        rows = ["# file\tkind\tname\tscope\tsignature\tline\tflags"]
        rows += [f"mono/god_module.py\tfunction\tfn_{i}\t-\t()\t{i + 1}\t-" for i in range(500)]
        (tmp_path / "_index.txt").write_text("\n".join(rows) + "\n", encoding="utf-8")
        (tmp_path / "_calls.txt").write_text("# h\n", encoding="utf-8")
        batches = plan(str(tmp_path), ["endpoints"])
        assert len(batches) == 1
        assert batches[0]["candidate_count"] == 500
        assert batches[0]["oversize"] is True

        from src.pipeline.checks.batch_plan_check import run as batch_plan_check

        code, payload = batch_plan_check(batches[0])
        assert code == 0, f"oversize single-file batch must proceed: {payload}"

    def test_multifile_oversize_still_refused(self):
        from src.pipeline.checks.batch_plan_check import run as batch_plan_check

        code, _ = batch_plan_check(
            {"id": "endpoints-x", "kind": "endpoints", "scope": {"files": ["a.py", "b.py"]}, "candidate_count": 999}
        )
        assert code == 1  # multi-file oversize means the plan is stale — still refused

    def test_every_file_lands_in_exactly_one_group_per_kind(self, snapshot):
        batches = [b for b in plan(str(snapshot), ["endpoints"])]
        all_files = [f for b in batches for f in b["scope"]["files"]]
        assert sorted(all_files) == sorted(set(all_files))
        assert set(all_files) == {"app/users.py", "app/orders.py", "lib/util.py"}


class TestD1Guards:
    """The treadmill guard: framework semantics must never enter src/pipeline
    (the MECHANICAL layer — agent .md prompts are the judgement layer and
    legitimately carry framework knowledge, so they are NOT scanned).

    count == 0 convention (CLAUDE.md). P3c widened the net: all file types
    under src/pipeline (a pattern hidden in a schema JSON or YAML is as much
    a violation as one in .py) and identifier-prefix dodges (dj_, nx_, ...).
    A tripwire, not a proof — the load-bearing enforcement is ast_query's
    SemanticFilterError plus review.
    """

    PIPELINE_DIR = Path(__file__).resolve().parent.parent.parent / "src" / "pipeline"
    SCANNED_SUFFIXES = {".py", ".json", ".yml", ".yaml", ".txt", ".cfg", ".toml"}
    # Letter-lookaround boundaries, not \b: underscore is a word char, so
    # \bdjango\b misses "django_urls" — exactly the identifier shape to catch.
    FRAMEWORK_NAMES = re.compile(
        r"(?<![A-Za-z])(django|nextjs|next\.js|express|flask|spring|rails|laravel|fastapi"
        r"|cobra|click|commander|gin|koa|struts|ktor|actix|hapi|symfony|sinatra"
        r"|micronaut|quarkus)(?![A-Za-z])"
        r"|(?<![A-Za-z])(dj|nx|rb|expr)_[a-z]",  # abbreviation-prefixed identifiers (dj_url_reader, nx_route_scanner)
        re.IGNORECASE,
    )

    def _scan(self, root: Path) -> list[str]:
        offenders = []
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in self.SCANNED_SUFFIXES:
                continue
            if "__pycache__" in path.parts:
                continue
            for i, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if self.FRAMEWORK_NAMES.search(line):
                    offenders.append(f"{path.relative_to(root)}:{i}: {line.strip()}")
        return offenders

    def test_no_framework_names_in_pipeline_source(self):
        offenders = self._scan(self.PIPELINE_DIR)
        assert len(offenders) == 0, f"framework semantics in the mechanical layer (D1): {offenders}"

    def test_guard_catches_planted_violations(self, tmp_path):
        # The guard must actually catch what it claims to: full names in any
        # scanned file type AND abbreviation-prefixed identifiers.
        (tmp_path / "sneaky.json").write_text('{"reader": "django_urls"}', encoding="utf-8")
        (tmp_path / "dodge.py").write_text("def nx_route_scanner(): pass", encoding="utf-8")
        (tmp_path / "innocent.py").write_text("adjacent = engine.next_token()", encoding="utf-8")
        offenders = self._scan(tmp_path)
        files = {o.split(":")[0] for o in offenders}
        assert files == {"sneaky.json", "dodge.py"}, offenders

    def test_semantic_values_stay_forbidden(self):
        from src.pipeline.index import FORBIDDEN_FILTER_VALUES

        for required in ("endpoint", "route", "handler", "controller", "query", "interaction"):
            assert required in FORBIDDEN_FILTER_VALUES
