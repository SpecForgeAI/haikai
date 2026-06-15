package com.example.sybasesidecar.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.sybasesidecar.model.IntrospectionResponse;
import com.example.sybasesidecar.model.QueryResponse;
import com.example.sybasesidecar.model.SybaseDriverChoice;
import com.example.sybasesidecar.model.TestConnectionResponse;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link SybaseQueryService} - the helpers and shape
 * contracts that don't need a live Sybase connection. The JDBC-touching
 * paths are covered by integration tests against a real Sybase Docker
 * container, gated by the {@code SYBASE_INTEGRATION=true} env var.
 *
 * <p>Revised 2026-05-17 to cover the dual-driver design: URL forms for both
 * jTDS + jConnect, the auto-mode fallback when jTDS fails and jConnect is
 * available, and the unavailable-jConnect graceful path.</p>
 *
 * <p>Revised 2026-05-31 (Sybase metadata enrichment, Task Group 1) to cover
 * the additive {@link IntrospectionResponse} contract + the extracted pure
 * per-row mapper seams ({@code mapColumnRow}, {@code mapIndexRow},
 * {@code mapFkRow}, {@code mapKeyIndexKind}, {@code decodeClustered},
 * {@code synthesizeIdentitySequenceRow}). These tests drive the mappers with
 * primitive row inputs (NOT a fake JDBC {@link java.sql.ResultSet}), following
 * the existing pure-helper test style ({@code matchesSchemaFilter},
 * {@code maskPassword}, {@code FakeStrategy}).</p>
 *
 * <p>Revised 2026-05-31 (Task Groups 2-4) to cover the now-projected catalog
 * content: collation / computed-column / FK-action verbatim mapping + the new
 * status/action decode seams ({@code isComputedColumnStatus},
 * {@code decodeFkAction}) (Group 2); identity current-value selection
 * ({@code resolveCurrentValue} / {@code shouldScanForCurrentValue}), the ASE16
 * native-sequence version branch ({@code supportsNativeSequenceCatalog}) and
 * index ordering / clustering ({@code buildIndexDefinition}) (Group 3); and the
 * jobs projection ({@code mapScheduledJobRow}) (Group 4). All remain pure:
 * primitives in, record out, version-tolerant null-out -- no live DB.</p>
 */
class SybaseQueryServiceTest {

    /**
     * Default constructor variant -- exercises the production wiring (both
     * strategies instantiated). jConnect will report unavailable when the
     * jconn4.jar is absent, which is the expected developer-machine state.
     */
    @Test
    void buildsJtdsSybaseJdbcUrl() {
        final SybaseQueryService svc = new SybaseQueryService();
        // Back-compat overload defaults to the jTDS URL form.
        assertEquals("jdbc:jtds:sybase://db.test:5000/demo",
                svc.buildJdbcUrl("db.test", 5000, "demo"));
        // Explicit jTDS choice produces the same URL.
        assertEquals("jdbc:jtds:sybase://db.test:5000/demo",
                svc.buildJdbcUrl(SybaseDriverChoice.JTDS, "db.test", 5000, "demo"));
    }

    /**
     * jConnect URL embeds the database in the URL path. An earlier revision
     * passed it via a SERVICENAME property, but jConnect silently ignored
     * that and connected to the server's default DB (tempdb), producing
     * empty introspection results.
     */
    @Test
    void buildsJConnectSybaseJdbcUrl() {
        final SybaseQueryService svc = new SybaseQueryService();
        assertEquals("jdbc:sybase:Tds:db.test:5000/demo",
                svc.buildJdbcUrl(SybaseDriverChoice.JCONNECT, "db.test", 5000, "demo"));
    }

    /**
     * AUTO mode at the URL-build helper level produces the jTDS form (the
     * first-attempt driver). The strategy fallback happens at connection
     * time, not URL-build time.
     */
    @Test
    void buildJdbcUrlForAutoChoiceUsesJtdsForm() {
        final SybaseQueryService svc = new SybaseQueryService();
        assertEquals("jdbc:jtds:sybase://db.test:5000/demo",
                svc.buildJdbcUrl(SybaseDriverChoice.AUTO, "db.test", 5000, "demo"));
    }

