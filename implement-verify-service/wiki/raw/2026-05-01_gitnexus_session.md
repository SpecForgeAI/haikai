# Raw: GitNexus install + comparison session
**Date:** 2026-05-01
**Source type:** Live session transcript notes (Claude Code)
**Repo under test:** standards-extractor (V2 pipeline) vs GitNexus (`/d/temp/gitnexus`)

This is an immutable raw-notes file. Do not edit; supersede via a new dated raw file if findings change.

---

## Install / build experience (GitNexus)

- GitNexus is a TypeScript monorepo (`/d/temp/gitnexus/`) with `gitnexus`, `gitnexus-shared` packages.
- Required three install passes: root, `gitnexus/`, `gitnexus-shared/`.
- Build chain: `npm run build` runs `tsc` on `gitnexus-shared` then `gitnexus`, then a postinstall `scripts/build.js` copies `gitnexus-shared/dist` into `dist/_shared/` and rewrites bare `gitnexus-shared` import specifiers to relative paths.
- **Failure mode:** `gitnexus-shared/node_modules` missing → `npx tsc` hangs trying to fetch typescript on-the-fly. Fix: `npm install` in the `gitnexus-shared/` subpackage explicitly.
- C: drive nearly full (471 MB free) at start of session — moved 42 temp repos from `C:\Temp` to `E:\temp` via PowerShell `Move-Item`; redirected npm cache to `E:/npm-cache`. Freed C: to 2.86 GB.

## CLI surface (GitNexus, from `dist/cli/index.js`)

`setup`, `analyze`, `index`, `serve`, `mcp`, `list`, `status`, `clean`, `remove`, `wiki`, `augment`, `query`, `context`, `impact`, `cypher`, `detect-changes`, `eval-server`, `group`.

## Repo runs

| Repo | Files | Outcome |
|---|---|---|
| `spring-petclinic` | 30 java | indexed, .gitnexus/ ~44 MB |
| `openmrs-core` | 1,273 java | analyzed in 78.9s |
| `kibana` | 6,652 ts | **OOM** at 18.7 GB RAM after 75+ min, 0 bytes flushed, no `.gitnexus/` dir created |

## Key extraction findings (openmrs-core)

- **0 Route nodes** in the LadybugDB graph.
- **0 standard HTTP framework annotations** persisted (no `@Mapping`, `@Controller`, `@Path`, `@GET`, `@POST`, `@Rest*`).
- **15 Annotation nodes total** — all custom `@interface` declarations: `Verifies`, `StartModule`, `Authorized`, etc.
- V2 (this project) finds 17 endpoints in petclinic and 13 in openmrs via its playbook-driven LLM discovery.

## Capabilities GitNexus exposes that V2 doesn't (yet)

- `query` — hybrid BM25 + vector semantic search. `query "patient management"` on openmrs returned ProgramWorkflowService.getProgramAttributeTypeByUuid + others in 1150ms.
- `cypher` — full graph access via Cypher. Multi-repo state requires `--repo <name>` disambiguator.
- `context Method:<UID>` — incoming/outgoing call neighborhood. Demonstrated on `Order.getPatient#0` (10+ callers, mostly tests).
- `impact <symbol>` — symbol-level blast radius. Ambiguous symbol names need full UID like `Method:src/.../OwnerController.java:OwnerController.showOwner#1`.
- Leiden community detection → 300 `Process` nodes on openmrs (V2 uses Louvain, coarser).
- `wiki` command — generates markdown docs from the persisted graph (not yet run this session).
- `Process` node schema (from `cypher MATCH (p:Process) RETURN p.* LIMIT 1`): `id`, `label`, `heuristicLabel`, `processType`, `stepCount`, `communities`, `entryPointId`, `terminalId`. Sample: `proc_0_discontinueexistingo` — entry `OrderServiceImpl.discontinueExistingOrdersIfNecessary`, terminal `PresentationMessage.getLocale`.

## Architectural diagnosis (Kibana OOM)

GitNexus's pipeline is a 12-phase **in-memory** KnowledgeGraph that flushes to LadybugDB only after all phases complete. Kibana (~6,652 TS files) exceeds practical RAM on commodity machines. V2's streaming-to-disk architecture (ctags subprocess → TSV files → SQLite projection) does not have this scaling cliff.

## Known issues encountered

- `cypher` on multi-indexed state throws "Multiple repositories indexed" without `--repo`.
- Property errors: `RETURN p.summary` → "Cannot find property". Workaround: `RETURN p.*` to discover schema.
- Symbol disambiguation: short names match many candidates; full UID required.

## Outstanding GitNexus features not yet exercised

- `wiki <repo>` — generate markdown
- `detect-changes` against a local edit
- `augment` — unclear what it does
- `eval-server` — likely benchmarking infra
