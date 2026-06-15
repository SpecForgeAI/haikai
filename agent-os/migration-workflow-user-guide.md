# Migration Workflow — User Guide

This guide walks a user driving an end-to-end migration through Haikai, from a
Current State system (e.g. a UAT environment) to a new Target State system.
Each step lists the exact UI labels to click, what to expect on screen, and
how to know you're ready to move on.

The **API Test Harness & Reconciliation** loop (which calls both the Current
and Target APIs in parallel and emits drift findings) runs alongside Steps
2–8 rather than after them. It is documented in a cross-cutting section at
the end of the guide and you'll be pointed to it from the steps that interact
with it.

---

## Step 0 — Set up your project and architecture

**Goal:** Stand up the project + architecture container that everything else hangs off of.

### Click path — first time using Haikai

1. Open Haikai. You land on the **Landing Page** at `/`.
2. Click **"Create Organisation"** (keyboard shortcut: Ctrl/Cmd + Shift + M).
3. In the modal, type an organisation name → click **"Create"**.
4. A project is auto-created under the new organisation and the app navigates
   to `/projects/:projectId/architectures/:architectureId/dashboard`.

### Click path — opening an existing project

1. From the Landing Page, *or* from the TopBar **"Product"** dropdown, click **"Open"**.
2. **ModelFileDialog** opens with a tree of organisation folders. Expand an
   organisation → expand a project → click an architecture row.
3. Click **"Open"** at the bottom of the dialog.
4. The project activates and you are navigated to its Dashboard.

### What you'll see after Step 0

The TopBar now shows (left → right):

- **"Product"** dropdown (project-level menu: Create / Open / Save / Save As / Generate Standards / Delete / Close / Import & Export)
- Project name
- Architecture pill chip (the active architecture for this project)
- **"Dashboard"** | **"Product & Delivery"** | **"Architecture & Design"** | **"Diagrams"** navigation buttons

### Switching architectures

Click the **Architecture pill** in the TopBar → **ArchitectureSelector**
dropdown opens listing every architecture in this project → click one. The
URL updates to `/projects/:p/architectures/:newArchitectureId/...` and the
loaded model swaps.

### Done when

- The TopBar shows your project name + active architecture pill.
- The Dashboard view renders without an empty-state prompt.

### Next step

Step 1 — seed the Current State Architecture skeleton.

---

## Step 1 — Seed the Current State Architecture skeleton

**Goal:** Sketch what you already know about the Current State system.
You'll add Applications, Services, and Databases manually. Discovery (Step 2)
will fill in the rest.

### Click path

1. In the TopBar, click **"Architecture & Design"**. You land at
   `/projects/:p/architectures/:a/metamodel/application` with the **"Current
   State"** sub-tab active by default.
2. Below the sub-tabs, the **domain strip** shows six buttons:
   **"Business"** | **"Application"** | **"Data"** | **"Behavioural"** |
   **"UI"** | **"Infrastructure"**.
3. **"Application"** is selected by default. Below the domain strip you'll
   see the entity-type tabs for that domain:
   **"Applications"** | **"Services"** | **"Libraries"** | **"Databases"** |
   **"Relationships"** | **"Package Sets"**.

### Step 1a — Add Applications

1. Click the **"Applications"** tab.
2. Click **"+ Add Row"** at the bottom of the table.
3. A blank row appears. Click the **Name** cell → type the application name
   → Tab (or click outside) to commit.
4. Fill any other known columns inline (description, owner, etc.).
5. Repeat **"+ Add Row"** for every application you want represented.

### Step 1b — Add Services

1. Click the **"Services"** tab.
2. Click **"+ Add Row"**. Click the **Name** cell, fill it.
3. For dropdown cells (e.g. `package_set` shown as `package_set_dropdown`):
   click the cell → pick an existing value, or pick **"Create new..."** which
   opens **CreatePackageSetModal**.
4. Link each Service to its parent Application via the relationship column.

### Step 1c — Add Databases (Data domain)

1. Click **"Data"** in the domain strip.
2. Click the **"Databases"** tab.
3. Click **"+ Add Row"**. Fill the **Name** cell, **Vendor** (e.g. `Sybase`),
   and the connection-metadata columns. *These connection details are what
   the database Discovery pack (Step 3) will use.*

### What you'll see

A grid table with editable rows. Behaviours:

- **Click a cell** → inline-edit (Tab / click outside to commit).
- **Right-click a row** → opens the **GridRowContextMenu**. You'll use this
  in Step 2 to start a Discovery run.

### Done when

Every application, service, and database you already know about appears as a
row in the grid — even if many columns are still blank.

### Tip

Be lossy, not exhaustive. Discovery in Steps 2–3 will add more rows and fill
columns. The bar to clear here is **"enough services that I can right-click
one to run a Discovery scan"** — typically a handful of the most important
services.