    /**
     * Auto mode: jTDS fails, jConnect is available, so the second attempt
     * succeeds and the response reports {@code driverUsed="jconnect"}.
     */
    @Test
    void autoModeFallsThroughToJConnectOnJtdsFailure() {
        final DriverStrategy failingJtds = new FakeStrategy("jtds", true, /* succeed */ false);
        final DriverStrategy okJConnect = new FakeStrategy("jconnect", true, /* succeed */ true);
        final SybaseQueryService svc = new SybaseQueryService(failingJtds, okJConnect);
        // testConnection will use the SQL "SELECT @@version" which the fake
        // Connection cannot service -- but the open succeeded, so the result
        // reports ok=false yet driverUsed=jconnect (the successful open).
        final TestConnectionResponse resp = svc.testConnection(
                SybaseDriverChoice.AUTO, "h", 1, "d", "u", "p");
        // Fake connection's createStatement throws -> ok=false, but the
        // strategy that opened the connection is recorded.
        assertEquals("jconnect", resp.driverUsed());
    }

    /**
     * Auto mode with jConnect unavailable: the original jTDS error surfaces
     * unchanged. The driverUsed on a failure points at the only driver we
     * could have used (jtds).
     */
    @Test
    void autoModeReturnsJtdsErrorWhenJConnectUnavailable() {
        final DriverStrategy failingJtds = new FakeStrategy("jtds", true, false);
        final DriverStrategy missingJConnect = new FakeStrategy("jconnect", false, false);
        final SybaseQueryService svc = new SybaseQueryService(failingJtds, missingJConnect);
        final TestConnectionResponse resp = svc.testConnection(
                SybaseDriverChoice.AUTO, "h", 1, "d", "u", "p");
        assertFalse(resp.ok());
        assertNotNull(resp.error());
        assertEquals("jtds", resp.driverUsed());
    }

    /**
     * {@code maskPassword} replaces every occurrence of the password
     * substring in the error message with {@code ***}.
     */
    @Test
    void masksPasswordInErrorMessage() {
        final SybaseQueryService svc = new SybaseQueryService();
        final String message = "connection failed: password=supersecret host=...";
        final String masked = svc.maskPassword(message, "supersecret");
        assertFalse(masked.contains("supersecret"), "password substring should be removed");
        assertTrue(masked.contains("***"), "masked replacement marker should appear");
    }

    @Test
    void maskPasswordNoopOnEmpty() {
        final SybaseQueryService svc = new SybaseQueryService();
        assertEquals("hello", svc.maskPassword("hello", null));
        assertEquals("hello", svc.maskPassword("hello", ""));
    }

    @Test
    void maskPasswordOnNullMessage() {
        final SybaseQueryService svc = new SybaseQueryService();
        assertEquals("", svc.maskPassword(null, "secret"));
    }

    @Test
    void schemaFilterEmptyMeansNoFilter() {
        assertTrue(SybaseQueryService.matchesSchemaFilter("dbo", null));
        assertTrue(SybaseQueryService.matchesSchemaFilter("dbo", Collections.emptyList()));
    }

    @Test
    void schemaFilterCaseInsensitive() {
        final List<String> filter = Arrays.asList("dbo", "app");
        assertTrue(SybaseQueryService.matchesSchemaFilter("DBO", filter));
        assertTrue(SybaseQueryService.matchesSchemaFilter("app", filter));
        assertFalse(SybaseQueryService.matchesSchemaFilter("other", filter));
    }

    @Test
    void tableFilterCaseInsensitive() {
        final List<String> filter = Arrays.asList("orders", "customers");
        assertTrue(SybaseQueryService.matchesTableFilter("ORDERS", filter));
        assertFalse(SybaseQueryService.matchesTableFilter("invoices", filter));
        assertTrue(SybaseQueryService.matchesTableFilter("anything", null));
    }

    @Test
    void queryGuardRejectsBeforeOpeningConnection() {
        final SybaseQueryService svc = new SybaseQueryService();
        try {
            svc.query("bogus.host", 5000, "demo", "user", "pwd",
                    "DELETE FROM orders", 5, 100);
        } catch (final SidecarSqlGuard.SqlGuardException e) {
            assertEquals("forbidden_keyword", e.getReason());
            return;
        }
        throw new AssertionError("expected SqlGuardException for DELETE statement");
    }

    @Test
    void queryReturnsErrorShapeOnConnectionFailure() {
        final SybaseQueryService svc = new SybaseQueryService();
        final QueryResponse resp = svc.query(
                "127.0.0.1", 1, "demo", "user", "pwd",
                "SELECT 1", 3, 10);
        assertNotNull(resp);
        assertFalse(resp.ok());
        assertNotNull(resp.error());
        assertEquals(0, resp.rowCount());
        assertFalse(resp.error().contains("pwd"), "password must be masked in error");
    }

