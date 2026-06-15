package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Types;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Hotfix #3 regression + audit tests for {@link ArchitectureCloneService}.
 *
 * <h2>Bug recap (Hotfix #3 — JPA persistence-context flush)</h2>
 *
 * <p>{@code ArchitectureCloneService} previously used
 * {@link ArchitectureRepository#save} to persist the new architecture row,
 * then immediately followed up with raw {@link JdbcTemplate#batchUpdate}
 * INSERTs against {@code model_files} (and every other in-scope table)
 * whose {@code architecture_id} FK references the just-persisted row. JPA
 * defers the SQL INSERT until commit time when {@code save} is used —
 * Hibernate only places the entity in the persistence context. PostgreSQL's
 * FK check fires on the very first raw JDBC INSERT and the architecture
 * row is not yet in the database, producing:</p>
 *
 * <pre>{@code
 * ERROR: insert or update on table "model_files" violates foreign key
 *   constraint "fk_model_files_architecture"
 *   Detail: Key (architecture_id)=(<new-arch-id>) is not present in
 *   table "architecture".
 * }</pre>
 *
 * <p>The fix replaces {@code save} with {@code saveAndFlush} for both the
 * architecture row and the architecture tag rows, forcing Hibernate to
 * issue the SQL INSERTs immediately so the raw JDBC layer can see them
 * inside the same transaction.</p>
 *
 * <h2>Why H2 didn't catch this</h2>
 *
 * <p>H2 in PostgreSQL mode (used by the existing
 * {@code ArchitectureCloneIntegrationTest}) does not enforce
 * cross-statement FK timing strictly inside a single session — the test
 * connection sees the JPA-pending insert through the same connection
 * pool. Production PostgreSQL is the authoritative semantic; this
 * regression is therefore mock-driven so it remains portable across the
 * H2 fixture.</p>
 *
 * <h2>Tests</h2>
 *
 * <ol>
 *   <li>{@link #testSaveAndFlushIsCalledBeforeRawJdbcInsert()} — the
 *       load-bearing regression. Asserts that {@code saveAndFlush} is
 *       invoked on {@link ArchitectureRepository} BEFORE any
 *       {@link JdbcTemplate#batchUpdate} call fires, and that {@code save}
 *       is NEVER invoked (the legacy buggy code path must not reappear).</li>
 *   <li>{@link #testTagsFlushedBeforeRawJdbcWhenTagsPresent()} —
 *       defence-in-depth: when the clone payload includes tag rows, the
 *       tag repository is also flushed before any raw JDBC INSERT runs,
 *       so a future migration that adds an FK from any in-scope table to
 *       {@code architecture_tag} won't reintroduce the same class of bug.</li>
 *   <li>{@link #testInScopeTablesAreInDependencyOrder()} — Hotfix #3
 *       audit: the {@code IN_SCOPE_TABLES_IN_ORDER} list is verified to
 *       satisfy every known cross-table FK dependency in the in-scope
 *       set. Specifically: {@code services.package_set_id ->
 *       package_sets}, {@code endpoints.request_data_entity_point_id +
 *       endpoints.response_data_entity_point_id -> data_entity_points},
 *       {@code ui_actions.contract_id -> ui_contracts}, and
 *       {@code activity_steps.application_id -> applications} (plus
 *       {@code business_user_id}, {@code process_activity_id},
 *       {@code user_journey_id}). Pre-fix, all four FK targets came AFTER
 *       their references in the table list, leaving the FK columns
 *       unrewired (the cloned row silently kept the source-architecture's
 *       parent id, satisfying the FK against the source row but breaking
 *       the conceptual isolation of the cloned architecture).</li>
 * </ol>
 *
 * @see ArchitectureCloneService
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCloneServiceHotfix3Test {

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private DataSource dataSource;

    @Mock
    private Connection connection;

    @Mock
    private DatabaseMetaData databaseMetaData;

    private ArchitectureMapper architectureMapper;
    private ArchitectureService architectureService;
    private ArchitectureCloneService cloneService;

    @BeforeEach
    void setUp() throws Exception {
        architectureMapper = new ArchitectureMapper();
        architectureService = new ArchitectureService(
            architectureRepository,
            architectureTagRepository,
            architectureMapper);
        cloneService = new ArchitectureCloneService(
            architectureRepository,
            architectureTagRepository,
            architectureMapper,
            architectureService,
            jdbcTemplate);

        lenient().when(jdbcTemplate.getDataSource()).thenReturn(dataSource);
        lenient().when(dataSource.getConnection()).thenReturn(connection);
        lenient().when(connection.getMetaData()).thenReturn(databaseMetaData);
        lenient().when(databaseMetaData.getColumns(any(), any(), anyString(), any()))
            .thenAnswer(inv -> emptyColumnsResultSet());
        lenient().when(jdbcTemplate.batchUpdate(anyString(),
                org.mockito.ArgumentMatchers.<List<Object[]>>any()))
            .thenReturn(new int[]{1});
    }

    /**
     * <b>Load-bearing regression for Hotfix #3.</b>
     *
     * <p>Asserts:</p>
     * <ol>
     *   <li>{@code saveAndFlush} is invoked at least once on
     *       {@link ArchitectureRepository} (the new behaviour).</li>
     *   <li>{@code save} (the buggy behaviour) is NEVER invoked.</li>
     *   <li>{@code saveAndFlush} happens BEFORE any raw JDBC
     *       {@link JdbcTemplate#batchUpdate} fires (the load-bearing
     *       ordering guarantee — without it PG rejects the first insert
     *       with {@code fk_model_files_architecture}).</li>
     * </ol>
     *
     * <p>Mock {@code model_files} to have one row so the SELECT + first
     * batchUpdate path actually executes, otherwise we'd be asserting
     * ordering against a no-op JDBC call.</p>
     */
    @Test
    @DisplayName("Hotfix #3: saveAndFlush is called and precedes any raw JDBC batchUpdate")
    void testSaveAndFlushIsCalledBeforeRawJdbcInsert() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID sourceArchitectureId = UUID.randomUUID();

        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Source")
            .archived(false)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(source));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(
                eq(projectId), anyString()))
            .thenReturn(false);
        when(architectureRepository.saveAndFlush(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of());

        // Mock model_files with id + architecture_id so the discoverer
        // produces a clone-able schema and at least one batchUpdate fires.
        when(databaseMetaData.getColumns(any(), any(), eq("model_files"), any()))
            .thenAnswer(inv -> mockMinimalModelFilesColumns());

        Map<String, Object> existingRow = new HashMap<>();
        existingRow.put("id", UUID.randomUUID().toString());
        existingRow.put("architecture_id", sourceArchitectureId);
        when(jdbcTemplate.queryForList(anyString(), any(Object.class)))
            .thenReturn(List.of(existingRow));

        // ----- Act -----
        cloneService.cloneArchitecture(
            projectId, sourceArchitectureId, "Cloned Hotfix3", null, null);

        // ----- Assert: saveAndFlush is called; save is never called -----
        verify(architectureRepository, atLeastOnce()).saveAndFlush(any(ArchitectureEntity.class));
        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));

        // ----- Assert: saveAndFlush precedes any raw JDBC batchUpdate -----
        // InOrder over the two mocks captures the temporal ordering of
        // the JPA flush and the first raw JDBC INSERT — this is the
        // load-bearing guarantee that prevents the
        // fk_model_files_architecture violation in production PG.
        InOrder ordering = inOrder(architectureRepository, jdbcTemplate);
        ordering.verify(architectureRepository).saveAndFlush(any(ArchitectureEntity.class));
        ordering.verify(jdbcTemplate, atLeastOnce()).batchUpdate(anyString(),
            org.mockito.ArgumentMatchers.<List<Object[]>>any());
    }

    /**
     * Defence-in-depth (no live bug today): when tags are supplied, the
     * tag repository is flushed BEFORE any raw JDBC fires. Today no
     * in-scope table has an FK into {@code architecture_tag}, but a
     * future migration could add one (e.g. a "tag-scoped diagram filter"
     * row); without the flush, that future migration would silently
     * reintroduce the same JPA-vs-JDBC visibility class of bug.
     */
    @Test
    @DisplayName("Hotfix #3: tag repository is flushed before any raw JDBC batchUpdate when tags are supplied")
    void testTagsFlushedBeforeRawJdbcWhenTagsPresent() throws Exception {
        UUID projectId = UUID.randomUUID();
        UUID sourceArchitectureId = UUID.randomUUID();

        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Source")
            .archived(false)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(source));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(
                eq(projectId), anyString()))
            .thenReturn(false);
        when(architectureRepository.saveAndFlush(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of());

        when(databaseMetaData.getColumns(any(), any(), eq("model_files"), any()))
            .thenAnswer(inv -> mockMinimalModelFilesColumns());

        Map<String, Object> existingRow = new HashMap<>();
        existingRow.put("id", UUID.randomUUID().toString());
        existingRow.put("architecture_id", sourceArchitectureId);
        when(jdbcTemplate.queryForList(anyString(), any(Object.class)))
            .thenReturn(List.of(existingRow));

        cloneService.cloneArchitecture(
            projectId, sourceArchitectureId, "With Tags",
            null, List.of("alpha", "beta"));

        // Assert: tag repository.flush() is called, AND it precedes any raw
        // JDBC batchUpdate (defence-in-depth — same reasoning as the
        // architecture repo flush).
        InOrder ordering = inOrder(architectureTagRepository, jdbcTemplate);
        ordering.verify(architectureTagRepository, atLeastOnce()).flush();
        ordering.verify(jdbcTemplate, atLeastOnce()).batchUpdate(anyString(),
            org.mockito.ArgumentMatchers.<List<Object[]>>any());
    }

    /**
     * Hotfix #3 dependency-ordering audit. Verifies that for every known
     * cross-table FK in the in-scope set, the FK target table appears in
     * {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER} BEFORE
     * the table that references it. Without this guarantee, the cloned
     * dependent row's FK column is left holding the source row's id
     * (because the parent's id-mapping isn't in the rewire map yet), and
     * either:
     * <ul>
     *   <li>silently rewires to the source architecture's parent (clone
     *       fails the conceptual isolation invariant), or</li>
     *   <li>(for selective copy where the source row may not exist in
     *       the target architecture) hits the FK constraint with
     *       {@code violates foreign key constraint fk_<dep>_<parent>}.</li>
     * </ul>
     *
     * <p>The pairs tested are sourced from a sweep of every {@code
     * REFERENCES} clause in the changeset SQL files for in-scope tables.
     * If a future migration adds a new cross-table FK, that pair must
     * also be added to this audit.</p>
     */
    @Test
    @DisplayName("Hotfix #3 audit: IN_SCOPE_TABLES_IN_ORDER respects every known cross-table FK dependency")
    void testInScopeTablesAreInDependencyOrder() {
        List<String> order = ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER;
        Map<String, Integer> position = new HashMap<>();
        for (int i = 0; i < order.size(); i++) {
            position.put(order.get(i), i);
        }

        // Sanity: every table is unique in the ordering (no duplicates).
        Set<String> uniqueTables = new HashSet<>(order);
        assertThat(uniqueTables)
            .as("IN_SCOPE_TABLES_IN_ORDER must have no duplicate entries")
            .hasSize(order.size());

        // Pairs of (parent, child) — child references parent's id; parent
        // MUST appear before child in the ordering. Sourced from a sweep
        // of every REFERENCES clause across schema.sql + changeset SQL
        // files for in-scope tables.
        Map<String, List<String>> requiredOrdering = new java.util.LinkedHashMap<>();
        // model_files is the root — every other in-scope table references it.
        requiredOrdering.put("model_files", List.of(
            "business_users", "business_processes", "process_activities",
            "business_points", "business_logics", "user_journeys",
            "applications", "application_components", "services", "interfaces",
            "endpoints", "application_points", "classes", "methods",
            "package_sets", "packages", "package_set_default_rules",
            "package_set_standards_import_status",
            "logical_data_entities", "logical_data_attributes",
            "physical_data_entities", "physical_data_attributes",
            "data_entity_points",
            "app_business_points", "interactions",
            "events", "states", "activities", "activity_partitions",
            "sequence_diagrams",
            "ui_screens", "ui_components", "ui_contracts", "ui_actions",
            "ui_characteristics",
            "diagrams", "diagram_nodes", "diagram_decorations",
            "business_user_business_points", "application_point_business_points",
            "application_point_business_logics", "user_journey_links",
            "activity_steps",
            "logical_data_entity_relationships",
            "logical_data_entity_physical_data_entities",
            "logical_data_attribute_physical_data_attributes",
            "data_movements", "interface_logical_entities",
            "state_transitions", "activity_flows",
            "sequence_participants", "sequence_messages", "sequence_fragments",
            "sequence_operands", "sequence_nodes",
            "ui_workflow_transitions",
            "diagram_edges", "diagram_interaction_edges"
        ));
        // Hotfix #3: services -> package_sets.
        requiredOrdering.put("package_sets", List.of(
            "services", "packages", "package_set_default_rules",
            "package_set_standards_import_status"));
        // Hotfix #3: endpoints -> data_entity_points (request +
        // response FK columns); data_entity_points -> logical_data_entities
        // and physical_data_entities.
        requiredOrdering.put("data_entity_points", List.of("endpoints"));
        requiredOrdering.put("logical_data_entities", List.of(
            "data_entity_points", "logical_data_attributes",
            "logical_data_entity_relationships",
            "logical_data_entity_physical_data_entities",
            "interface_logical_entities"));
        requiredOrdering.put("physical_data_entities", List.of(
            "data_entity_points", "physical_data_attributes",
            "logical_data_entity_physical_data_entities"));
        requiredOrdering.put("logical_data_attributes", List.of(
            "logical_data_attribute_physical_data_attributes"));
        requiredOrdering.put("physical_data_attributes", List.of(
            "logical_data_attribute_physical_data_attributes"));
        // Hotfix #3: ui_actions -> ui_contracts (contract_id FK).
        requiredOrdering.put("ui_contracts", List.of("ui_actions"));
        // Hotfix #3: activity_steps -> applications + business_users +
        // process_activities + user_journeys.
        requiredOrdering.put("applications", List.of(
            "application_components", "services", "application_points",
            "activity_steps"));
        requiredOrdering.put("business_users", List.of(
            "interactions", "user_journeys", "business_user_business_points",
            "activity_steps"));
        requiredOrdering.put("process_activities", List.of(
            "business_points", "activity_steps"));
        requiredOrdering.put("user_journeys", List.of(
            "user_journey_links", "activity_steps"));
        // Other intra-domain dependencies for completeness.
        requiredOrdering.put("business_processes", List.of(
            "process_activities", "business_points", "user_journeys"));
        requiredOrdering.put("application_components", List.of(
            "services", "application_points"));
        requiredOrdering.put("services", List.of(
            "interfaces", "application_points", "classes"));
        requiredOrdering.put("interfaces", List.of(
            "endpoints", "application_points", "interface_logical_entities"));
        requiredOrdering.put("application_points", List.of(
            "classes", "ui_screens", "data_movements",
            "application_point_business_points",
            "application_point_business_logics"));
        requiredOrdering.put("classes", List.of("methods"));
        requiredOrdering.put("package_sets", List.of(
            "services", "packages", "package_set_default_rules",
            "package_set_standards_import_status"));
        requiredOrdering.put("business_points", List.of(
            "business_user_business_points",
            "application_point_business_points"));
        requiredOrdering.put("business_logics", List.of(
            "application_point_business_logics"));
        requiredOrdering.put("app_business_points", List.of("interactions"));
        requiredOrdering.put("states", List.of("state_transitions"));
        requiredOrdering.put("activities", List.of("activity_flows"));
        requiredOrdering.put("sequence_diagrams", List.of(
            "sequence_participants", "sequence_messages",
            "sequence_fragments", "sequence_operands", "sequence_nodes"));
        requiredOrdering.put("sequence_participants", List.of(
            "sequence_messages"));
        requiredOrdering.put("sequence_fragments", List.of(
            "sequence_operands", "sequence_nodes"));
        requiredOrdering.put("sequence_messages", List.of("sequence_nodes"));
        requiredOrdering.put("sequence_operands", List.of("sequence_nodes"));
        requiredOrdering.put("ui_screens", List.of(
            "ui_workflow_transitions", "ui_actions"));
        requiredOrdering.put("ui_components", List.of("ui_actions"));
        requiredOrdering.put("diagrams", List.of(
            "diagram_nodes", "diagram_edges", "diagram_interaction_edges",
            "diagram_decorations"));
        requiredOrdering.put("interactions", List.of("diagram_interaction_edges"));

        for (Map.Entry<String, List<String>> entry : requiredOrdering.entrySet()) {
            String parent = entry.getKey();
            assertThat(position)
                .as("parent table '%s' must be present in IN_SCOPE_TABLES_IN_ORDER", parent)
                .containsKey(parent);
            int parentIdx = position.get(parent);
            for (String child : entry.getValue()) {
                assertThat(position)
                    .as("child table '%s' must be present in IN_SCOPE_TABLES_IN_ORDER", child)
                    .containsKey(child);
                int childIdx = position.get(child);
                assertThat(parentIdx)
                    .as("FK ordering: parent '%s' (idx %d) must precede child '%s' (idx %d) "
                        + "— see Hotfix #3 audit. Pre-fix violations: services<-package_sets, "
                        + "endpoints<-data_entity_points, ui_actions<-ui_contracts, "
                        + "activity_steps<-applications.",
                        parent, parentIdx, child, childIdx)
                    .isLessThan(childIdx);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Test scaffolding
    // -----------------------------------------------------------------------

    private ResultSet emptyColumnsResultSet() throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.next()).thenReturn(false);
        return rs;
    }

    /**
     * Returns a ResultSet describing the minimal model_files schema needed
     * for the clone path to fire at least one batchUpdate:
     *   id              TEXT (Types.VARCHAR)
     *   architecture_id UUID (Types.OTHER, TYPE_NAME = "uuid")
     */
    private ResultSet mockMinimalModelFilesColumns() throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.next()).thenReturn(true, true, false);
        when(rs.getString("COLUMN_NAME"))
            .thenReturn("id", "architecture_id");
        when(rs.getInt("DATA_TYPE"))
            .thenReturn(Types.VARCHAR, Types.OTHER);
        when(rs.getString("TYPE_NAME"))
            .thenReturn("text", "uuid");
        return rs;
    }
}
