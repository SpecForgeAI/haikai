package com.example.architecturemodel.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Shared helper that maps every architecture-scoped element table to its
 * parent table + foreign-key column, so read paths can derive a row's
 * architecture-scope from the canonical parent (not the denormalised leaf
 * {@code architecture_id} column on the row itself).
 *
 * <h2>Why a parent-chain read path</h2>
 *
 * <p>Liquibase changesets 089 / 090 / 091 added a denormalised
 * {@code architecture_id} column on every in-scope element table, with a
 * BEFORE INSERT trigger (changeset
 * {@code 097-architecture-id-auto-derive-trigger.sql}) auto-deriving the
 * value from the row's parent at INSERT time. There is no UPDATE trigger
 * and no FK-cascade rewrite keeping the leaf in sync if the parent's
 * {@code architecture_id} is later changed or if a legacy / raw-SQL path
 * writes the leaf directly. The leaf column therefore can drift from the
 * parent and is not authoritative for reads.</p>
 *
 * <p>Every "what's in this architecture?" read path now routes through this
 * resolver, mirroring the canonical
 * {@link ModelService#loadModelByFileId} surface that walks each entity
 * table via {@code findByModelFileId(...)}. The leaf column stays in place
 * as a write-time optimisation (and to support tables whose JPA entities
 * do not expose {@code architectureId}) but stops being read by any
 * inventory / selective-copy / mapping query.</p>
 *
 * <h2>Three parent-derivation chains (mirrors changeset 097)</h2>
 *
 * <ul>
 *   <li><b>{@code model_file_id} chain</b> (53 trigger tables + 21 later
 *       infrastructure / library tables that all carry {@code model_file_id}):
 *       {@code JOIN model_files p ON p.id = t.model_file_id WHERE
 *       p.architecture_id = ?}.</li>
 *   <li><b>{@code sequence_diagram_id} chain</b> (4 tables —
 *       {@code sequence_participants}, {@code sequence_messages},
 *       {@code sequence_fragments}, {@code sequence_nodes}):
 *       {@code JOIN sequence_diagrams p ON p.id = t.sequence_diagram_id
 *       WHERE p.architecture_id = ?}.</li>
 *   <li><b>{@code fragment_id} chain</b> (1 table — {@code sequence_operands}):
 *       {@code JOIN sequence_fragments p ON p.id = t.fragment_id WHERE
 *       p.architecture_id = ?}.</li>
 * </ul>
 *
 * <h2>Tables NOT in this map (deliberately)</h2>
 *
 * <ul>
 *   <li>{@code model_files} — the canonical parent; its
 *       {@code architecture_id} IS the source of truth.</li>
 *   <li>{@code sequence_diagrams} — parent of the
 *       {@code sequence_diagram_id} chain (carries its own
 *       {@code architecture_id} populated via the model_file chain).</li>
 *   <li>{@code sequence_fragments} — parent of the {@code fragment_id}
 *       chain.</li>
 *   <li>{@code architecture}, {@code architecture_tags} — the
 *       architecture itself.</li>
 *   <li>{@code temporary_diagrams} — project-scoped, holds its own
 *       {@code architecture_id} directly (per spec #1).</li>
 *   <li>{@code architecture_element_mappings} — direct project/architecture
 *       rows, not derived.</li>
 *   <li>{@code discovery_*} — one-run-to-one-architecture invariant +
 *       immutable provenance; not part of the inventory / selective-copy
 *       scope.</li>
 * </ul>
 *
 * <p>Callers asking for any table not in this map get a loud
 * {@link IllegalArgumentException} — this is a programmer-error guard rail
 * so new in-scope tables get caught at runtime rather than silently
 * returning empty.</p>
 *
 * <p>Spec: 2026-05-22-architecture-scope-via-parent-not-leaf</p>
 */
public final class ArchitectureScopeResolver {

    /** Records the parent table + FK column for a single element table. */
    public record ParentLink(String parentTable, String fkColumn) {}

    /**
     * Hard-coded per-table parent map. Built once at class-load time —
     * the structure is intentionally a simple data table so a future
     * in-scope table addition is a single map entry.
     */
    private static final Map<String, ParentLink> PARENT_MAP = buildParentMap();

    private ArchitectureScopeResolver() {
        // Static helper — no instances.
    }

    /**
     * Builds the parameterised {@code SELECT} clause that filters
     * {@code table}'s rows by the canonical parent's
     * {@code architecture_id}. The single bind parameter is the
     * architecture UUID; callers supply it via
     * {@code jdbcTemplate.queryForList(sql, architectureId)}.
     *
     * @param table          the in-scope element table being scanned.
     * @param selectColumns  the comma-separated column list to project
     *                       (e.g. {@code "id, name"} or
     *                       {@code "id, model_file_id, name, ..."}).
     *                       Columns are read from the element table
     *                       directly, NOT from the parent — the join is
     *                       only used to evaluate the architecture-scope
     *                       predicate.
     * @return the parameterised SQL, ready to bind the architecture UUID.
     * @throws IllegalArgumentException with the exact message
     *         {@code "No architecture-scope parent registered for table: <table>"}
     *         when {@code table} is not in the parent map.
     */
    public static String buildScopedSelectClause(String table, String selectColumns) {
        ParentLink link = PARENT_MAP.get(table);
        if (link == null) {
            throw new IllegalArgumentException(
                "No architecture-scope parent registered for table: " + table);
        }
        // The element table is aliased "t" so qualified column refs from the
        // caller's selectColumns are stable; the parent is aliased "p" so
        // the WHERE predicate reads naturally.
        return "SELECT " + selectColumns
            + " FROM " + table + " t"
            + " JOIN " + link.parentTable() + " p ON p.id = t." + link.fkColumn()
            + " WHERE p.architecture_id = ?";
    }

    /**
     * Builds the parameterised parent-chain WHERE predicate (no surrounding
     * {@code SELECT}/{@code UPDATE}/{@code DELETE} keyword) for embedding
     * inside larger statements that cannot use the joined-select form.
     *
     * <p>Returns:
     * {@code <fkColumn> IN (SELECT id FROM <parentTable> WHERE
     * architecture_id = ?)}.</p>
     *
     * <p>Used by {@code UPDATE} statements whose existing {@code WHERE id
     * = ? AND architecture_id = ?} predicate must be re-routed through
     * the parent chain. The single bind parameter is the architecture
     * UUID; callers should bind it after the row id used in the
     * {@code WHERE id = ?} portion.</p>
     *
     * @param table the in-scope element table.
     * @return the parameterised predicate fragment.
     * @throws IllegalArgumentException with the exact message
     *         {@code "No architecture-scope parent registered for table: <table>"}
     *         when {@code table} is not in the parent map.
     */
    public static String buildScopedWherePredicate(String table) {
        ParentLink link = PARENT_MAP.get(table);
        if (link == null) {
            throw new IllegalArgumentException(
                "No architecture-scope parent registered for table: " + table);
        }
        return link.fkColumn()
            + " IN (SELECT id FROM " + link.parentTable()
            + " WHERE architecture_id = ?)";
    }

    /**
     * Builds a grouped per-architecture {@code COUNT(*)} for {@code table},
     * routed through the table's canonical parent chain rather than the leaf
     * {@code architecture_id} column.
     *
     * <p>This is the batched, multi-architecture companion to
     * {@link #buildScopedSelectClause(String, String)}. It exists because
     * several in-scope element tables — notably the model-file-anchored
     * infrastructure / library tables added by changesets 098..123
     * ({@code infrastructure_points}, {@code environments}, {@code libraries},
     * …) — have <b>no {@code architecture_id} column at all</b>. A raw
     * {@code SELECT architecture_id, COUNT(*) FROM <table> ... GROUP BY
     * architecture_id} therefore raises {@code column "architecture_id" does
     * not exist} on PostgreSQL (H2 tolerates it only when the leaf column
     * happens to exist). Routing through the parent chain is uniformly correct
     * for every registered table regardless of whether the leaf exists.</p>
     *
     * <p>Returns SQL of the form:</p>
     * <pre>
     * SELECT p.architecture_id AS architecture_id, COUNT(*) AS element_count
     *   FROM &lt;table&gt; t
     *   JOIN &lt;parent&gt; p ON p.id = t.&lt;fk&gt;
     *  WHERE p.architecture_id IN (?, ?, ...)
     *  GROUP BY p.architecture_id
     * </pre>
     *
     * <p>The projected columns are stable: column 1 is {@code architecture_id}
     * (aliased), column 2 is the count. Callers bind exactly
     * {@code architectureIdCount} architecture UUIDs into the {@code IN (...)}
     * list (in order).</p>
     *
     * @param table                the in-scope element table being counted.
     * @param architectureIdCount  number of {@code architecture_id} bind
     *                             placeholders to emit in the {@code IN (...)}
     *                             list (must be {@code >= 1}).
     * @return the parameterised grouped-count SQL, ready to bind the
     *         architecture UUIDs.
     * @throws IllegalArgumentException with the exact message
     *         {@code "No architecture-scope parent registered for table: <table>"}
     *         when {@code table} is not in the parent map, or
     *         {@code "architectureIdCount must be >= 1 ..."} when the count is
     *         non-positive (a non-positive count would emit a malformed
     *         {@code IN ()} expression).
     */
    public static String buildScopedGroupedCountClause(String table, int architectureIdCount) {
        ParentLink link = PARENT_MAP.get(table);
        if (link == null) {
            throw new IllegalArgumentException(
                "No architecture-scope parent registered for table: " + table);
        }
        if (architectureIdCount < 1) {
            throw new IllegalArgumentException(
                "architectureIdCount must be >= 1 for table: " + table);
        }
        StringBuilder placeholders = new StringBuilder();
        for (int i = 0; i < architectureIdCount; i++) {
            if (i > 0) {
                placeholders.append(", ");
            }
            placeholders.append("?");
        }
        return "SELECT p.architecture_id AS architecture_id, COUNT(*) AS element_count"
            + " FROM " + table + " t"
            + " JOIN " + link.parentTable() + " p ON p.id = t." + link.fkColumn()
            + " WHERE p.architecture_id IN (" + placeholders + ")"
            + " GROUP BY p.architecture_id";
    }

    /**
     * Returns {@code true} iff the table has a registered parent link.
     * Used by the inventory service's defensive fallback path: tables
     * outside the map fall back to the legacy leaf-column query with a
     * WARN log line.
     */
    public static boolean hasParent(String table) {
        return PARENT_MAP.containsKey(table);
    }

    /**
     * Returns the set of all registered tables. Used by the resolver's
     * unit test to assert {@code IN_SCOPE_TABLES_IN_ORDER} is a subset.
     */
    public static Set<String> registeredTables() {
        return PARENT_MAP.keySet();
    }

    /**
     * Returns the parent link for {@code table}, or {@code null} if not
     * registered. Exposed primarily for unit tests.
     */
    public static ParentLink parentLinkFor(String table) {
        return PARENT_MAP.get(table);
    }

    // ------------------------------------------------------------------
    // Static map construction
    // ------------------------------------------------------------------

    private static Map<String, ParentLink> buildParentMap() {
        Map<String, ParentLink> map = new LinkedHashMap<>();

        // ============================================================
        // CHAIN 1: model_file_id -> model_files.architecture_id
        // ------------------------------------------------------------
        // First, the 53 tables enumerated verbatim by changeset
        // 097-architecture-id-auto-derive-trigger.sql:
        //   BATCH B (business),  BATCH C (application),
        //   BATCH D (data),      BATCH E (interaction),
        //   BATCH F (behavioural / sequence_diagrams root),
        //   BATCH H (UI),        BATCH I (diagrams).
        // ============================================================

        // BATCH B - BUSINESS (11 tables)
        addModelFileLink(map, "business_users");
        addModelFileLink(map, "business_processes");
        addModelFileLink(map, "process_activities");
        addModelFileLink(map, "business_points");
        addModelFileLink(map, "business_user_business_points");
        addModelFileLink(map, "application_point_business_points");
        addModelFileLink(map, "business_logics");
        addModelFileLink(map, "application_point_business_logics");
        addModelFileLink(map, "user_journeys");
        addModelFileLink(map, "activity_steps");
        addModelFileLink(map, "user_journey_links");

        // BATCH C - APPLICATION (12 tables)
        addModelFileLink(map, "applications");
        addModelFileLink(map, "application_components");
        addModelFileLink(map, "services");
        addModelFileLink(map, "interfaces");
        addModelFileLink(map, "endpoints");
        addModelFileLink(map, "application_points");
        addModelFileLink(map, "classes");
        addModelFileLink(map, "methods");
        addModelFileLink(map, "package_sets");
        addModelFileLink(map, "packages");
        addModelFileLink(map, "package_set_default_rules");
        addModelFileLink(map, "package_set_standards_import_status");

        // BATCH D - DATA (10 tables)
        addModelFileLink(map, "logical_data_entities");
        addModelFileLink(map, "logical_data_attributes");
        addModelFileLink(map, "physical_data_entities");
        addModelFileLink(map, "physical_data_attributes");
        addModelFileLink(map, "logical_data_entity_relationships");
        addModelFileLink(map, "logical_data_entity_physical_data_entities");
        addModelFileLink(map, "logical_data_attribute_physical_data_attributes");
        addModelFileLink(map, "data_entity_points");
        addModelFileLink(map, "data_movements");
        addModelFileLink(map, "interface_logical_entities");

        // BATCH E - INTERACTION (2 tables)
        addModelFileLink(map, "app_business_points");
        addModelFileLink(map, "interactions");

        // BATCH F - BEHAVIOURAL / sequence root (7 tables)
        addModelFileLink(map, "events");
        addModelFileLink(map, "states");
        addModelFileLink(map, "state_transitions");
        addModelFileLink(map, "activities");
        addModelFileLink(map, "activity_flows");
        addModelFileLink(map, "activity_partitions");
        addModelFileLink(map, "sequence_diagrams");

        // BATCH H - UI (6 tables)
        addModelFileLink(map, "ui_screens");
        addModelFileLink(map, "ui_workflow_transitions");
        addModelFileLink(map, "ui_components");
        addModelFileLink(map, "ui_actions");
        addModelFileLink(map, "ui_contracts");
        addModelFileLink(map, "ui_characteristics");

        // BATCH I - DIAGRAMS (5 tables)
        addModelFileLink(map, "diagrams");
        addModelFileLink(map, "diagram_nodes");
        addModelFileLink(map, "diagram_edges");
        addModelFileLink(map, "diagram_interaction_edges");
        addModelFileLink(map, "diagram_decorations");

        // ------------------------------------------------------------
        // EXTENSION: INFRASTRUCTURE + LIBRARY tables.
        //
        // These tables were added by changesets 098..123 — AFTER trigger
        // 097 was authored — and so are not in the trigger file. They
        // all carry a {@code model_file_id} column referencing
        // {@code model_files(id)}, so they take the same parent-chain
        // derivation as the 53 BATCH B..I tables above. (They have NO
        // {@code architecture_id} column at all, so a leaf-column query
        // against them currently silently fails via BadSqlGrammarException
        // — fixing this is part of why the spec exists.)
        //
        // Infrastructure entity tables (changesets 098..110, 118)
        // ------------------------------------------------------------
        addModelFileLink(map, "environments");
        addModelFileLink(map, "cloud_accounts");
        addModelFileLink(map, "locations");
        addModelFileLink(map, "networks");
        addModelFileLink(map, "subnets");
        addModelFileLink(map, "compute_clusters");
        addModelFileLink(map, "compute_resources");
        addModelFileLink(map, "deployment_units");
        addModelFileLink(map, "load_balancers");
        addModelFileLink(map, "listeners");
        addModelFileLink(map, "data_store_instances");
        addModelFileLink(map, "infrastructure_resources");
        addModelFileLink(map, "infrastructure_points");
        addModelFileLink(map, "iac_sources");
        // Infrastructure relationship tables (changesets 111..117, 119)
        addModelFileLink(map, "resource_subnet_hostings");
        addModelFileLink(map, "deployment_unit_compute_resources");
        addModelFileLink(map, "load_balancer_resource_routes");
        addModelFileLink(map, "application_compute_deployments");
        addModelFileLink(map, "data_entity_data_store_hostings");
        addModelFileLink(map, "application_infrastructure_resource_uses");
        addModelFileLink(map, "application_load_balancer_exposures");
        addModelFileLink(map, "iac_resource_bindings");
        // Library Backend Foundation (changesets 122..123)
        addModelFileLink(map, "libraries");
        addModelFileLink(map, "code_unit_dependencies");

        // ============================================================
        // CHAIN 2: sequence_diagram_id -> sequence_diagrams.architecture_id
        // (verbatim from changeset 097 BATCH G - 4 tables)
        // ============================================================
        map.put("sequence_participants",
            new ParentLink("sequence_diagrams", "sequence_diagram_id"));
        map.put("sequence_messages",
            new ParentLink("sequence_diagrams", "sequence_diagram_id"));
        map.put("sequence_fragments",
            new ParentLink("sequence_diagrams", "sequence_diagram_id"));
        map.put("sequence_nodes",
            new ParentLink("sequence_diagrams", "sequence_diagram_id"));

        // ============================================================
        // CHAIN 3: fragment_id -> sequence_fragments.architecture_id
        // (verbatim from changeset 097 BATCH G - 1 table)
        // ============================================================
        map.put("sequence_operands",
            new ParentLink("sequence_fragments", "fragment_id"));

        return map;
    }

    private static void addModelFileLink(Map<String, ParentLink> map, String table) {
        map.put(table, new ParentLink("model_files", "model_file_id"));
    }
}