    // ----------------------------------------------------------------------
    // Metadata-enrichment contract + per-row mapper seams (spec 2026-05-31,
    // Task Group 1). Pure mappers: primitives in, IntrospectionResponse record
    // out -- NO live JDBC ResultSet. These prove the SEAMS exist and round-trip
    // the new optional fields; the per-group catalog QUERIES land in Groups 2-4.
    // ----------------------------------------------------------------------

    /**
     * {@code mapColumnRow} round-trips the new group-1/2/3 enrichment fields
     * (collation, computed flag + expression, identity flag) verbatim into the
     * {@link IntrospectionResponse.ColumnRow}, alongside the existing
     * structural fields, AND tolerates nulls for all of them (the Group-1
     * query does not yet project them, so the loop passes null today). The
     * boxed {@link Boolean} flags are nullable, so a captured {@code true} is
     * distinct from an unknown {@code null} (never coerced to false).
     */
    @Test
    void mapColumnRowRoundTripsEnrichmentFields() {
        final IntrospectionResponse.ColumnRow row = SybaseQueryService.mapColumnRow(
                "dbo", "orders", "status", "varchar", 20, true, 3,
                "utf8_general_ci_ai", Boolean.TRUE, "upper(raw_status)", Boolean.FALSE);
        assertEquals("dbo", row.schemaName());
        assertEquals("orders", row.tableName());
        assertEquals("status", row.columnName());
        assertEquals("varchar", row.dataType());
        assertEquals(20, row.maxLength());
        assertTrue(row.isNullable());
        assertEquals(3, row.ordinalPosition());
        // The four new enrichment fields carry through verbatim:
        assertEquals("utf8_general_ci_ai", row.collation());
        assertEquals(Boolean.TRUE, row.isComputed());
        assertEquals("upper(raw_status)", row.computedExpression());
        assertEquals(Boolean.FALSE, row.isIdentity());

        // Null-tolerant: the Group-1 loop passes null/null/null/null today.
        final IntrospectionResponse.ColumnRow bare = SybaseQueryService.mapColumnRow(
                "dbo", "orders", "id", "int", 4, false, 1,
                null, null, null, null);
        assertNull(bare.collation());
        assertNull(bare.isComputed());
        assertNull(bare.computedExpression());
        assertNull(bare.isIdentity());
    }

    /**
     * {@code mapKeyIndexKind} + {@code decodeClustered} decode the Sybase
     * {@code sysindexes.status} bitmask: bit 2 = unique, bit 2048 = primary
     * key, bit 16 = clustered. PK takes precedence over a bare unique bit.
     */
    @Test
    void indexStatusBitDecode() {
        assertEquals("index", SybaseQueryService.mapKeyIndexKind(0));
        assertEquals("unique_constraint", SybaseQueryService.mapKeyIndexKind(2));
        assertEquals("primary_key", SybaseQueryService.mapKeyIndexKind(2048));
        // PK + unique bits both set -> still primary_key.
        assertEquals("primary_key", SybaseQueryService.mapKeyIndexKind(2 | 2048));
        assertFalse(SybaseQueryService.decodeClustered(2));
        assertTrue(SybaseQueryService.decodeClustered(16));
        assertTrue(SybaseQueryService.decodeClustered(2 | 16 | 2048));
    }