### Next step

Step 2 — run Discovery with the code packs.

---

## Step 2 — Run Discovery (Language / Framework / Dependency packs)

**Goal:** Use Haikai's code packs to scan the Current State codebase + live
application logs and discover services, libraries, dependencies, and
tech-hints. Promoted findings populate the architecture grid.

### Click path

1. Stay on **"Architecture & Design"** → **"Current State"** sub-tab →
   **"Application"** domain → **"Services"** tab.
2. Right-click the row of a service you want to scan. The
   **GridRowContextMenu** opens.
3. Click **"Start Discovery Run"** → the **PreflightModal** opens.

> **Shortcut:** **"Start Discovery Run (No Libraries)"** skips the
> library-expansion preflight and opens the lighter **StartDiscoveryRunModal**
> directly — the same modal used for database scans (Step 3).

### Step 2a — Preview the scan plan, then run

The default **"Start Discovery Run"** opens the **PreflightModal**:

- Review the BFS **scan plan / scope** (which artifacts will be scanned).
- Toggle whether **external libraries** are included in the expansion.
- Optionally attach the **live application log file(s)** for the service right
  here (*this is where the **Live App Logs** arrow on the workflow diagram
  enters Haikai*). When at least one log is attached, a **"Max proxy prefix
  segments"** control appears for log-path normalisation.
- Click **"Run"** to start the scan (or **"Cancel"** to back out). The run is
  created and you're navigated to
  `/projects/:p/architectures/:a/discovery/runs/:runId`.

### Step 2b — Review candidates on the run-detail page

At `/projects/:p/architectures/:a/discovery/runs/:runId`:

- The **header** shows run status, method, and counts (services discovered,
  libraries discovered, etc.).
- The **left panel** lists prior runs — click any row to switch context.
- The **centre panel** is the **candidate table**: each row is a discovered
  entity or attribute that Discovery is proposing.
- If the run finished with reduced integrity (e.g. a scanner soft-failed), an
  advisory **"degraded"** banner appears above the tab strip — the results are
  still usable but may be incomplete; check the **Findings** tab for the gap.

### Step 2c — Review and approve candidates

There are two review surfaces; use whichever suits the volume:

**Option 1 — the Architecture Room (recommended for full runs).** Click
**"Architecture Room"** above the tab strip. A conversational review opens:
pick which scan(s) to review (one per service), then click **"Begin
review"**. The Architect walks the discovered model in architectural order —
**Interfaces & endpoints → Logical data model → Physical data model →
Cross-scan logical↔physical mappings → Business logic → Findings** — one
chunk at a time. Every chunk has bulk controls:

- **Family chunks** (e.g. an interface with its endpoints): **Approve All**
  (full cascade) / **Approve visible chunk** / **Reject All** / **Defer All**.
- **By-type chunks** (e.g. hundreds of `business_logics` methods):
  **Approve all N** / **Reject all** / **Defer all** for the whole type.
- **Findings chunks**: **Approve all N findings** per scan.
- Conflicting attribute values show inline **"Use <source>"** pick-a-source
  controls (and "use for all N" when a pattern repeats).

Every click applies immediately and auto-advances. When the agenda is
exhausted, a terminal **"Save all approved candidates?"** Yes/No commits the
approved set to the architecture model.

**Option 2 — the Candidates grid.** Work the **Candidates** tab directly:
**Approve / Reject / Defer** per row (filter by type, tier, confidence),
resolve conflicts from the row badge, then click **"Save All Approved"** and
confirm. Committed rows turn read-only.

### What you'll see in the grid after saving

- New Service / Library / Relationship rows in the Architecture & Design grids.
- **TechHints** cells populated with hints discovered from the scan. Click a
  TechHints cell to view (and resolve) the hints attached to a row.

### Done when

- The Services and Libraries tabs are populated.
- Every candidate row in the run has been reviewed (approved, rejected, or
  deferred) and approved candidates have been saved back.
- TechHints cells reflect what Discovery found.

### Tip

You can also reach the run from **Dashboard → "Discovery Summary" card →
"Open"**, which takes you to the run list at
`/projects/:p/architectures/:a/discovery`. Click any row to
drill into its detail page.

### Next step

Step 3 — run Discovery with the **database pack** (Sybase sidecar) to enrich
the Data domain.

---

## Step 3 — Run Discovery (Database pack — Sybase / PostgreSQL)

**Goal:** Use Haikai's database Discovery pack to introspect the Current State
database, promoting tables, columns, and relationships into the Data domain.

### Click path

1. **"Architecture & Design"** → **"Current State"** → **"Application"**
   domain → **"Services"** tab → right-click a service row → **"Start Discovery
   Run (No Libraries)"**. This opens the **StartDiscoveryRunModal** — database
   scans have no library expansion, so they go through this modal rather than
   the preflight.
