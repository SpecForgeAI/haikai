title: Fix missing Sequence diagram editor buttons by canonicalizing diagram_type values (FE + BE + DB migration)

intent:
  - Restore Sequence Editor panel rendering (and its "+ New Participant"/"+ New Flow" actions) for all Sequence diagrams.
  - Prevent future regressions by making diagram_type handling case-insensitive in the frontend.
  - Normalize existing persisted diagram_type values in Postgres to canonical strings expected by the UI.

scope:
  - frontend (React/TS): diagram type parsing + sequence hook guard
  - architecture-model-service (Spring Boot): normalize diagramType on save/load (defensive)
  - database (Liquibase): data migration to canonicalize existing diagrams.diagram_type values

non_goals:
  - No changes to typed-content persistence or diagram rendering logic.
  - No changes to diagram creation UX beyond ensuring created/loaded diagrams reliably behave as their type.

acceptance_criteria:
  - Selecting any diagram whose persisted type is any casing of sequence (e.g. "SEQUENCE", "sequence", "Sequence") shows the Sequence Editor panel (not the Palette).
  - Sequence Editor shows "+ Add Participant" and Flow tab as before.
  - Existing diagrams in DB are migrated so diagram_type is one of: "General", "ER", "Sequence", "Activity", "State".
  - New saves from the frontend/back-end never persist non-canonical values.
  - No other diagram types regress (Activity/State/ER still behave correctly).

implementation:

  - id: FE-1-normalize-diagram-type
    component: frontend
    files:
      - src/types/diagramType.ts
    changes:
      - Add a new helper function normalizeDiagramType(value?: string | null): DiagramType | null
        - Trim whitespace
        - Case-insensitive mapping:
          - "general" -> "General"
          - "er" -> "ER"
          - "sequence" -> "Sequence"
          - "activity" -> "Activity"
          - "state" -> "State"
        - Return null if unknown
      - Update isDiagramType() to use normalizeDiagramType(value) !== null (so it becomes tolerant)
      - Update getDiagramType() to:
        - If no diagram or no diagram.diagram_type -> DEFAULT_DIAGRAM_TYPE
        - Else return normalizeDiagramType(diagram.diagram_type) ?? DEFAULT_DIAGRAM_TYPE
    notes:
      - This ensures DiagramsView will treat "SEQUENCE"/"sequence" as Sequence and show SequenceEditorPanel.

  - id: FE-2-sequence-hook-guard
    component: frontend
    files:
      - src/hooks/useSequenceDiagram.ts
    changes:
      - Import getDiagramType from src/types/diagramType
      - Replace the strict guard:
          if (!activeDiagram || activeDiagram.diagram_type !== 'Sequence')
        with:
          if (!activeDiagram || getDiagramType(activeDiagram) !== 'Sequence')
      - Keep existing behavior otherwise (still initializes empty content if typed content is missing).
    acceptance:
      - Even if backend returns "SEQUENCE", the hook loads and the editor works.

  - id: BE-1-normalize-diagram-type-defensive
    component: architecture-model-service
    files:
      - src/main/java/com/example/architecturemodel/mapper/DiagramMapper.java
    changes:
      - Add a private helper in DiagramMapper:
          private String normalizeDiagramType(String raw)
        behavior:
          - null -> null
          - trim; upper-case for compare
          - map:
              "GENERAL" -> "General"
              "ER" -> "ER"
              "SEQUENCE" -> "Sequence"
              "ACTIVITY" -> "Activity"
              "STATE" -> "State"
          - otherwise return raw.trim() (do not throw)
      - In toEntity(DiagramDto dto,...):
          .diagramType(normalizeDiagramType(dto.diagramType()))
      - In toDto(DiagramEntity entity,...):
          pass normalizeDiagramType(entity.getDiagramType()) to DiagramDto (defensive in case DB has old values)
    notes:
      - This guarantees any future saves round-trip canonical values even if an older client sends non-canonical casing.

  - id: DB-1-liquibase-migrate-existing-diagram-types
    component: architecture-model-service
    files:
      - src/main/resources/db/changelog/db.changelog-master.yaml (or the active master file)
      - src/main/resources/db/changelog/sql/<new-file>.sql  (preferred pattern in this repo)
    changes:
      - Add a new Liquibase changeset that updates existing rows in diagrams.diagram_type to canonical values.
      - SQL (Postgres) MUST be idempotent and safe:
          UPDATE diagrams
          SET diagram_type =
            CASE
              WHEN diagram_type IS NULL THEN NULL
              WHEN UPPER(TRIM(diagram_type)) = 'GENERAL' THEN 'General'
              WHEN UPPER(TRIM(diagram_type)) = 'ER' THEN 'ER'
              WHEN UPPER(TRIM(diagram_type)) = 'SEQUENCE' THEN 'Sequence'
              WHEN UPPER(TRIM(diagram_type)) = 'ACTIVITY' THEN 'Activity'
              WHEN UPPER(TRIM(diagram_type)) = 'STATE' THEN 'State'
              ELSE TRIM(diagram_type)
            END;
      - Ensure this changeset runs after the diagrams table exists.
    acceptance:
      - After applying migrations, querying diagrams shows canonical values for all known types.

  - id: QA-1-regression-checks
    component: repo
    changes:
      - Add/extend a lightweight frontend unit test (or update existing diagram-type tests) to assert:
          normalizeDiagramType('SEQUENCE') === 'Sequence'
          normalizeDiagramType(' sequence ') === 'Sequence'
          getDiagramType({diagram_type:'SEQUENCE', ...}) === 'Sequence'
      - If no test framework coverage is desired right now, add a small dev-only console assertion block behind a clearly marked comment (last resort).
    acceptance:
      - Prevents reintroducing strict casing bugs.

manual_verification_steps:
  - In DB, set one diagram row to diagram_type='SEQUENCE' and reload the model in the UI:
      - The selected diagram renders the Sequence Editor panel with "+ Add Participant".
  - Create a new diagram of type Sequence; save; reload:
      - diagram_type persists as "Sequence"
      - Sequence Editor panel still appears.