    /**
     * {@code mapIndexRow} carries the five new group-5 index fields. The
     * clustered flag derives from the status bit by default; the ordering
     * fields ({@code indexDefinition} / {@code indexMethod} /
     * {@code columnDirections}) pass through verbatim; {@code indexPredicate}
     * is ALWAYS null for ASE (no partial indexes ->
     * {@code not_applicable_for_engine} on the discovery side). The
     * {@code isClusteredOverride} argument, when non-null, wins over the
     * status-bit decode.
     */
    @Test
    void mapIndexRowCarriesGroup5Fields() {
        final IntrospectionResponse.KeyRow row = SybaseQueryService.mapIndexRow(
                "dbo", "orders", "ix_orders_customer",
                16,                                   // clustered, non-unique, non-PK
                Arrays.asList("customer_id", "created_at"),
                "CREATE CLUSTERED INDEX ix_orders_customer ON orders(customer_id, created_at)",
                "clustered",
                Arrays.asList("ASC", "DESC"),
                null);                                 // no override -> use the status bit
        assertEquals("index", row.kind());
        assertEquals("ix_orders_customer", row.name());
        assertEquals(Arrays.asList("customer_id", "created_at"), row.columns());
        assertEquals(Boolean.TRUE, row.isClustered());
        assertEquals(
                "CREATE CLUSTERED INDEX ix_orders_customer ON orders(customer_id, created_at)",
                row.indexDefinition());
        assertEquals("clustered", row.indexMethod());
        assertEquals(Arrays.asList("ASC", "DESC"), row.columnDirections());
        // ASE has no filtered / partial indexes -- always absent:
        assertNull(row.indexPredicate());
        // FK-only fields are null on an index row:
        assertNull(row.updateRule());
        assertNull(row.deleteRule());
        assertNull(row.referencedTable());

        // The override wins over the status-bit decode when supplied.
        final IntrospectionResponse.KeyRow overridden = SybaseQueryService.mapIndexRow(
                "dbo", "orders", "ix_plain", 0, Collections.emptyList(),
                null, null, null, Boolean.TRUE);
        assertEquals(Boolean.TRUE, overridden.isClustered());
    }

    /**
     * {@code mapFkRow} carries the new group-4 FK referential actions
     * ({@code updateRule} / {@code deleteRule}) verbatim, and always reports
     * {@code kind = foreign_key} with the referenced schema/table set. Classic
     * ASE FKs are often RESTRICT / NO ACTION and CASCADE is ASE15.7+, so the
     * read is version-tolerant: the seam null-outs cleanly when the query
     * cannot project the actions. The group-5 index fields are null on an FK
     * row.
     */
    @Test
    void mapFkRowCarriesReferentialActions() {
        final IntrospectionResponse.KeyRow row = SybaseQueryService.mapFkRow(
                "dbo", "orders", "fk_123",
                Collections.singletonList("customer_id"),
                "dbo", "customers",
                Collections.singletonList("id"),
                "NO ACTION", "CASCADE");
        assertEquals("foreign_key", row.kind());
        assertEquals("fk_123", row.name());
        assertEquals("customers", row.referencedTable());
        assertEquals(Collections.singletonList("id"), row.referencedColumns());
        // Verbatim referential actions (group 4):
        assertEquals("NO ACTION", row.updateRule());
        assertEquals("CASCADE", row.deleteRule());
        // Index-ordering fields are absent on an FK row:
        assertNull(row.indexDefinition());
        assertNull(row.isClustered());
        assertNull(row.columnDirections());

        // Version-tolerant: a classic ASE FK with no projected actions null-outs.
        final IntrospectionResponse.KeyRow legacy = SybaseQueryService.mapFkRow(
                "dbo", "orders", "fk_legacy",
                Collections.emptyList(), "dbo", "customers", Collections.emptyList(),
                null, null);
        assertNull(legacy.updateRule());
        assertNull(legacy.deleteRule());
    }

    /**
     * {@code synthesizeIdentitySequenceRow} synthesizes the documented
     * identity -> {@code sequences[]} shape (decision 7):
     * {@code sequenceName = "<table>.<col> (identity)"} with
     * {@code ownedByTable} / {@code ownedByColumn} set, so the existing
     * discovery-side {@code sequence_cutover_hazard} Finding fires unchanged.
     * The cheap-path current value carries through when present; when the
     * current value is null (cheap path + {@code MAX(col)} both null, e.g. an
     * empty table) the row still carries the identity keying so the cutover
     * Finding fires marked value-unavailable rather than not firing.
     */
    @Test
    void synthesizeIdentitySequenceRowProducesDocumentedShape() {
        final IntrospectionResponse.SequenceRow seq = SybaseQueryService.synthesizeIdentitySequenceRow(
                "dbo", "orders", "order_id", "int", "10042");
        assertEquals("dbo", seq.schemaName());
        assertEquals("orders.order_id (identity)", seq.sequenceName());
        assertEquals("orders", seq.ownedByTable());
        assertEquals("order_id", seq.ownedByColumn());
        assertEquals("10042", seq.currentValue());
        assertEquals("int", seq.dataType());

        // Null current value is tolerated (keying preserved).
        final IntrospectionResponse.SequenceRow empty = SybaseQueryService.synthesizeIdentitySequenceRow(
                "dbo", "orders", "order_id", "int", null);
        assertEquals("orders.order_id (identity)", empty.sequenceName());
        assertNull(empty.currentValue());
    }