2. At the top of the modal, find the **"Discovery source"** radio group
   showing **"Code"** and **"Database"**. **"Code"** is selected by default.

### Step 3a — Switch the source to Database

- Click **"Database"** in the source toggle.
- The log-upload form is replaced by the database connection form.

### Step 3b — Fill the connection form

- **"DB engine"** dropdown: pick **"PostgreSQL"** or **"Sybase ASE"**.
- (If Sybase) **"Sybase driver"** dropdown: **"Auto (try jTDS, then
  jConnect)"** | **"jTDS"** | **"jConnect (jconn4)"**.
  - The "Auto" default is fine for most cases. jConnect requires
    `sybase-discovery-sidecar/lib/jconn4.jar` to be present on the sidecar.
- **"Host"** and **"Port"** — the database server's address.
- **"Database name"** — the catalog to scan.
- **"Include schemas (CSV)"** / **"Exclude schemas (CSV)"** / **"Exclude
  tables (CSV)"** — comma-separated scope filters (e.g. `public, sales`). Leave
  include blank to scan all.
- **"Profiling mode"** — `none` | `basic` | `standard` | `deep`. Higher modes
  sample row data (distinct / null counts, etc.); `deep` asks for an extra
  confirmation because it reads more data.
- Credentials.
- **"Test connection"** — validate the credentials before starting; on success
  it reports the server version and which driver connected.

### Step 3c — Start and review candidates

- Click **"Start"**. The run is created and you're navigated to
  `/projects/:p/architectures/:a/discovery/runs/:runId`. The run kind badge
  shows it's a database scan.
- On the run-detail **"Candidates"** tab, review proposed tables, columns,
  and relationships.

### Step 3d — Review and save into the Data domain

- Review the database candidates exactly as in Step 2c — either through the
  **Architecture Room** (the database scan appears as its own picker group;
  tables and their columns review as families in the **Physical data model**
  section, followed by the **cross-scan logical↔physical mappings**) or via
  per-row **Approve** + **"Save All Approved"** in the grid.
- Back in **"Architecture & Design"** → **"Current State"** → **"Data"**
  domain, the discovered schema rows now appear in the Databases / Tables /
  Columns / Relationships tabs.

### What the database pack captures — Sybase now matches PostgreSQL

Discovery's database pack is the source of truth for the *database* schema
migration, so it captures more than table / column / relationship shape. As of
the latest release the **Sybase** pack reaches full parity with PostgreSQL,
surfacing the deeper schema-migration metadata — carried as detail on the
promoted Data-domain rows and raised as Findings (Step 4):

- **Column collation / case-sensitivity** and the database sort order.
- **Computed columns** — the column's defining expression.
- **Sequence & IDENTITY current values** — the high-water mark, needed to seed
  the target's sequences / identity columns so they don't collide at cut-over.
- **Foreign-key referential actions** — `ON DELETE` / `ON UPDATE`.
- **Index ordering & clustering** — clustered vs non-clustered, and key-column
  direction.
- **DB-resident scheduled jobs** — Sybase Job Scheduler entries.

There's nothing extra to configure — this is captured automatically on any
Sybase or PostgreSQL scan using the same connection form above.

### Done when

- The Data domain tabs are populated with the discovered schema.
- Every database-scan candidate has been reviewed (promoted or skipped).

### Next step

Step 4 — review the **Findings** sibling of the Candidates tab.

---

## Step 4 — Review Discovery Findings

**Goal:** Review the first-class **Findings** Discovery raises alongside
Candidates. Findings are observations, risks, and questions the scan
surfaces — distinct from the entities you've already promoted in Steps 2–3.
This is the first-class **"Discovery Findings"** box on the workflow diagram.

### Click path

1. From any discovery run-detail page at
   `/projects/:p/architectures/:a/discovery/runs/:runId`, click the
   **"Findings"** tab (it sits alongside the **"Candidates"** tab in the
   tab strip).
2. The Findings panel renders:
   - A **summary counts strip**: total / critical+high / needs_review /
     accepted / ignored / resolved.
   - A **filter strip**: status / severity / category / finding_type /
     source / text search.
   - A **flat table** grouped by severity-then-category header rows.

### Step 4a — Filter to what matters

- Typical first pass: set **severity** to `critical, high` and **status** to
  `needs_review`. That isolates the items requiring decisions.

### Step 4b — Open a finding

- Click any row. The **FindingDetailDrawer** slides in from the right
  showing:
  - Description and metadata.
  - A linked-items panel grouped by `target_type` (which entities the
    finding touches).
  - A notes textarea.
  - The reviewer action row.

### Step 4c — Decide and act

In the drawer action row:

