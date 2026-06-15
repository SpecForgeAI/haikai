# Polyrepo (Multi-Repo Product Support)

This document is the user-facing reference for the multi-repo orchestration
landed in `spec/multi-repo-product-orchestration`. For design rationale and
the full task breakdown, see:

- `haikai/specs/2026-05-25-polyrepo-analysis/spec.md` (design)
- `haikai/specs/2026-05-25-polyrepo-analysis/planning/requirements.md`
  (functional + non-functional requirements)
- `haikai/specs/2026-05-25-polyrepo-analysis/tasks.md` (implementation
  phases, status, and gates)
- `haikai/specs/2026-05-25-polyrepo-analysis/flow-diagram/` (interactive
  React Flow walkthrough of the 5 CRUD scenarios)

---

## TL;DR

A **product** is a set of one or more **repositories** that ship together.
The system represents this with a flat key-value map:

```yaml
# workspace/{company}/{project}/coordination.yaml
backend: git@github.com:acme/backend.git
frontend: git@github.com:acme/frontend.git
shared: git@github.com:acme/shared.git
```

- One entry = a **monorepo** project. N entries = a **polyrepo** project.
- The system never reads a "mode" field. Mono vs poly is inferred from the
  map's length. The UI can derive a `Monorepo` / `Polyrepo` badge from
  `len(coordination.yaml)`.

---

## On-disk layout

```
workspace/
  {company}/
    {project}/                  ← product workspace root
      coordination.yaml         ← the persisted KV map
      {folder-1}/               ← cloned repo 1
      {folder-2}/               ← cloned repo 2
      {folder-N}/               ← cloned repo N
```

For a mono project, the product workspace root contains exactly one
sub-directory. The layout is identical to a poly project — there is simply
one entry instead of N. This consistency is what makes mono ↔ poly
migration a single CRUD call (see "Migrating mono to poly" below).

---

## Initialising a product

```http
POST /projects/init
Content-Type: application/json
Authorization: Bearer ...

{
  "company": "acme",
  "project": "petclinic",
  "repos": {
    "backend": "git@github.com:acme/backend.git",
    "frontend": "git@github.com:acme/frontend.git"
  }
}
```

Response (200):

```json
{
  "success": true,
  "message": "Project initialized (polyrepo, 2 repo(s))",
  "project_dir": "/var/workspace/acme/petclinic",
  "mode": "polyrepo",
  "repos": [
    { "folder": "backend",  "dir": "/var/workspace/acme/petclinic/backend",  "mode": "brownfield" },
    { "folder": "frontend", "dir": "/var/workspace/acme/petclinic/frontend", "mode": "brownfield" }
  ]
}
```

### Constraints validated at init

- Folder name (alias) regex: `^[a-z][a-z0-9_-]*$`.
- Folder names are unique within the map (free from dict semantics).
- Repo URLs are unique within the map.
- The map must have ≥1 entry.
- Each URL must clone successfully. **If any clone fails, the entire
  workspace is rolled back** — no partial state on disk.

### Legacy single-repo shape (backward compat)

The pre-polyrepo body still works:

```json
{ "company": "acme", "project": "petclinic", "repo_url": "git@github.com:acme/petclinic.git" }
```

It is promoted internally to `{ "petclinic": "git@github.com:acme/petclinic.git" }` —
folder alias defaults to the project name. New callers should prefer the
explicit `repos` field.

---

## CRUD on the repo map

After init, the map is mutable via four endpoints under
`/projects/{company}/{project}/repos`:

| Method | Path                | Body                          | Effect                                       |
|--------|---------------------|-------------------------------|----------------------------------------------|
| GET    | `/repos`            | —                             | Returns the current map.                     |
| POST   | `/repos`            | `{folder, url}`               | Clones into a new sub-directory, updates the YAML. Rejects dup folder / dup URL / invalid folder regex. |
| PUT    | `/repos/{folder}`   | `{url}`                       | **Tears down** the existing sub-directory and re-clones from the new URL. Folder alias is *not* renamable. Rejects dup URL. |
| DELETE | `/repos/{folder}`   | —                             | Removes the sub-directory and updates the YAML. Rejects when it would leave the map empty (a product must always have ≥1 repo). |

