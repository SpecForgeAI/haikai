"""IVS structural validation over a REAL generated SQL Server pack.

SQL Server 16 -> PostgreSQL 18 pair programme, Spec 5.8 (2026-09-11).

The pack under ``tests/fixtures/mssql-pack`` is not hand-written: it is the
byte-for-byte output of the gateway generator's own SQL Server fixture,
vendored by

    HAIKAI_DUMP_MSSQL_PACK=1 npx jest dbMigrationPackGenerationMssql

in ``gateway/``. That matters because the gateway's generation-time gate
(``packValidation.ts``) and this apply-time gate
(``validate_pack_on_disk``) are two INDEPENDENT implementations of the same
runnable-pack invariants -- well-formed XML comments, resolvable includes,
parser-safe changeset ids, BOM-free JSON. The 2026-07-30 live failure was a
pack that passed generation and could not parse at apply time; checking the
real artefact on both sides is what keeps the two from drifting apart.

The SQL Server pack is the harder case on purpose: it carries the item-5
emulations changeset (``015-emulations.sql``) with its dollar-quoted PL/pgSQL
trigger functions, partial and covering indexes, and a NOT VALID constraint.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.haikai_models import AssemblePackFile
from src.job_queue.assembly import validate_pack_on_disk

FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "mssql-pack"


def _pack_files() -> list[AssemblePackFile]:
    """Every vendored file as the request shape, repo-relative and sorted."""
    files: list[AssemblePackFile] = []
    for path in sorted(FIXTURE_ROOT.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(FIXTURE_ROOT).as_posix()
        files.append(
            AssemblePackFile(path=rel, content=path.read_text(encoding="utf-8"))
        )
    return files


def test_fixture_pack_is_present_and_is_the_sql_server_pack():
    assert FIXTURE_ROOT.is_dir(), (
        f"missing vendored pack at {FIXTURE_ROOT} -- regenerate with "
        "HAIKAI_DUMP_MSSQL_PACK=1 npx jest dbMigrationPackGenerationMssql"
    )
    manifest = json.loads((FIXTURE_ROOT / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["source_engine"] == "mssql"
    assert manifest["target_engine"] == "postgres"
    assert manifest["pair_id"] == "sqlserver16-postgres18"


def test_generated_sql_server_pack_passes_structural_validation():
    """The apply-time gate finds NOTHING wrong with the generated pack."""
    problems = validate_pack_on_disk(FIXTURE_ROOT, _pack_files())
    assert problems == []


def test_the_item5_emulations_changeset_is_included_and_ordered_after_the_tables():
    """The emulations ALTER the tables they follow, so order is semantic."""
    master = (FIXTURE_ROOT / "liquibase" / "db.changelog-master.xml").read_text(
        encoding="utf-8"
    )
    tables_at = master.index("changesets/010-tables/")
    emulations_at = master.index("changesets/015-emulations.sql")
    post_load_at = master.index("changesets/020-foreign-keys.sql")
    assert tables_at < emulations_at < post_load_at
    assert (FIXTURE_ROOT / "liquibase" / "changesets" / "015-emulations.sql").is_file()


def _write(tmp_path: Path, files: list[AssemblePackFile]) -> list[str]:
    for f in files:
        target = tmp_path / f.path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.content, encoding="utf-8")
    return validate_pack_on_disk(tmp_path, files)


def _damaged(replacement_path: str, content: str) -> list[AssemblePackFile]:
    return [
        AssemblePackFile(path=f.path, content=content)
        if f.path == replacement_path
        else f
        for f in _pack_files()
    ]


MASTER_PATH = "liquibase/db.changelog-master.xml"
SCHEMAS_PATH = "liquibase/changesets/000-schemas.sql"


def _content(path: str) -> str:
    return (FIXTURE_ROOT / path).read_text(encoding="utf-8")


def test_the_gate_still_bites_on_an_illegal_xml_comment(tmp_path: Path):
    """A positive result above is only meaningful if the gate can still fail.

    A ``--`` inside an XML comment is the 2026-07-30 live parse failure. It
    short-circuits the include walk on purpose: an unparseable changelog has
    no includes to resolve, so reporting one problem loudly beats guessing.
    """
    damaged = _damaged(
        MASTER_PATH,
        _content(MASTER_PATH).replace(
            "<!-- Structural phase:", "<!-- Structural phase -- broken:"
        ),
    )
    assert any("not well-formed XML" in p for p in _write(tmp_path, damaged))


def test_the_gate_still_bites_on_a_dangling_include(tmp_path: Path):
    """An include naming a file the generator never produced."""
    damaged = _damaged(
        MASTER_PATH,
        _content(MASTER_PATH).replace(
            'file="changesets/030-indexes.sql"',
            'file="changesets/999-never-generated.sql"',
        ),
    )
    problems = _write(tmp_path, damaged)
    assert any("dangling include" in p for p in problems)
    assert any("999-never-generated.sql" in p for p in problems)


def test_the_gate_still_bites_on_an_unparsable_changeset_id(tmp_path: Path):
    """`--` inside a changeset id opens a SQL comment in the header line."""
    damaged = _damaged(
        SCHEMAS_PATH,
        _content(SCHEMAS_PATH).replace(
            "--changeset db-migration-pack:schemas",
            "--changeset db-migration-pack:sche--mas",
        ),
    )
    assert any("not parser-safe" in p for p in _write(tmp_path, damaged))


@pytest.mark.parametrize(
    "relative_path,expected_fragment",
    [
        # The temporal emulation the pack BUILDS (Spec 5.5).
        (
            "liquibase/changesets/015-emulations.sql",
            'CREATE OR REPLACE FUNCTION "haikai_temporal_versioning"()',
        ),
        # A filtered index becomes a PARTIAL index with its INCLUDE columns.
        (
            "liquibase/changesets/030-indexes.sql",
            'INCLUDE ("PostingID") WHERE IsVoided = 0;',
        ),
        # The SQL Server extract form (Spec 5.6).
        (
            "data/bulk/004-Ledger.Postings.sql",
            "CONVERT(varchar(27), PostedOn, 121) AS PostedOn",
        ),
        # The reconciliation SOURCE section is sqlcmd + GO.
        ("reconcile/reconciliation.sql", "sqlcmd -h -1 -W -s,"),
    ],
)
def test_the_vendored_pack_really_is_the_sql_server_shaped_one(
    relative_path: str, expected_fragment: str
):
    text = (FIXTURE_ROOT / relative_path).read_text(encoding="utf-8")
    assert expected_fragment in text