    /**
     * The new top-level contract fields ({@code capabilities},
     * {@code serverVersion}, {@code databaseCollation}) round-trip on the
     * {@link IntrospectionResponse} so the discovery side can bind to them: the
     * {@code capabilities[]} array advertises which groups the build surfaces,
     * the engine-version string carries ASE {@code @@version}, and
     * {@code databaseCollation} carries the DB-level sort order.
     */
    @Test
    void introspectionResponseCarriesTopLevelCapabilityFields() {
        final List<String> caps = new ArrayList<>(Arrays.asList(
                "collation", "computed_columns", "fk_actions", "index_clustering"));
        final IntrospectionResponse resp = new IntrospectionResponse(
                true, null,
                Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
                Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
                Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
                caps,
                "Adaptive Server Enterprise/16.0 SP03",
                "utf8_general_ci_ai");
        assertTrue(resp.ok());
        assertEquals(caps, resp.capabilities());
        assertTrue(resp.capabilities().contains("index_clustering"));
        assertEquals("Adaptive Server Enterprise/16.0 SP03", resp.serverVersion());
        assertEquals("utf8_general_ci_ai", resp.databaseCollation());
    }

    // ----------------------------------------------------------------------
    // Group 2 -- collation / computed columns / FK referential actions
    // (catalog-read-only; the per-row mappers carry the now-projected values).
    // spec 2026-05-31, Task Group 2. Pure mappers + the new status/action
    // decode seams: primitives in, verbatim out, version-tolerant null-out.
    // ----------------------------------------------------------------------

    /**
     * Group 2 (collation): {@code mapColumnRow} carries a verbatim per-column
     * collation/sort-order onto the {@link IntrospectionResponse.ColumnRow}.
     * The value is read from the ASE base catalog (column charset/sort order)
     * and passed through untouched -- a Sybase case-insensitive sort order
     * (e.g. {@code utf8_..._ci_ai}) must reach discovery byte-for-byte so the
     * CI->CS hazard finding fires correctly.
     */
    @Test
    void mapColumnRowCarriesVerbatimCollation() {
        final IntrospectionResponse.ColumnRow ci = SybaseQueryService.mapColumnRow(
                "dbo", "customers", "surname", "varchar", 64, true, 4,
                "utf8_general_ci_ai", null, null, null);
        assertEquals("utf8_general_ci_ai", ci.collation());

        // A different verbatim sort order round-trips unchanged.
        final IntrospectionResponse.ColumnRow bin = SybaseQueryService.mapColumnRow(
                "dbo", "customers", "code", "char", 8, false, 5,
                "bin_iso_1", null, null, null);
        assertEquals("bin_iso_1", bin.collation());
    }

    /**
     * Group 2 (computed columns): {@code isComputedColumnStatus} decodes the
     * ASE {@code syscolumns.status2} computed-column bit ({@code 0x10}).
     * Version-tolerant: a null status2 (older catalog that does not surface
     * the bit) decodes to null (unknown), never a coerced {@code false}.
     */
    @Test
    void computedColumnStatusBitDecode() {
        // 0x10 set -> computed.
        assertEquals(Boolean.TRUE, SybaseQueryService.isComputedColumnStatus(16));
        assertEquals(Boolean.TRUE, SybaseQueryService.isComputedColumnStatus(16 | 1 | 4));
        // bit clear -> not computed.
        assertEquals(Boolean.FALSE, SybaseQueryService.isComputedColumnStatus(0));
        assertEquals(Boolean.FALSE, SybaseQueryService.isComputedColumnStatus(8));
        // null status2 (catalog does not surface it) -> unknown, not false.
        assertNull(SybaseQueryService.isComputedColumnStatus(null));
    }