- **"Accept"** — the finding is real and recorded as such.
- **"Ignore"** — dismiss with notes.
- **"Mark Needs Review"** — defer to another reviewer.
- **"Mark Resolved"** — already addressed.
- **"Save Notes"** — save reviewer notes without changing the status.
- **"Create work item"** — *(UI placeholder; backend deferred — the button
  is disabled with a "Backend deferred" tooltip.)*

Type your notes in the textarea **before** clicking an action — the notes
are submitted with the review.

### Step 4d — Bulk review findings

When a run raises many findings, you don't have to open them one at a time. A
**bulk toolbar** sits above the findings table:

- **Scope toggle** — **"All (N)"** acts on every finding in the run;
  **"Filtered (N)"** acts only on the rows matching your current filters
  (disabled until you apply a filter). Each shows a live count.
- **Action buttons** — **"Accept"**, **"Ignore"**, **"Needs Review"**,
  **"Mark Resolved"** — each showing how many findings the action will affect.

Click an action → a confirmation modal opens (for *every* bulk action):

- It shows the **scope** (and, when Filtered, the active filter text) plus an
  approximate count of rows that will be **skipped** (already in the target
  status).
- An optional **reviewer-notes** field applies the *same* note to every
  affected finding.
- Confirm to apply. A banner reports how many were updated vs skipped, and the
  summary-count pills update in place.

### Database-metadata findings (Sybase / PostgreSQL)

Database scans (Step 3) raise an **evidence-gap finding** (identified as
`db_schema_metadata_gap`) when a piece of schema-migration metadata the engine
*supports* could not be read — a genuine gap to chase before you rely on the
discovered schema.

A feature the engine **structurally lacks** is deliberately *not* flagged.
Sybase ASE, for instance, has no partial-index predicates and (before ASE 16)
no native sequence objects; those are recorded as "not applicable for this
engine", not as a missing value. So read a `db_schema_metadata_gap` as
"something that should be here couldn't be read", never as "this engine doesn't
have it".

> **Tip:** findings are also walked at the end of the **Architecture Room**
> review (Step 2c), grouped severity-then-category like this table, with an
> **"Approve all N findings"** bulk per scan — often the fastest way through a
> large run's findings.

### Done when

- The `needs_review` count for critical + high severities is zero.
  (Unreviewed critical/high findings also show up later as the
  `high_severity_unreviewed_findings` readiness gap in the Migration Delivery
  Plan wizard — clearing them here clears that gap.)
- Findings that revealed new Current State facts have been turned into
  promoted Candidates (loop back through Step 2/3 if needed).
- Findings that imply Target State changes are noted — they feed into Step 5.

### Next step

Step 5 — define the Target State Architecture.

---

## Step 5 — Define the Target State Architecture

**Goal:** With the Current State enriched, define where you're migrating
*to*. Target State lives as one or more draft architectures (kind=`target`)
alongside the current.

### Click path

1. Stay in **"Architecture & Design"**. At the top, click the **"Target
   State"** sub-tab. URL becomes
   `/projects/:p/architectures/:a/architecture-design/target-state`.
2. **First time, no drafts yet:** the page shows a centred empty-state card
   with a **"Suggest"** button.

### Step 5a — Suggest a starting target

- Click **"Suggest"**. Haikai calls `suggestTargetFromCurrent`, creating a
  new draft architecture by cloning the current architecture's elements.
  (Alternatively, **"New draft"** opens a **SeedTargetArchitectureDialog** to
  start by cloning the current architecture or from a blank slate.)
- The page re-renders into a three-panel layout:
  - **Left**: Drafts list (kind=`target` rows, active-first; supports inline
    rename and delete).
  - **Centre**: Read-only table grouped by element type (**Components** /
    **APIs** / **Data entities** / **Infrastructure**).
  - **Right**: Unmapped-elements warning panel.

### Step 5b — Refine the draft

- Rename the draft in the left panel by clicking its name (inline rename).
- Re-run **"Suggest"** to refresh, or edit the underlying domain grids in
  the **"Current State"** sub-tab and re-suggest to pick changes up.

### Step 5c — Handle unmapped elements

The right panel lists current-state elements that have **no mapping** to a
target element. Per row:

- **"Mark decommissioned"** — atomic write that flags the current element
  as decommissioned in the target.
- Or go back to the centre panel and add a target-state element that maps
  to the current element.

### Step 5d — Compare and promote

- Switch the centre panel to the **"Compare with current"** tab for a
  side-by-side current-vs-target review. (A third **"Architect Conversation"**
  tab runs an LLM-assisted refinement chat over the draft.)
- When the draft is ready, click **"Promote"** on the draft row.
  - A confirm modal runs a **dry-run first** and reports the impact — e.g. how
    many downstream **specs it will mark stale**.
  - On confirm, the draft is committed as the active target architecture.

### Done when

- Every current-state element is either mapped to a target element or
  marked decommissioned.
