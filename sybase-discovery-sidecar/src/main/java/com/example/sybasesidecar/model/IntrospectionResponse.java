package com.example.sybasesidecar.model;

import java.util.List;

/**
 * Response body for {@code POST /introspect}. Structured introspection of a
 * Sybase ASE database; nested {@code records} carry the per-object metadata.
 * All snippet-bearing fields (view, procedure, trigger bodies) are
 * pre-trimmed to ~4KB by the sidecar; the discovery-service further redacts
 * via {@code snippetRedaction.redactSnippet} on the TS side before the
 * snippet reaches a persisted Finding or Evidence payload.
 *
 * <h2>Metadata-enrichment additions (2026-05-31)</h2>
 * <p>Spec {@code 2026-05-31-sybase-metadata-enrichment} brings Sybase
 * data-layer fidelity to parity with Postgres. The additions below are ALL
 * optional / nullable and additive -- an older discovery-service ignores the
 * new fields and a newer one tolerates their absence (the TS mapper is
 * per-field null-tolerant). The field names mirror the discovery IR
 * ({@code KeyOrIndexMetadata}, {@code ColumnMetadata}, {@code IntrospectionResult})
 * so the TypeScript {@code SidecarIntrospectionResponse} binds to the same
 * names. This sidecar is its OWN Spring Boot module: the AMS
 * {@code snake_case} / {@code @CamelCaseWire} conventions do NOT apply, so the
 * default camelCase JSON serialization is the wire shape and no Jackson naming
 * annotation is added.</p>
 *
 * <h3>New top-level fields</h3>
 * <ul>
 *   <li>{@code capabilities} -- the metadata groups THIS sidecar build
 *       surfaces (lets discovery distinguish "this build does not surface group
 *       X" from "group X surfaced but genuinely null"). An older sidecar omits
 *       it, which discovery reads as {@code unavailable} (NOT a structural
 *       N/A).</li>
 *   <li>{@code serverVersion} -- the engine version string (ASE
 *       {@code @@version}); mirrors the existing
 *       {@link TestConnectionResponse#serverVersion()} naming. Discovery branches
 *       its three-state applicability on this (e.g. native SEQUENCE is
 *       ASE16+).</li>
 *   <li>{@code databaseCollation} -- the database-level default sort order
 *       (group 1); discovery sets {@code IntrospectionResult.databaseCollation}
 *       from it.</li>
 * </ul>
 */
