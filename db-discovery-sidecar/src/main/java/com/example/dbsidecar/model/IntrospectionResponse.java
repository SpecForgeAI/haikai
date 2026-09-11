package com.example.dbsidecar.model;

import java.util.List;
import java.util.Map;

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
        String databaseCollation,
        /**
         * The engine that produced this introspection ({@code sybase} /
         * {@code mssql}); SPEC-1 §1.3. Optional / nullable.
         */
        String engine,
        /**
         * SQL Server {@code SERVERPROPERTY('Edition')}. Null on ASE.
         * Optional / nullable.
         */
        String serverEdition,
        /**
         * Server-level default collation ({@code SERVERPROPERTY('Collation')}).
         * Distinct from {@link #databaseCollation}, which is the DATABASE
         * default. Optional / nullable.
         */
        String serverCollation,
        /**
         * Objects with no like-for-like shape in the target engine, carried
         * kind-tagged so the pack layer can raise a decision rather than
         * silently dropping them (shaping §5 item 5): Service Broker queues /
         * services / contracts, user-defined table types, synonyms, full-text
         * catalogs, assemblies, XML schema collections, partition functions /
         * schemes, CDC capture instances, change tracking, FILESTREAM
         * filegroups, database triggers, row-level security policies, external
         * tables and temporal history links. Empty on ASE.
         */
        List<ExtendedObjectRow> extendedObjects
) {

    /**
     * Pre-SPEC-1 shape (no engine / edition / server collation / extended
     * objects). Used by the Sybase catalog, whose output is unchanged.
     */
    public IntrospectionResponse(
            final boolean ok,
            final String error,
            final List<SchemaRow> schemas,
            final List<TableRow> tables,
            final List<ColumnRow> columns,
            final List<KeyRow> keys,
            final List<ViewRow> views,
            final List<ProcedureRow> procedures,
            final List<TriggerRow> triggers,
            final List<SequenceRow> sequences,
            final List<ScheduledJobRow> scheduledJobs,
            final List<String> capabilities,
            final String serverVersion,
            final String databaseCollation
    ) {
        this(ok, error, schemas, tables, columns, keys, views, procedures, triggers,
                sequences, scheduledJobs, capabilities, serverVersion, databaseCollation,
                null, null, null, java.util.Collections.emptyList());
    }

    /**
     * The error envelope: {@code ok=false} with a (password-masked) reason and
     * every collection empty, so a Node consumer never null-checks a section.
     */
    public static IntrospectionResponse failure(final String error) {
        return new IntrospectionResponse(
                false,
                error,
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                java.util.Collections.emptyList(),
                null,
                null);
    }

    /**
     * One object with no like-for-like target shape (wire contract v2 §2).
     * {@code detail} is a free map -- e.g. a table type's columns, a synonym's
     * base object, an assembly's permission set.
     */
    public record ExtendedObjectRow(
            String kind,
            String schema,
            String name,
            String definition,
            Map<String, Object> detail
    ) {
    }

    /** Per-schema metadata. {@code owner} is the Sybase user that owns the schema. */
    public record SchemaRow(String schemaName, String owner) {
    }

    /**
     * Per-table metadata. The SQL Server additions (wire contract v2 §2) are
     * all nullable and stay null on ASE.
     */
    public record TableRow(
            String schemaName,
            String tableName,
            /** {@code system_versioned} | {@code history} | null (temporal tables). */
            String temporalType,
            /** {@code "schema.name"} of the history table for a system-versioned table. */
            String historyTable,
            /** SYSTEM_TIME period start column. Nullable. */
            String periodStartColumn,
            /** SYSTEM_TIME period end column. Nullable. */
            String periodEndColumn,
            /** TRUE for a memory-optimized (In-Memory OLTP) table. Nullable. */
            Boolean isMemoryOptimized,
            /** TRUE for a FileTable. Nullable. */
            Boolean isFiletable
    ) {
        /** Pre-SPEC-1 shape (ASE): structural identity only. */
        public TableRow(final String schemaName, final String tableName) {
            this(schemaName, tableName, null, null, null, null, null, null);
        }
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
            Boolean isIdentity,
            /** Numeric / temporal precision (wire contract v2 §2). Nullable. */
            Integer precision,
            /** Numeric / temporal scale. Nullable. */
            Integer scale,
            /** IDENTITY seed, verbatim as a string (exact-precision safe). Nullable. */
            String identitySeed,
            /** IDENTITY increment, verbatim as a string. Nullable. */
            String identityIncrement,
            /** DEFAULT constraint expression, verbatim. Nullable. */
            String defaultExpression,
            /** DEFAULT constraint name. Nullable. */
            String defaultConstraintName,
            /** TRUE when a computed column is PERSISTED. Nullable. */
            Boolean isPersistedComputed,
            /** TRUE for a ROWGUIDCOL column. Nullable. */
            Boolean isRowGuidCol,
            /** TRUE for a SPARSE column. Nullable. */
            Boolean isSparse,
            /**
             * Alias / user-defined type name when the column uses one;
             * {@code dataType} is then the resolved BASE type. Nullable.
             */
            String userTypeName,
            /** {@code as_row_start} | {@code as_row_end} | null (temporal period column). */
            String generatedAlwaysType,
            /** TRUE when the period column is HIDDEN. Nullable. */
            Boolean isHidden,
            /** TRUE for a FILESTREAM column. Nullable. */
            Boolean isFilestream,
            /** XML schema collection bound to an {@code xml} column. Nullable. */
            String xmlSchemaCollection
    ) {
        /** Pre-SPEC-1 shape (ASE): structure + the 2026-05-31 enrichment. */
        public ColumnRow(
                final String schemaName,
                final String tableName,
                final String columnName,
                final String dataType,
                final int maxLength,
                final boolean isNullable,
                final int ordinalPosition,
                final String collation,
                final Boolean isComputed,
                final String computedExpression,
                final Boolean isIdentity
        ) {
            this(schemaName, tableName, columnName, dataType, maxLength, isNullable,
                    ordinalPosition, collation, isComputed, computedExpression, isIdentity,
                    null, null, null, null, null, null, null, null, null, null, null, null,
                    null, null);
        }
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
            List<String> columnDirections,
            /** Filtered-index predicate ({@code sys.indexes.filter_definition}). Nullable. */
            String filterDefinition,
            /** INCLUDE (non-key) columns of a covering index. Nullable. */
            List<String> includeColumns,
            /**
             * {@code clustered | nonclustered | clustered_columnstore |
             * nonclustered_columnstore | xml | spatial | fulltext | heap | null}.
             */
            String indexType,
            /** TRUE when the index / constraint is DISABLED. Nullable. */
            Boolean isDisabled,
            /** TRUE when an FK / CHECK is NOT TRUSTED (created WITH NOCHECK). Nullable. */
            Boolean isNotTrusted,
            /** TRUE when a unique index backs a UNIQUE CONSTRAINT. Nullable. */
            Boolean isUniqueConstraint,
            /** CHECK constraint expression -- rows with {@code kind = "check_constraint"}. */
            String checkDefinition,
            /** Full-text catalog backing a {@code kind = "fulltext_index"} row. Nullable. */
            String fulltextCatalog
    ) {
        /** Pre-SPEC-1 shape (ASE). */
        public KeyRow(
                final String schemaName,
                final String tableName,
                final String kind,
                final String name,
                final List<String> columns,
                final String referencedSchema,
                final String referencedTable,
                final List<String> referencedColumns,
                final boolean isUnique,
                final String updateRule,
                final String deleteRule,
                final String indexDefinition,
                final String indexMethod,
                final Boolean isClustered,
                final String indexPredicate,
                final List<String> columnDirections
        ) {
            this(schemaName, tableName, kind, name, columns, referencedSchema, referencedTable,
                    referencedColumns, isUnique, updateRule, deleteRule, indexDefinition,
                    indexMethod, isClustered, indexPredicate, columnDirections,
                    null, null, null, null, null, null, null, null);
        }
    }

    /**
     * View metadata. The Sybase body is pre-trimmed to ~4KB at the sidecar;
     * the SQL Server body is the full {@code sys.sql_modules.definition}.
     */
    public record ViewRow(
            String schemaName,
            String viewName,
            String definition,
            boolean isMaterialized,
            /** TRUE for a SCHEMABINDING view. Nullable. */
            Boolean isSchemaBound,
            /**
             * TRUE when the view carries an index (an INDEXED VIEW). Indexed
             * views are OUT by shaping ruling 6 -- the flag is carried so the
             * pack can name the untranslatable reason instead of silently
             * emitting a plain view. Nullable.
             */
            Boolean isIndexedView
    ) {
        /** Pre-SPEC-1 shape (ASE). */
        public ViewRow(
                final String schemaName,
                final String viewName,
                final String definition,
                final boolean isMaterialized
        ) {
            this(schemaName, viewName, definition, isMaterialized, null, null);
        }
    }

    /**
     * Procedure or function metadata. {@code routineKind} is one of
     * {@code procedure | function | clr_procedure | clr_function}.
     * {@code language} is {@code "TSQL"} or {@code "CLR"}.
     */
    public record ProcedureRow(
            String schemaName,
            String procedureName,
            String routineKind,
            String body,
            String language,
            /** {@code scalar | inline_table | multi_statement_table | aggregate | null}. */
            String functionKind,
            /** Declared parameters in ordinal order. Empty / null on ASE. */
            List<ParameterRow> parameters,
            /** Declared return type of a scalar function. Nullable. */
            String returnsType,
            /** {@code EXECUTE AS} principal where one is set. Nullable. */
            String executeAs,
            /** Assembly backing a CLR routine. Nullable. */
            String assemblyName,
            /**
             * TRUE when {@code body} was CLIPPED by the sidecar. The Sybase
             * path marks its own clip inline in the body text and leaves this
             * null; the SQL Server path never clips (the full
             * {@code sys.sql_modules.definition} rides the wire).
             */
            Boolean truncated
    ) {
        /** Pre-SPEC-1 shape (ASE). */
        public ProcedureRow(
                final String schemaName,
                final String procedureName,
                final String routineKind,
                final String body,
                final String language
        ) {
            this(schemaName, procedureName, routineKind, body, language,
                    null, java.util.Collections.emptyList(), null, null, null, null);
        }
    }

    /** One declared routine parameter (wire contract v2 §2). */
    public record ParameterRow(
            String name,
            String dataType,
            Integer maxLength,
            Integer precision,
            Integer scale,
            Boolean isOutput,
            Boolean hasDefault,
            /** TRUE for a READONLY parameter -- i.e. a table-valued parameter. */
            Boolean isReadonly,
            Integer ordinal,
            /** Alias / table-type name when the parameter uses one. Nullable. */
            String userTypeName
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
            String actionStatement,
            /** TRUE when the trigger is DISABLED. Nullable. */
            Boolean isDisabled,
            /** {@code table} | {@code view} -- what the trigger hangs off. Nullable. */
            String parentKind,
            /** Events for which this trigger is ordered FIRST. Nullable. */
            List<String> orderFirstEvents,
            /** Events for which this trigger is ordered LAST. Nullable. */
            List<String> orderLastEvents,
            /** TRUE for a DATABASE-scoped (DDL) trigger. Nullable. */
            Boolean isDatabaseTrigger
    ) {
        /** Pre-SPEC-1 shape (ASE). */
        public TriggerRow(
                final String schemaName,
                final String triggerName,
                final String tableSchema,
                final String tableName,
                final String timing,
                final List<String> events,
                final String actionStatement
        ) {
            this(schemaName, triggerName, tableSchema, tableName, timing, events,
                    actionStatement, null, null, null, null, null);
        }
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
            String definition,
            /** CACHE size of a native sequence; null when uncached / unknown. */
            String cacheSize
    ) {
        /** Pre-SPEC-1 shape (ASE). */
        public SequenceRow(
                final String schemaName,
                final String sequenceName,
                final String dataType,
                final String startValue,
                final String increment,
                final String minValue,
                final String maxValue,
                final Boolean cycle,
                final String currentValue,
                final String ownedByTable,
                final String ownedByColumn,
                final String definition
        ) {
            this(schemaName, sequenceName, dataType, startValue, increment, minValue,
                    maxValue, cycle, currentValue, ownedByTable, ownedByColumn, definition,
                    null);
        }
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
            Boolean enabled,
            /** Job steps in ordinal order (SQL Server Agent). Empty on ASE. */
            List<JobStepRow> steps,
            /** Human-readable schedule text decoded from the msdb frequency fields. */
            String scheduleText,
            /** The raw msdb frequency fields, verbatim, as a map. Nullable. */
            Map<String, Object> scheduleFrequency
    ) {
        /** Pre-SPEC-1 shape (ASE). */
        public ScheduledJobRow(
                final String schemaName,
                final String jobName,
                final String scheduler,
                final String schedule,
                final String command,
                final Boolean enabled
        ) {
            this(schemaName, jobName, scheduler, schedule, command, enabled,
                    java.util.Collections.emptyList(), null, null);
        }
    }

    /** One step of a SQL Server Agent job (wire contract v2 §2). */
    public record JobStepRow(
            Integer ordinal,
            String subsystem,
            String command,
            String databaseName
    ) {
    }
}