- A target draft has been promoted to active.

### Next step

Step 6 — turn the current → target delta into a roadmap.

---

## Step 6 — Build the Roadmap

**Goal:** Sequence the current → target delta into time-ordered increments
of work.

### Click path

1. TopBar → **"Product & Delivery"**. You land at `/product/backlog` by
   default.
2. Click the **"Roadmap"** tab (the Product & Delivery tabs are **"Product"** |
   **"Roadmap"** | **"Backlog"** | **"Implement"**). URL becomes
   `/product/roadmap`.

There are three ways to build the roadmap/backlog. **Step 6a is the recommended
"oracle" path** — it auto-drafts the whole backlog from everything you captured
in Steps 1–5. 6b and 6c are manual fallbacks.

### Step 6a — Auto-build the roadmap from Discovery (recommended)

This is the point of the oracle: the Product Manager takes your **discovery
findings** + the **current-state** and **target-state** architectures + the
Architect's **captured target-state decisions** (Step 5) and drafts the entire
backlog for you.

- In the **Roadmap** page header, click **"Create Migration Delivery Plan"**
  (it sits next to **"Upload Book of Work"**). You land on the Migration
  Delivery Plan page, which lists any existing plan drafts and opens a 7-stage
  wizard.
- Work through the wizard:
  1. **Inputs & context** — pick the **current** and **target** architecture,
     then tick which **discovery runs** and **API behaviour baselines** to feed
     in. (Haikai loads the discovery context for the pair you choose.)
  2. **Migration intent** — what you're optimising for.
  3. **Delivery streams** — which workstreams are in play (pre-ticked from your
     discovery readiness).
  4. **Migration style** — strangler / phased / big-bang / unsure-recommend.
  5. **Data & cutover** — data-migration and cutover / rollback assumptions.
  6. **Test Pack** — the test coverage you expect (pre-ticked from API
     baselines / DB findings / runtime evidence).
  7. **Generate** — review your selections and click **"Generate"**.
Generation is **two-phase** so it stays fast no matter how large the system is:

- **Phase 1 — the skeleton (the Generate click).** Haikai makes one LLM call
  per selected delivery stream (in parallel; concurrency is capped by the
  gateway `MIGRATION_PLAN_LLM_CONCURRENCY` setting, default 4, settable to 1
  for fully serial) and assembles a **high-level skeleton**: **Initiatives →
  Epics → Features** — deliberately *without* detailed stories yet. This
  typically completes in under a minute and routes you to the **review
  workspace** so you can sanity-check the shape of the plan before any tokens
  are spent on detail.
- **Phase 2 — expand epics into detailed stories (in the review workspace).**
  Each epic row carries an expansion badge (`not expanded` / `expanding` /
  `expanded` / `failed`). Click **"Expand epic"** on the epics you want
  detailed, or **"Expand all epics"** for the lot. Expansion reads the real
  endpoint/table inventory from the architecture model and generates the
  epic's stories: bulk homogeneous work (e.g. "implement endpoint X with
  behavioural parity to baseline Y") is **template-stamped in code from real
  model facts** — so coverage of all N endpoints/tables is a code guarantee —
  while unusual items (attached findings, conflicts, missing baselines,
  complex SOAP) get individually LLM-written stories, and an LLM judge pass
  verifies stamped batches before anything lands. A failed epic shows
  **"Retry expansion"** and never affects other epics' stories.
- Every item is tagged with a **confidence** (high / medium / low), a
  **readiness** state (ready-for-spec / needs-focused-context /
  needs-user-decision / blocked), and a **traceability** note back to the
  findings, architecture, and baselines it came from. Stamped stories carry a
  `provenance:stamped` tag so you can tell them from individually-generated
  ones. Inspect the tree, filter by confidence / readiness / workstream, and
  open any item for its detail + traceability.
- Click **Save to Backlog** — **Save All**, **Save Selected**, **Save
  High-confidence**, or **Save Ready-for-spec**. The chosen items become work
  items in your backlog, ready for Step 7. Saving while some selected epics
  are still unexpanded shows a non-blocking warning — you can save the
  expanded epics' stories now and come back for the rest.

> Notes: re-running the wizard creates a **new** draft (earlier drafts stay in
> the list, selectable from the Migration Delivery Plan page — each row shows
> its "X/Y epics expanded" progress). An item that came back **blocked** or
> **needs-user-decision** is telling you a Step 1–5 gap is still open — resolve
> it and regenerate, or save it and refine it individually in Step 7. The
> **Inputs & context** stage shows the Migration Discovery Context readiness
> (sufficient / partial / insufficient) with named gaps —
> `no_api_behaviour_baseline` is the one gap that forces *insufficient* on its
> own, and is cleared by capturing **and activating** a current-state API
> baseline (see the API Test Harness section).

