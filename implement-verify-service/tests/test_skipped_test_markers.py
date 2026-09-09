"""Skipped != passed (2026-09-09).

A Surefire run whose Testcontainers classes are 100% skipped exits 0 and
prints BUILD SUCCESS; both exit-code gates read it as green. The reader
judges per class from the report XML, a wholly-skipped class fails the step
unless a reasoned BLOCKED task names it, and the failure is never classified
transient (a skipped-test failure must not retry).
"""

from __future__ import annotations

from pathlib import Path

from src.chat.transient_failure import FAILURE_CLASS_REAL, classify_step_failure
from src.verification import surefire


def _report(dir_: Path, name: str, *, tests: int, skipped: int = 0, failures: int = 0, errors: int = 0) -> Path:
    dir_.mkdir(parents=True, exist_ok=True)
    f = dir_ / f"TEST-{name}.xml"
    f.write_text(
        f'<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<testsuite name="{name}" tests="{tests}" skipped="{skipped}" failures="{failures}" errors="{errors}" time="0.1">\n'
        + "".join(f'  <testcase name="t{i}" classname="{name}"/>\n' for i in range(tests))
        + "</testsuite>\n",
        encoding="utf-8",
    )
    return f


def test_no_reports_means_nothing_to_judge(tmp_path):
    assert surefire.summarize_repo(tmp_path) is None


def test_fully_skipped_class_is_a_hole_partial_skip_is_noise(tmp_path):
    reports = tmp_path / "target" / "surefire-reports"
    _report(reports, "com.app.DbIT", tests=5, skipped=5)          # Testcontainers shape: all skipped
    _report(reports, "com.app.PlainTest", tests=7, skipped=1)     # 1-of-7 partial skip
    _report(reports, "com.app.EmptyTest", tests=0, skipped=0)     # no tests at all: not a hole
    s = surefire.summarize_repo(tmp_path)
    assert s is not None
    assert (s.total, s.skipped, s.report_files) == (12, 6, 3)
    assert s.fully_skipped_classes == ["com.app.DbIT"]


def test_judged_per_class_not_on_totals_nested_classes_get_their_own_files(tmp_path):
    # Console aggregate would say 8 tests / 4 skipped and look "half fine";
    # per-class, the nested class is wholly skipped.
    reports = tmp_path / "svc" / "target" / "surefire-reports"
    _report(reports, "com.app.OuterTest", tests=4, skipped=0)
    _report(reports, "com.app.OuterTest$NestedIT", tests=4, skipped=4)
    s = surefire.summarize_repo(tmp_path)
    assert s.fully_skipped_classes == ["com.app.OuterTest$NestedIT"]


def test_failsafe_reports_are_read_too_and_parse_errors_are_skipped(tmp_path):
    reports = tmp_path / "target" / "failsafe-reports"
    _report(reports, "com.app.ApiIT", tests=3, skipped=3)
    (reports / "TEST-broken.xml").write_text("<testsuite", encoding="utf-8")
    s = surefire.summarize_repo(tmp_path)
    assert s.fully_skipped_classes == ["com.app.ApiIT"]
    assert s.report_files == 1


def test_declared_blocked_class_is_accepted_undeclared_is_not():
    s = surefire.SurefireSummary(total=10, skipped=10, fully_skipped_classes=[
        "com.app.DbIT", "com.app.OuterTest$NestedIT", "com.app.CacheIT",
    ])
    notes = [
        "8.7 Run DbIT — BLOCKED: DbIT needs a Docker daemon, absent on this host",
        "8.8 Nested integration — BLOCKED for `mvn verify`: NestedIT requires Testcontainers",
    ]
    assert surefire.undeclared_fully_skipped_classes(s, notes) == ["com.app.CacheIT"]
    assert surefire.undeclared_fully_skipped_classes(s, []) == [
        "com.app.CacheIT", "com.app.DbIT", "com.app.OuterTest$NestedIT",
    ]


def test_skipped_test_failure_is_never_classified_transient():
    msg = (
        "Step 3 (/implement-tasks) reports a green build, but 1 test class(es) were WHOLLY "
        "SKIPPED and contributed no verification: com.app.DbIT. Surefire: 12 tests, 6 skipped "
        "across 3 report(s). Skipped is not passed."
    )
    assert classify_step_failure([msg], "") == FAILURE_CLASS_REAL