All four return the full post-mutation map. All mutations write
`coordination.yaml` atomically (temp file + `fsync` + `rename`).

---

## How the pipeline sees a polyrepo

The Claude (or Kiro) chat session is mounted at the *product workspace
root* with one `--add-dir` flag per repo sub-directory. For mono that's
one flag; for poly it's N. The orchestrator code itself does not branch
on entry count — it just builds the list.

The list is snapshotted at session-build time, so CRUD mutations during
a run apply to the *next* run, not the current one (FR-10).

### Per-repo behaviour summary

| Pipeline step      | Mono                                   | Poly                                                                            |
|--------------------|----------------------------------------|---------------------------------------------------------------------------------|
| `shape-spec`       | Searches the single repo sub-dir.      | Searches across all repo sub-dirs.                                              |
| `write-spec`       | Existing-code refs are one repo's.     | Refs grouped by repo alias; a nearest-neighbour step attributes each change to a repo. *(Phase 5 — see open decisions OD-1/OD-2.)* |
| `create-tasks`     | Tasks need no `[@repo:]` annotation.   | Each task group carries `[@repo:<alias>]`. Cross-repo deps declared. *(Phase 6 — see OD-3.)* |
| `implement-tasks`  | One `apply_git_workflow` call → 1 PR.  | One `apply_git_workflow` call per touched repo → N PRs. Helper itself unchanged. *(Phase 7.)* |

---

## Failure semantics

- **Init**: all-or-nothing. Partial workspaces are wiped.
- **CRUD**: per-mutation atomic — the operation either succeeds entirely
  (filesystem + YAML aligned) or fails leaving prior state intact.
- **Implement fan-out**: if any per-repo commit/push/PR fails, the run is
  marked failed. Successful PRs from the same run are flagged for manual
  close — they are not auto-closed (cross-cutting feature changes are
  incoherent partial-delivered).

---

## Migrating an existing single-repo project

A legacy project initialised before this spec has no `coordination.yaml`
and its repo sits *at* the product root (not inside a sub-directory).
There is no auto-migration in v1 — the spec deliberately defers automatic
filesystem relocation to a follow-up.

**Recommended manual path** for a legacy project at
`workspace/acme/petclinic/`:

1. Move the repo into a sub-directory:
   ```bash
   cd workspace/acme/petclinic
   mkdir _tmp_alias
   shopt -s dotglob
   mv -- !(_tmp_alias) _tmp_alias/    # or: rsync -a + rm -rf
   mv _tmp_alias app
   ```
2. Write a one-entry `coordination.yaml`:
   ```yaml
   # workspace/acme/petclinic/coordination.yaml
   app: <whatever .haikai/config.json had as repo_url>
   ```
3. Add new repos via `POST /repos`. The existing `app/` sub-directory is
   not touched.

A follow-up spec will automate this once the new-project flow has burned
in. For now, treat it as a one-time per-project operation.

---

## Convention: no mode-branching

The codebase has a CI test (`tests/test_polyrepo_no_mode_branches.py`)
that scans `src/` for forbidden patterns:

- `if len(repos) == 1`
- `if is_monorepo` / `if is_polyrepo`
- `if mode == "mono"` / `if mode == "poly"`

If you must introduce one (e.g. for backward-compat response shape), add
an explicit exemption to the `ALLOWED_OCCURRENCES` list at the top of the
test and document the rationale inline at the call-site.

---

## Open decisions

Three implementation-detail decisions are not yet taken and block the
write-spec / create-tasks / implement-tasks pipeline changes (Phases
5–7 of the spec). See:

`haikai/specs/2026-05-25-polyrepo-analysis/planning/open-decisions.md`

- OD-1: where `paths_touched` is persisted
- OD-2: NN attribution granularity
- OD-3: cross-repo dependency declaration syntax

The data layer + CRUD + orchestrator session-mount changes (Phases 1–4 +
8) are landed and shippable independently.