### Also on the Migration Delivery Plan page — Schema migration & Interface contracts

The Migration Delivery Plan page has section tabs next to **Delivery plan**:

- **Schema migration** — the deterministic Sybase→PostgreSQL DB migration
  pack (Liquibase changesets, bulk + incremental data scripts, proc/trigger
  translation drafts, decision queue, drift verification, zip download).
  Attach the pack to your DB epic and hand it to the implementation team.
- **Interface contracts** — deterministic **OpenAPI 3.0 contracts** generated
  straight from the architecture model, one per interface. Pick the
  architecture (normally your **target state**), then **Generate** per
  interface or **Download all contracts (zip)** — the zip contains one
  `<interface>.openapi.json` + `<interface>.gaps.json` per interface plus a
  manifest. Nothing is invented: endpoints become paths, logical entities
  become schemas, and anything the model doesn't specify (server URL,
  response shapes, parameter types) is marked with an explicit gap note. The
  per-interface gap summary tells you exactly what to enrich in the model to
  improve the contract; SOAP endpoints are listed as not expressible in
  OpenAPI rather than silently dropped. Contracts are regenerated on every
  download, so they can never go stale — hand them to the implementation
  service as the API contract for each target service.

### Step 6b — Upload a Book of Work (manual fast path)

- In the page header, click **"Upload Book of Work"** → a file picker opens.
- Select a markdown file describing the work-item hierarchy (Epics →
  Stories → Tasks).
- On upload, Haikai parses the file and populates the roadmap and backlog.

### Step 6c — Or build the roadmap manually

- Adjust the date range and scope controls in the header.
- Drag-and-drop work items into increments.
- Add increments / work items as needed via the in-page controls.
- Work items can be **synced to / linked with Jira** (the **Sync** and **Link
  to Jira** dialogs), and a right-hand **Product Manager chat** panel offers
  LLM-assisted roadmap shaping.

### Done when

- The roadmap shows increments populated with the work items that, taken
  together, deliver the target state defined in Step 5.

### Next step

Step 7 — refine backlog items into specs.

---

## Step 7 — Refine Backlog items into Specs

**Goal:** Take a story off the backlog and turn it into a shaped spec
(plus tasks list) ready for implementation.

### Click path

1. **"Product & Delivery"** → **"Backlog"** tab (`/product/backlog`).
2. The left panel shows the work-item tree (Epics → Stories → Tasks).
3. Click a story row. The right panel renders its detail.

### Step 7a — Choose a refinement mode

The detail panel exposes four action buttons. Each navigates to the
Implement page (`/product/implement/:workItemId`) with a different
`refinementMode`:

- **"Work on this now"** — `standard` mode. Skip refinement; go straight to
  implementation.
- **"Refine"** — `refine` mode. Run the PM + TE per-story refinement loop
  to shape the spec.
- **"Refine and Implement"** — `refine_and_implement` mode. Refinement loop
  followed by implementation in one flow.
- **"Define Integration/E2E"** — `holistic_only` mode. Holistic TE review
  for integration-test definition.

For most new stories, click **"Refine"**.

### Step 7b — Pick context for the spec

On the Implement page:

- Click the **Context picker** → **ContextPickerModal** opens.
- Tick the domains, applications, and services that the spec should
  consider. (This scopes what the generator sees.)
- Confirm to close the modal.

### Step 7c — Generate the implementation plan

- Click **"Generate Implementation Plan"**.
- Haikai calls the shape-spec endpoint and routes you into
  **SpecGenerationWorkspaceRoute** with `workItemId` pre-selected.
- Iterate the spec inside the workspace until it captures the work
  satisfactorily.

### Done when

- The story has a shaped spec + tasks list attached.
- The story is flagged ready for implementation.

### Next step

Step 8 — implement.

---

## Step 8 — Implement (agent-os + Claude Code)

**Goal:** Hand the shaped spec to agent-os, which drives Claude Code to
actually write the code into the Target State codebase.

### Click path

1. From the Backlog detail panel, click **"Refine and Implement"** (or
   **"Work on this now"** if no further refinement is needed). You're navigated
   to `/product/implement/:workItemId`.
2. The Implementation Assistant panel shows:
   - The selected work item header.
   - The implementation plan (specs + tasks from Step 7).
   - The code-generation trigger.

### Step 8a — Review the plan

- Read the implementation plan top-to-bottom.
- Re-pick context (Context picker) if scope needs adjustment.

### Step 8b — Trigger implementation

- Click **"Implement"**.
- **ImplementConfirmationModal** opens listing the actions about to run.
- Confirm. agent-os runs against Claude Code; output streams back into the
  panel.

### Done when

- The agent run completes successfully.
- The resulting commits land in the **Target State codebase** (the `[Code
  Base]` box on the right side of the workflow diagram).

### Next step

