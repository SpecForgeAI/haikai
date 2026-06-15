"""Value object for the (company, project) pair.

Across the codebase, `(company: str, project: str)` travels as an
unnamed pair through 30+ method signatures: routes accept it as
two query params, services pass it through, executors store both
fields on `self`. Every site that builds a path from the pair also
needs `safe_segment(company, "company")` + `safe_segment(project,
"project")` ABOVE the join. The repetition is mechanical and
silent: any new site that forgets either validation is a
path-traversal regression.

`ProjectRef` is the value object for this pair. The current
intentional scope is the WORST manifestation — the
`safe_segment(company) ... safe_segment(project) ... / company / project`
clump — not the 30+ signatures themselves. Migrating those is a
larger refactor deliberately deferred to follow-up PRs (pass-3
deep-src-smells finding C-B3 + D-B2 + pass-2 B4').

Future endpoints SHOULD accept `ProjectRef` directly when added;
existing endpoints will be migrated piecemeal.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .path_safety import safe_segment


@dataclass(frozen=True)
class ProjectRef:
    """A validated `(company, project)` pair.

    Construct via `ProjectRef.from_strings(...)` to apply
    `safe_segment` validation in one place. Direct instantiation
    (`ProjectRef(company, project)`) skips validation and is
    intended only for code paths that have already validated their
    inputs.

    Frozen + hashable so a `ProjectRef` can key a dict (e.g. a
    per-project cache).
    """

    company: str
    project: str

    @classmethod
    def from_strings(cls, company: str, project: str) -> "ProjectRef":
        """Validate `company` and `project` via `safe_segment`, then
        return a `ProjectRef`. Raises `ValueError` on unsafe input.

        This is the single replacement for the recurring
        `safe_segment(company, "company")` +
        `safe_segment(project, "project")` pair found at every
        path-join site (the C-B3/D-B2 data clump).
        """
        return cls(
            safe_segment(company, "company"),
            safe_segment(project, "project"),
        )

    def as_dir(self, base: Path) -> Path:
        """Return `base / company / project` — the canonical project
        directory layout used by the workspace.
        """
        return base / self.company / self.project