    /**
     * Group 2 (computed columns): {@code mapColumnRow} carries the computed
     * flag + the VERBATIM expression text (from {@code syscomments}) so a
     * computed column is re-declared as computed downstream, and tolerates a
     * materialized-vs-virtual distinction expressed only via the flag/expr
     * pair (ASE does not always expose a separate materialized signal).
     */
    @Test
    void mapColumnRowCarriesComputedFlagAndExpression() {
        final IntrospectionResponse.ColumnRow computed = SybaseQueryService.mapColumnRow(
                "dbo", "orders", "total_inc_tax", "money", 8, true, 7,
                null, Boolean.TRUE, "qty * unit_price * 1.2", null);
        assertEquals(Boolean.TRUE, computed.isComputed());
        assertEquals("qty * unit_price * 1.2", computed.computedExpression());

        // A non-computed column carries an explicit false + null expression.
        final IntrospectionResponse.ColumnRow plain = SybaseQueryService.mapColumnRow(
                "dbo", "orders", "qty", "int", 4, false, 2,
                null, Boolean.FALSE, null, null);
        assertEquals(Boolean.FALSE, plain.isComputed());
        assertNull(plain.computedExpression());
    }

    /**
     * Group 2 (FK actions): {@code decodeFkAction} maps the ASE referential
     * action codes onto verbatim engine strings and null-outs for an absent /
     * unknown code (version-tolerant -- classic ASE FKs carry no action and
     * CASCADE is ASE15.7+). Code 0 / null both mean "no action recorded".
     */
    @Test
    void fkActionCodeDecode() {
        assertNull(SybaseQueryService.decodeFkAction(null));
        assertNull(SybaseQueryService.decodeFkAction(0));
        assertEquals("CASCADE", SybaseQueryService.decodeFkAction(1));
        assertEquals("SET NULL", SybaseQueryService.decodeFkAction(2));
        assertEquals("SET DEFAULT", SybaseQueryService.decodeFkAction(3));
        assertEquals("NO ACTION", SybaseQueryService.decodeFkAction(4));
        // An unknown / out-of-range code null-outs rather than guessing.
        assertNull(SybaseQueryService.decodeFkAction(99));
    }

    /**
     * Group 2 (FK actions): {@code mapFkRow} carries the decoded referential
     * actions verbatim onto the FK {@link IntrospectionResponse.KeyRow}; the
     * common classic-ASE shape (no actions projected) null-outs cleanly so
     * discovery resolves it to unavailable rather than misreading it.
     */
    @Test
    void mapFkRowCarriesDecodedReferentialActions() {
        // ASE15.7+ FK with CASCADE on delete, NO ACTION on update.
        final IntrospectionResponse.KeyRow modern = SybaseQueryService.mapFkRow(
                "dbo", "order_lines", "fk_42",
                Collections.singletonList("order_id"),
                "dbo", "orders",
                Collections.singletonList("order_id"),
                SybaseQueryService.decodeFkAction(4),   // updateRule -> NO ACTION
                SybaseQueryService.decodeFkAction(1));  // deleteRule -> CASCADE
        assertEquals("NO ACTION", modern.updateRule());
        assertEquals("CASCADE", modern.deleteRule());

        // Classic ASE FK: no action codes -> both null (version-tolerant).
        final IntrospectionResponse.KeyRow classic = SybaseQueryService.mapFkRow(
                "dbo", "order_lines", "fk_legacy",
                Collections.singletonList("order_id"),
                "dbo", "orders",
                Collections.singletonList("order_id"),
                SybaseQueryService.decodeFkAction(null),
                SybaseQueryService.decodeFkAction(0));
        assertNull(classic.updateRule());
        assertNull(classic.deleteRule());
    }

    // ----------------------------------------------------------------------
    // Group 3 -- identity synthesis + cheap-vs-MAX current-value selection +
    // ASE16 native SEQUENCE version-branch + index ordering/clustering.
    // spec 2026-05-31, Task Group 3. The MAX(col) fallback is tested at the
    // SELECTION level (not a live scan); the synthesis + version-branch +
    // index decode are pure.
    // ----------------------------------------------------------------------

    /**
     * Group 3 (current-value selection): {@code resolveCurrentValue} picks the
     * cheap-path value when it is present and only signals the {@code MAX(col)}
     * scan when the cheap value is null. Tests the SELECTION logic, never a
     * live scan -- the predicate {@code shouldScanForCurrentValue} is the gate
     * the JDBC fallback consults.
     */
    @Test
    void currentValueSelectionPrefersCheapPathThenScans() {
        // Cheap value present -> use it verbatim, no scan needed.
        assertEquals("10042", SybaseQueryService.resolveCurrentValue("10042", "99999"));
        assertFalse(SybaseQueryService.shouldScanForCurrentValue("10042"));

        // Cheap value null -> fall back to the MAX(col) scan value.
        assertEquals("99999", SybaseQueryService.resolveCurrentValue(null, "99999"));
        assertTrue(SybaseQueryService.shouldScanForCurrentValue(null));

        // Both null (e.g. empty table) -> null is tolerated end to end.
        assertNull(SybaseQueryService.resolveCurrentValue(null, null));
        assertTrue(SybaseQueryService.shouldScanForCurrentValue(null));

        // A blank cheap value is treated as absent so the scan fills it.
        assertTrue(SybaseQueryService.shouldScanForCurrentValue("   "));
        assertEquals("500", SybaseQueryService.resolveCurrentValue("  ", "500"));
    }