Verify the changes via the **API Test Harness & Reconciliation** loop (the
next section).

---

## Cross-cutting — API Test Harness & Reconciliation

This is the loop on the right of the workflow diagram — fire the same
request at both the Current and Target APIs, diff the responses, and emit
reconciliation findings that loop back into Findings (Step 4) and Specs
(Step 7). It runs **alongside** Steps 5–8, not after them: capture a Current
baseline once, then re-capture Target replays each time Step 8 produces new
code.

### Where it lives

- List page: `/projects/:p/architectures/:a/api-behaviour`
- Capture session detail: `/api-behaviour/sessions/:sessionId`
- Baseline detail: `/api-behaviour/baselines/:baselineId`

Today you reach this surface by navigating to the URL directly (a Dashboard
card is planned for a future increment).

### Phase A — Capture the Current State baseline

1. Open `/api-behaviour`. Two sections render below the header: **Capture
   Sessions** and **Baselines**.
2. Start a capture session against the Current API. The session-detail page
   polls every 2-3 seconds while the session status is `running`.
3. **Read the completion line carefully.** A completed session shows
   **"completed · N of M scenarios captured"** next to its status badge. A
   session is marked *completed* whenever there was no infrastructure failure
   — so if every scenario errored (bad auth, unreachable API base URL) it
   still reads completed, but with **"0 of M scenarios captured"** and a
   prominent warning banner. In that case: check the Diagnostics for the
   per-scenario failure reasons, **re-enter secrets** (they are purged at the
   end of every run — the "Re-enter secrets" banner is normal), **Test API
   connection**, and run a new capture.
4. In the **Capture Review Panel**, review the captured rows: **Accept** the
   good ones (reject-with-notes / mask response fields as needed). The
   **"Save as Baseline"** CTA appears once at least one capture is accepted.
5. Click **"Save as Baseline"** → confirm. The session becomes a durable
   baseline (`kind='current'`), created with `status='draft'`.
6. **Activate it.** In the **Saved Baselines** list, click **"Activate"** on
   the new baseline's row (active baselines show **"Archive"** instead). An
   **active** current-state baseline is what the Migration Delivery Plan
   readiness requires — a draft only counts as *partial*, and no baseline at
   all is the one gap (`no_api_behaviour_baseline`) that forces the whole
   context *insufficient*.

### Phase B — Capture a Target State replay

1. With at least one **active current baseline** present, the header button
   **"Capture target API behaviour"** in `/api-behaviour` is enabled. Click
   it.
2. **StartTargetReplayWizard** opens — configure the target API endpoint,
   select operations to replay, run the capture.
3. A new session runs and produces a paired target baseline (`kind='target'`,
   `paired_with_baseline_id` set to the source current baseline). Click
   **"Save as Baseline"** when satisfied.

### Phase C — Read the drift report

Open the target baseline detail page. With pairing in place, the page
exposes:

- A header banner: *"Target-side API capture (paired with: [source baseline
  name])"* — click the link to navigate to the source baseline.
- Two tabs at the top of the body:
  - **"Baseline detail"** — the captured items (request shape, response
    status + shape, business notes).
  - **"Drift report"** — only present when paired.

Click **"Drift report"**. The tab shows:

- Summary counts: **matched** / **status drift** / **body shape drift** /
  **body value drift** / **source-only**.
- Per-operation-and-scenario rows showing request-shape comparison,
  response-shape comparison with diff highlights, status-code comparison,
  and business recommendations.
- A **"Findings"** column links each diff to any reconciliation findings it
  generated; click a badge to open a drawer of the linked findings (this is how
  the Phase D loop-back is surfaced inline).

### Phase D — Loop drift findings back

Each drift entry is a candidate input to upstream loops:

- **Discovery Findings (Step 4)** — for divergences that reveal a missed
  Current State fact.
- **Specs / Backlog (Step 7)** — for divergences that require a Target State
  change.

Re-shape affected specs (Step 7), re-implement (Step 8), and re-capture the
Target replay (Phase B) until the drift report shows only **matched** rows
or differences with recorded business-note rationale.

### Done when

