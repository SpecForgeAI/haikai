package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashSet;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for {@link ArchitectureScopeResolver}.
 *
 * <p>Focused on the resolver's public surface — 5 highly targeted tests per
 * the spec's "2-8 tests maximum" budget. The full per-table substitution
 * behaviour is exercised by the integration tests in
 * {@code ArchitectureElementInventoryServiceLeafDriftTest} and
 * {@code ArchitectureSelectiveCopyLeafDriftTest}.</p>
 *
 * <p>Spec: 2026-05-22-architecture-scope-via-parent-not-leaf — Task Group 1.</p>
 */
class ArchitectureScopeResolverTest {

    /**
     * Test (a): model_file_id-chained table produces the expected JOIN.
     *
     * <p>Picks a representative table from the model_file_id chain
     * (logical_data_entities — the data-domain table whose drift was
     * the original bug trigger). Asserts the SELECT clause format byte
     * for byte so callers can rely on it being parameterised on
     * architecture_id with a single bind.</p>
     */
    @Test
    @DisplayName("(a) model_file_id-chained table produces JOIN model_files clause")
    void modelFileChainedTableProducesExpectedJoinClause() {
        String sql = ArchitectureScopeResolver.buildScopedSelectClause(
            "logical_data_entities", "id, name");
        assertThat(sql).isEqualTo(
            "SELECT id, name FROM logical_data_entities t "
                + "JOIN model_files p ON p.id = t.model_file_id "
                + "WHERE p.architecture_id = ?");
    }

    /**
     * Test (b): sequence_diagram_id-chained table produces the equivalent
     * join against sequence_diagrams.
     */
    @Test
    @DisplayName("(b) sequence_diagram_id-chained table produces JOIN sequence_diagrams clause")
    void sequenceDiagramChainedTableProducesExpectedJoinClause() {
        String sql = ArchitectureScopeResolver.buildScopedSelectClause(
            "sequence_participants", "id, name");
        assertThat(sql).isEqualTo(
            "SELECT id, name FROM sequence_participants t "
                + "JOIN sequence_diagrams p ON p.id = t.sequence_diagram_id "
                + "WHERE p.architecture_id = ?");
    }

    /**
     * Test (c): fragment_id-chained table (the sole resident of this
     * chain, sequence_operands) produces the equivalent join against
     * sequence_fragments.
     */
    @Test
    @DisplayName("(c) fragment_id-chained table produces JOIN sequence_fragments clause")
    void fragmentChainedTableProducesExpectedJoinClause() {
        String sql = ArchitectureScopeResolver.buildScopedSelectClause(
            "sequence_operands", "id");
        assertThat(sql).isEqualTo(
            "SELECT id FROM sequence_operands t "
                + "JOIN sequence_fragments p ON p.id = t.fragment_id "
                + "WHERE p.architecture_id = ?");
    }