    /**
     * Group 3 (identity synthesis end to end): an IDENTITY column synthesizes
     * the documented {@code sequences[]} shape carrying the cheap-or-scan
     * current value resolved by {@code resolveCurrentValue}, so the discovery
     * {@code sequence_cutover_hazard} Finding fires with the high-water mark.
     */
    @Test
    void identitySynthesisCarriesResolvedCurrentValue() {
        // Cheap path null, MAX(col) scan returned 777 -> synthesized value 777.
        final String resolved = SybaseQueryService.resolveCurrentValue(null, "777");
        final IntrospectionResponse.SequenceRow seq =
                SybaseQueryService.synthesizeIdentitySequenceRow(
                        "dbo", "invoices", "invoice_id", "numeric", resolved);
        assertEquals("invoices.invoice_id (identity)", seq.sequenceName());
        assertEquals("invoices", seq.ownedByTable());
        assertEquals("invoice_id", seq.ownedByColumn());
        assertEquals("777", seq.currentValue());
    }

    /**
     * Group 3 (ASE16 native SEQUENCE version branch): {@code supportsNativeSequenceCatalog}
     * returns true only for ASE16-and-up version strings; a pre-ASE16 / absent
     * version string returns false so the native-sequence catalog read is
     * SKIPPED (null-out) rather than hard-erroring against a catalog object
     * that does not exist on the older engine.
     */
    @Test
    void nativeSequenceCatalogIsVersionBranched() {
        assertTrue(SybaseQueryService.supportsNativeSequenceCatalog(
                "Adaptive Server Enterprise/16.0 SP03 PL07"));
        assertTrue(SybaseQueryService.supportsNativeSequenceCatalog(
                "Adaptive Server Enterprise/16.5/EBF"));
        // Pre-ASE16 -> not supported (SEQUENCE catalog absent).
        assertFalse(SybaseQueryService.supportsNativeSequenceCatalog(
                "Adaptive Server Enterprise/15.7 SP138"));
        assertFalse(SybaseQueryService.supportsNativeSequenceCatalog(
                "Adaptive Server Enterprise/15.0.3"));
        // Absent / unparseable version -> degrade gracefully to not-supported.
        assertFalse(SybaseQueryService.supportsNativeSequenceCatalog(null));
        assertFalse(SybaseQueryService.supportsNativeSequenceCatalog("unknown"));
    }

    /**
     * Group 5 (index ordering / clustering): {@code mapIndexRow} populates
     * {@code isClustered} from the status bit, carries the per-column ASC/DESC
     * {@code columnDirections} aligned to {@code columns[]}, and a derived
     * {@code indexDefinition} + {@code indexMethod}. The
     * {@code buildIndexDefinition} helper assembles a verbatim-ish CREATE INDEX
     * shape from the decoded parts.
     */
    @Test
    void indexOrderingAndClusteringDecode() {
        final String def = SybaseQueryService.buildIndexDefinition(
                "ix_orders_cust", "orders", true, false,
                Arrays.asList("customer_id", "created_at"),
                Arrays.asList("ASC", "DESC"));
        // Clustered + the two columns with their directions appear verbatim.
        assertTrue(def.contains("CLUSTERED"));
        assertTrue(def.contains("ix_orders_cust"));
        assertTrue(def.contains("customer_id ASC"));
        assertTrue(def.contains("created_at DESC"));

        final IntrospectionResponse.KeyRow row = SybaseQueryService.mapIndexRow(
                "dbo", "orders", "ix_orders_cust",
                16,                                  // clustered, non-unique, non-PK
                Arrays.asList("customer_id", "created_at"),
                def,
                "clustered",
                Arrays.asList("ASC", "DESC"),
                null);
        assertEquals(Boolean.TRUE, row.isClustered());
        assertEquals(Arrays.asList("ASC", "DESC"), row.columnDirections());
        assertEquals("clustered", row.indexMethod());
        assertEquals(def, row.indexDefinition());
        // ASE has no partial indexes -- predicate is always absent.
        assertNull(row.indexPredicate());

        // A nonclustered unique index reports method=nonclustered + UNIQUE.
        final String ncDef = SybaseQueryService.buildIndexDefinition(
                "ix_plain", "orders", false, true,
                Collections.singletonList("email"),
                Collections.singletonList("ASC"));
        assertTrue(ncDef.contains("NONCLUSTERED"));
        assertTrue(ncDef.contains("UNIQUE"));
    }