- The target baseline's drift report shows zero unintended differences.
- Every intentional difference is documented in business notes.

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| **Architecture** | A snapshot of the model for a project. A project can hold multiple architectures (current, target, drafts). Switched via the TopBar pill chip. |
| **Domain** | Top-level slice of the meta-model: Business / Application / Data / Behavioural / UI / Infrastructure. |
| **Entity type** | Concrete row-types inside a domain — e.g. the Application domain has Applications / Services / Libraries / Databases / Relationships / Package Sets. |
| **Discovery run** | A single scan invocation. Has a source (Code / Database) and a method, and produces Candidates + Findings. |
| **Candidate** | A row Discovery proposes to add to the architecture. Reviewed (Approve / Reject / Defer) in the **Architecture Room** or the **Candidates** grid, then committed via **"Save All Approved"** (or the Room's terminal Save). |
| **Architecture Room** | The conversational current-state review opened from a discovery run's detail page. Walks the discovered model in architectural order (interfaces → logical data → physical data → cross-scan mappings → business logic → findings) with bulk Approve/Reject/Defer controls on every chunk and inline conflict resolution. |
| **Finding** | A first-class observation Discovery raises (risk, question, divergence). Lives on the **Findings** tab and has its own reviewer workflow (Accept / Ignore / Mark Needs Review / Mark Resolved / Save Notes). |
| **TechHints** | Per-row hints attached to an architecture grid row by Discovery. Clicking the TechHints cell opens the resolve view. |
| **Package Set** | A grouping of code packages owned by a Service. Created via CreatePackageSetModal. |
| **Application Point** | A typed extension point on an Application; set via ApplicationPointPickerCell. |
| **Target draft** | A non-active architecture with `kind='target'` representing a candidate target state. Promoted to become the active target. |
| **Capture session** | A live recording of API calls being captured for a baseline. Status `running` polls every 2-3s; promoted to a baseline when complete. |
| **Baseline** | A durable, named snapshot of API behaviour. `kind='current'` or `kind='target'`. Created `draft`; promote with the **"Activate"** button on the Saved Baselines row (active ⇄ archived transitions likewise). An **active** current baseline is required for migration-plan readiness. Target baselines can be paired to a current baseline (`paired_with_baseline_id`) for drift reporting. |
| **Drift report** | The diff between a target baseline and its paired current baseline. Lives as a tab on the target baseline detail page. |
| **agent-os** | The implementation-orchestration layer. **"Implement"** hands the shaped spec to agent-os, which then drives Claude Code. |

## Appendix B — Keyboard & context-menu reference

### Global

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Shift + M` | Open **Create Organisation** modal from anywhere. |

### Architecture & Design grid

| Gesture | Result |
|---|---|
| Click a cell | Inline edit. Tab or click outside to commit. |
| Click **"+ Add Row"** | Append blank row at the bottom. May open a creation modal for some entity types (e.g. CreateBusinessLogicModal, CreatePackageSetModal). |
| Right-click a row | Open **GridRowContextMenu**. |
| Click a dropdown cell | Open the value picker (e.g. `package_set_dropdown`). |
| Click a TechHints cell | View / resolve the Discovery hints attached to that row. |
| Click an ApplicationPointPickerCell | Open the context picker to select or create an Application Point. |

### GridRowContextMenu items

| Row type | Menu item | Effect |
|---|---|---|
| Service / Library | **"Start Discovery Run"** | Open **PreflightModal** (preview scan plan, toggle libraries, attach logs → **"Run"**). |
| Service / Library | **"Start Discovery Run (No Libraries)"** | Open **StartDiscoveryRunModal** (no library expansion; also the database-scan entry). |
| Interface | **"Add endpoints and entities/attributes"** | Open **AdvancedAddDialog**. |

### Discovery Run Detail tab strip

| Tab | Shows |
|---|---|
| **"Candidates"** | The DiscoveryCandidateTable — rows to Approve / Reject / Defer, then save back into the architecture model. |
| **"Findings"** | First-class findings with summary counts, filter strip, and detail drawer. |

(The **"Architecture Room"** button above the tab strip opens the
conversational review over the same candidates + findings.)

### FindingDetailDrawer action row

| Button | Effect |
|---|---|
| **"Accept"** | Mark finding `accepted`. |
| **"Ignore"** | Mark finding `ignored`. |
| **"Mark Needs Review"** | Move finding back to `needs_review`. |
| **"Mark Resolved"** | Mark finding `resolved`. |
| **"Save Notes"** | Save reviewer notes without changing status. |
| **"Create work item"** | *(UI placeholder — backend deferred; button is disabled.)* |

### TopBar "Product" dropdown

| Menu item | Effect |
|---|---|
| **"Create"** | Open **CreateProjectModal**. |
| **"Open"** | Open **ModelFileDialog** to pick an organisation / project / architecture. |
| **"Generate Standards"** | Open **GenerateProjectStandardsModal**. |
| **"Save"** | Save current project to backend. |
| **"Save As"** | Open **ModelFileDialog** in save-with-new-name mode. |
| **"Delete"** | Open **DeleteProjectModal**. |
| **"Close"** | Deactivate the project and return to the Landing Page. |
| **"Import as JSON"** / **"Export as JSON"** | File-mode project snapshot exchange. |
| **"Import as XLSX"** / **"Export as XLSX"** | Excel project snapshot exchange. |
| **"Import Infrastructure from Terraform"** / **"Export Infrastructure as Terraform"** | Terraform infrastructure exchange. |