    /**
     * Test (d): unknown table fails loud with the exact
     * IllegalArgumentException message demanded by the spec.
     *
     * <p>This is a programmer-error guard rail — a future in-scope table
     * that someone forgot to add to the resolver map MUST fail at
     * runtime rather than silently returning empty results.</p>
     */
    @Test
    @DisplayName("(d) unknown table throws IllegalArgumentException with the spec'd message")
    void unknownTableThrowsWithSpecMessage() {
        assertThatThrownBy(() ->
                ArchitectureScopeResolver.buildScopedSelectClause(
                    "some_future_unmapped_table", "id"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("No architecture-scope parent registered for table: some_future_unmapped_table");
    }

    /**
     * Test (e): every entry in
     * {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER} that is
     * an architecture-scoped element table has a matching parent entry
     * in the resolver — no missing entries.
     *
     * <p>Tables explicitly out-of-scope per the spec's "out of scope"
     * section ({@code model_files}, {@code temporary_diagrams}) are
     * excluded from this check: they hold {@code architecture_id} (or
     * {@code project_id}) directly so the leaf path IS canonical for
     * them.</p>
     *
     * <p>This test is the load-bearing safety check — if a new in-scope
     * table is added to {@code IN_SCOPE_TABLES_IN_ORDER} without a
     * matching parent entry, this fails at the CI gate.</p>
     */
    @Test
    @DisplayName("(e) every IN_SCOPE element table (minus the documented out-of-scope two) is in the resolver")
    void inScopeTablesAllHaveParentEntries() {
        // Tables that are intentionally out of scope per the spec — the
        // leaf column IS canonical for them.
        Set<String> outOfScope = Set.of("model_files", "temporary_diagrams");
        Set<String> registered = ArchitectureScopeResolver.registeredTables();

        Set<String> missing = new HashSet<>();
        for (String table : ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER) {
            if (outOfScope.contains(table)) {
                continue;
            }
            if (!registered.contains(table)) {
                missing.add(table);
            }
        }
        assertThat(missing)
            .as("IN_SCOPE_TABLES_IN_ORDER entries with no parent-link registered")
            .isEmpty();
    }

    /**
     * Test (f): the grouped-count builder routes the count through the
     * parent chain for a model-file-anchored supertype table that has NO
     * leaf {@code architecture_id} column at all
     * ({@code infrastructure_points}). This is the exact shape that replaced
     * the {@code SELECT architecture_id, COUNT(*) FROM infrastructure_points
     * WHERE architecture_id IN (?)} query that raised
     * {@code column "architecture_id" does not exist} on PostgreSQL.
     */
    @Test
    @DisplayName("(f) grouped-count builder routes infrastructure_points through the model_files parent chain")
    void groupedCountClauseRoutesThroughParentChain() {
        String sql = ArchitectureScopeResolver.buildScopedGroupedCountClause(
            "infrastructure_points", 1);
        assertThat(sql).isEqualTo(
            "SELECT p.architecture_id AS architecture_id, COUNT(*) AS element_count"
                + " FROM infrastructure_points t"
                + " JOIN model_files p ON p.id = t.model_file_id"
                + " WHERE p.architecture_id IN (?)"
                + " GROUP BY p.architecture_id");
    }

    /**
     * Test (g): the grouped-count builder emits one comma-separated bind
     * placeholder per requested architecture id, so a batched
     * {@code IN (?, ?, ?)} list binds correctly.
     */
    @Test
    @DisplayName("(g) grouped-count builder emits one placeholder per architecture id")
    void groupedCountClauseEmitsOnePlaceholderPerArchitectureId() {
        String sql = ArchitectureScopeResolver.buildScopedGroupedCountClause(
            "application_components", 3);
        assertThat(sql).contains("WHERE p.architecture_id IN (?, ?, ?)");
        assertThat(sql).startsWith(
            "SELECT p.architecture_id AS architecture_id, COUNT(*) AS element_count"
                + " FROM application_components t"
                + " JOIN model_files p ON p.id = t.model_file_id");
    }

    /**
     * Test (h): the grouped-count builder applies the same loud
     * unknown-table guard as the other builders.
     */
    @Test
    @DisplayName("(h) grouped-count builder throws on an unregistered table")
    void groupedCountClauseThrowsOnUnknownTable() {
        assertThatThrownBy(() ->
                ArchitectureScopeResolver.buildScopedGroupedCountClause(
                    "some_future_unmapped_table", 1))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("No architecture-scope parent registered for table: some_future_unmapped_table");
    }

    /**
     * Test (i): a non-positive placeholder count is rejected so the builder
     * never emits a malformed {@code IN ()} expression.
     */
    @Test
    @DisplayName("(i) grouped-count builder rejects a non-positive placeholder count")
    void groupedCountClauseRejectsNonPositiveCount() {
        assertThatThrownBy(() ->
                ArchitectureScopeResolver.buildScopedGroupedCountClause(
                    "infrastructure_points", 0))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("architectureIdCount must be >= 1");
    }
}