    // ----------------------------------------------------------------------
    // Group 4 -- DB-resident jobs projection.
    // spec 2026-05-31, Task Group 4. The jobs per-row mapper is pure; the
    // guard allowlist is covered in SidecarSqlGuardTest.
    // ----------------------------------------------------------------------

    /**
     * Group 4 (jobs): {@code mapScheduledJobRow} projects the Job Scheduler row
     * (name + verbatim schedule + verbatim command + enabled) onto a
     * {@link IntrospectionResponse.ScheduledJobRow}, so each becomes a
     * {@code db_resident_scheduled_job} Finding downstream. Schedule + command
     * are kept byte-for-byte (a cron-like schedule and multi-line command).
     */
    @Test
    void mapScheduledJobRowProjectsVerbatim() {
        final IntrospectionResponse.ScheduledJobRow job = SybaseQueryService.mapScheduledJobRow(
                "dbo", "nightly_reindex", "sybase_job_scheduler",
                "0 2 * * *",
                "exec sp_recompile 'orders'\nupdate statistics orders",
                Boolean.TRUE);
        assertEquals("nightly_reindex", job.jobName());
        assertEquals("sybase_job_scheduler", job.scheduler());
        assertEquals("0 2 * * *", job.schedule());
        assertEquals("exec sp_recompile 'orders'\nupdate statistics orders", job.command());
        assertEquals(Boolean.TRUE, job.enabled());

        // A disabled job with no schedule still projects (enabled=false).
        final IntrospectionResponse.ScheduledJobRow disabled = SybaseQueryService.mapScheduledJobRow(
                "dbo", "adhoc_purge", "sybase_job_scheduler", null, "delete from audit_log", Boolean.FALSE);
        assertEquals(Boolean.FALSE, disabled.enabled());
        assertNull(disabled.schedule());
    }

    // ----------------------------------------------------------------------
    // Test doubles
    // ----------------------------------------------------------------------

    /**
     * In-memory driver strategy used to exercise the auto-mode resolution
     * without touching a real JDBC stack. When {@code succeed=false} the
     * strategy throws on {@link #openConnection}. When {@code succeed=true}
     * it returns a minimal proxy Connection that fails on createStatement
     * (we only need to assert the strategy-resolution path, not the SQL
     * execution path).
     */
    private static final class FakeStrategy implements DriverStrategy {
        private final String name;
        private final boolean available;
        private final boolean succeed;

        FakeStrategy(final String name, final boolean available, final boolean succeed) {
            this.name = name;
            this.available = available;
            this.succeed = succeed;
        }

        @Override
        public String name() {
            return this.name;
        }

        @Override
        public boolean isAvailable() {
            return this.available;
        }

        @Override
        public String buildJdbcUrl(final String host, final int port, final String database) {
            return "jdbc:fake:" + this.name + "://" + host + ":" + port + "/" + database;
        }

        @Override
        public Connection openConnection(
                final String host, final int port, final String database,
                final String username, final String password
        ) throws SQLException {
            if (!this.available) {
                throw new SQLException(this.name + " unavailable");
            }
            if (!this.succeed) {
                throw new SQLException(this.name + " login failed (fake)");
            }
            return (Connection) java.lang.reflect.Proxy.newProxyInstance(
                    Connection.class.getClassLoader(),
                    new Class<?>[] { Connection.class },
                    (proxy, method, args) -> {
                        switch (method.getName()) {
                            case "isClosed": return Boolean.FALSE;
                            case "close": return null;
                            case "setReadOnly":
                            case "setAutoCommit":
                                return null;
                            default:
                                throw new SQLException("FakeConnection does not implement " + method.getName());
                        }
                    }
            );
        }
    }
}