public record IntrospectionResponse(
        boolean ok,
        String error,
        List<SchemaRow> schemas,
        List<TableRow> tables,
        List<ColumnRow> columns,
        List<KeyRow> keys,
        List<ViewRow> views,
        List<ProcedureRow> procedures,
        List<TriggerRow> triggers,
        List<SequenceRow> sequences,
        List<ScheduledJobRow> scheduledJobs,
        /**
         * Metadata groups this sidecar build surfaces (decision 3). Verbatim
         * group keys; discovery resolves a group it does NOT find here to
         * {@code unavailable}. Optional / nullable (older sidecar omits it).
         */
        List<String> capabilities,
        /**
         * Engine version string -- ASE {@code @@version} (decision 4). Mirrors
         * {@link TestConnectionResponse#serverVersion()}. Optional / nullable.
         */
        String serverVersion,
        /**
         * Database-level default collation / sort order (group 1). Verbatim
         * engine string; discovery sets {@code IntrospectionResult.databaseCollation}
         * from it. Optional / nullable.
         */
        String databaseCollation
) {

    /** Per-schema metadata. {@code owner} is the Sybase user that owns the schema. */
    public record SchemaRow(String schemaName, String owner) {
    }

    /** Per-table metadata. */
    public record TableRow(String schemaName, String tableName) {
    }

    /**
     * Per-column metadata.
     *
     * <p>The enrichment fields ({@code collation}, {@code isComputed},
     * {@code computedExpression}, {@code isIdentity}) mirror the discovery IR
     * {@code ColumnMetadata} (collation / computed-column / identity) and the TS
     * {@code SidecarIntrospectionResponse} {@code columns[]} optional fields.
     * All are optional / nullable; the boxed {@link Boolean} flags are
     * deliberately nullable (not primitive) so an unknown value is distinct from
     * an explicit {@code false}.</p>
     */
    public record ColumnRow(
            String schemaName,
            String tableName,
            String columnName,
            String dataType,
            int maxLength,
            boolean isNullable,
            int ordinalPosition,
            /** Per-column collation / sort-order (group 1), verbatim. Nullable. */
            String collation,
            /** TRUE when the column is a Sybase COMPUTED column (group 2). Nullable. */
            Boolean isComputed,
            /** Verbatim computed-column expression (group 2). Nullable. */
            String computedExpression,
            /** TRUE when the column carries the Sybase IDENTITY property (group 3). Nullable. */
            Boolean isIdentity
    ) {
    }

    /**
     * Key or index metadata. {@code kind} is one of {@code primary_key,
     * unique_constraint, foreign_key, index}. Foreign-key rows populate the
     * {@code referencedSchema}/{@code referencedTable} fields.
     *
     * <p>The index-fidelity fields ({@code indexDefinition}, {@code indexMethod},
     * {@code isClustered}, {@code indexPredicate}, {@code columnDirections}) and
     * the FK referential-action fields ({@code updateRule}, {@code deleteRule})
     * mirror the discovery IR {@code KeyOrIndexMetadata} (group 4 + group 5) and
     * the TS {@code SidecarIntrospectionResponse} {@code keys[]} optional fields.
     * All are optional / nullable. {@code indexPredicate} is always null for ASE
     * (no filtered / partial indexes -- discovery resolves it to
     * {@code not_applicable_for_engine}). {@code isClustered} is a boxed
     * {@link Boolean} (nullable -- distinct from {@code isUnique}, which stays a
     * primitive because it is always derivable from the index status bits).</p>
     */
    public record KeyRow(
            String schemaName,
            String tableName,
            String kind,
            String name,
            List<String> columns,
            String referencedSchema,
            String referencedTable,
            List<String> referencedColumns,
            boolean isUnique,
            /** FK referential ON UPDATE action, verbatim engine string (group 4). Nullable. */
            String updateRule,
            /** FK referential ON DELETE action, verbatim engine string (group 4). Nullable. */
            String deleteRule,
            /** Full verbatim index definition / DDL where derivable (group 5). Nullable. */
            String indexDefinition,
            /** Access method / index type where derivable (group 5). Nullable. */
            String indexMethod,
            /** TRUE when the index is clustered (group 5). Nullable. */
            Boolean isClustered,
            /** Partial-index predicate -- always null for ASE (group 5). Nullable. */
            String indexPredicate,
            /** Per-column ordering directives (ASC/DESC), aligned with {@code columns[]} (group 5). Nullable. */
            List<String> columnDirections
    ) {
    }

    /** View metadata - body pre-trimmed to ~4KB at the sidecar. */
    public record ViewRow(
            String schemaName,
            String viewName,
            String definition,
            boolean isMaterialized
    ) {
    }

    /** Procedure or function metadata - body pre-trimmed to ~4KB. */
    public record ProcedureRow(
            String schemaName,
            String procedureName,
            String routineKind,
            String body,
            String language
    ) {
    }

    /**
     * Trigger metadata. {@code timing} is one of
     * {@code before, after, instead_of}; v1 sidecar defaults to
     * {@code after}. {@code events} is a sublist of
     * {@code insert, update, delete} inferred from the trigger body.
     */
    public record TriggerRow(
            String schemaName,
            String triggerName,
            String tableSchema,
            String tableName,
            String timing,
            List<String> events,
            String actionStatement
    ) {
    }

    /**
     * Sequence / identity-generator metadata (group 3). Mirrors the discovery
     * IR {@code SequenceMetadata} and the TS {@code SidecarIntrospectionResponse}
     * {@code sequences[]} shape. IDENTITY columns are synthesized into this same
     * shape (decision 7): {@code sequenceName = "<table>.<col> (identity)"} with
     * {@code ownedByTable} / {@code ownedByColumn} set, so the existing
     * {@code sequence_cutover_hazard} Finding fires unchanged on the discovery
     * side. {@code currentValue} is the allocation high-water mark (cheap path,
     * then a {@code MAX(col)} scan fallback). All detail fields are optional /
     * nullable.
     */
    public record SequenceRow(
            String schemaName,
            String sequenceName,
            String dataType,
            String startValue,
            String increment,
            String minValue,
            String maxValue,
            Boolean cycle,
            /** Allocation high-water mark, verbatim (group 3). Nullable. */
            String currentValue,
            /** Owning table for a synthesized identity sequence (group 3). Nullable. */
            String ownedByTable,
            /** Owning column for a synthesized identity sequence (group 3). Nullable. */
            String ownedByColumn,
            /** Verbatim definition where the engine reports one. Nullable. */
            String definition
    ) {
    }

    /**
     * Database-resident scheduled-job metadata (group 6). Mirrors the discovery
     * IR {@code ScheduledJobMetadata} and the TS
     * {@code SidecarIntrospectionResponse} {@code scheduledJobs[]} shape. Read
     * via the narrow read-only Job Scheduler proc allowlist (decision 8). All
     * verbatim; optional / nullable.
     */
    public record ScheduledJobRow(
            String schemaName,
            String jobName,
            /** Scheduler mechanism label, verbatim (e.g. {@code sybase_job_scheduler}). Nullable. */
            String scheduler,
            /** Schedule expression, verbatim. Nullable. */
            String schedule,
            /** Command / SQL the job runs, verbatim. Nullable. */
            String command,
            /** Whether the job is enabled where the engine reports it. Nullable. */
            Boolean enabled
    ) {
    }
}
