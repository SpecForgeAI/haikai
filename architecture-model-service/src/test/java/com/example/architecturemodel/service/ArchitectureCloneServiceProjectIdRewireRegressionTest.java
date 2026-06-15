package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Types;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression tests for Hotfix #2: {@link ArchitectureCloneService} was
 * silently rewriting {@code project_id} to the new architecture id when the
 * source architecture's UUID happened to equal a project UUID.
 *
 * <h2>Bug recap</h2>
 *
 * <p>Spec #1's deterministic Default-architecture rule guarantees that
 * {@code architecture.id == project.id} for every auto-created Default
 * architecture. The clone service (line ~440 of
 * {@link ArchitectureCloneService} pre-fix) defensively pre-seeded the
 * old-to-new id map with {@code sourceArchId -> newArchId}. The two-pass
 * column rewriter then iterated every column of every row — and any
 * {@code project_id} column whose value happened to equal the source
 * architecture id was treated as an FK reference and silently rewritten
 * to the new architecture id. Production PostgreSQL surfaced this as:</p>
 *
 * <pre>{@code
 * ERROR: insert or update on table "model_files" violates foreign key
 *   constraint "fk_model_files_project"
 *   Detail: Key (project_id)=(...) is not present in table "project".
 * }</pre>
 *
 * <h2>Tests</h2>
 *
 * <ol>
 *   <li>{@link #testProjectIdPreservedWhenSourceArchIdEqualsProjectId()} —
 *       the load-bearing regression test. Configures the source architecture
 *       so {@code source.id == project.id} and a {@code model_files} row
 *       whose {@code project_id} column value also equals {@code project.id}.
 *       Asserts the cloned model_files row's {@code project_id} arg in the
 *       captured batchUpdate is the ORIGINAL project id — NOT the new
 *       architecture id.</li>
 *   <li>{@link #testGenuineFkRewireStillWorks()} — proves the fix doesn't
 *       break legitimate FK rewiring. A {@code model_files} row's
 *       {@code id} is registered in the id-map (pass 1) and a separate
 *       column's value matches that id; the rewriter must still substitute
 *       the new id (so the cloned children can find their cloned parent).
 *       The chosen column here is one whose name is NOT in the
 *       {@code NON_REWIRABLE_FK_COLUMNS} excluded set — proving the
 *       exclusion is column-name-targeted, not blanket.</li>
 *   <li>{@link #testArchitectureIdAlwaysRewrittenToNewArchUuid()} —
 *       Hotfix #1 + #2 interaction: the {@code architecture_id} column
 *       must STILL be rewritten to the new architecture's UUID even after
 *       removing the {@code idMap.put(sourceArchId, newArchId)} line.
 *       Asserts the captured batchUpdate arg for the architecture_id
 *       column is the NEW architecture id (as a UUID, per Hotfix #1).</li>
 * </ol>
 *
 * @see ArchitectureCloneService
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCloneServiceProjectIdRewireRegressionTest {

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
     * <b>Load-bearing regression test for Hotfix #2.</b>
     *
     * <p>Configures the scenario that triggers the bug in production:</p>
     * <ul>
     *   <li>{@code source.id == project.id} (spec #1 Default rule).</li>
     *   <li>{@code model_files.project_id == project.id} (the FK that
     *       points the model file at its owning project).</li>
     * </ul>
     *
     * <p>Pre-fix, the FK rewriter would substitute the project_id value
     * (which equals sourceArchId) with the new architecture id, breaking
     * the {@code fk_model_files_project} FK on insert. Post-fix, the
     * project_id column is excluded from the rewire and passes through
     * verbatim.</p>
     */
    @Test
    @DisplayName("Hotfix #2: project_id is NOT rewired even when source.id == project.id (Default arch case)")
    void testProjectIdPreservedWhenSourceArchIdEqualsProjectId() throws Exception {
        // Spec #1 Default-architecture deterministic rule: architecture.id == project.id.
        UUID sharedId = UUID.randomUUID();
        UUID projectId = sharedId;
        UUID sourceArchitectureId = sharedId;

        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Default")
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

        // Mock model_files schema: id TEXT, project_id UUID, architecture_id UUID.
        when(databaseMetaData.getColumns(any(), any(), eq("model_files"), any()))
            .thenAnswer(inv -> mockModelFilesColumns());

        // Source row: id is some random UUID, project_id == projectId,
        // architecture_id == sourceArchitectureId. Crucially, project_id's
        // value coincides with sourceArchitectureId (because of the Default
        // arch rule). PG returns native UUID columns as java.util.UUID.
        Map<String, Object> existingRow = new HashMap<>();
        String existingMfId = UUID.randomUUID().toString();
        existingRow.put("id", existingMfId);
        existingRow.put("project_id", projectId);
        existingRow.put("architecture_id", sourceArchitectureId);
        when(jdbcTemplate.queryForList(
                startsWith("SELECT id, project_id, architecture_id FROM model_files"),
                any(Object.class)))
            .thenReturn(List.of(existingRow));

        // ----- Run clone -----
        cloneService.cloneArchitecture(
            projectId, sourceArchitectureId, "Cloned-Default", null, null);

        // ----- Capture batchUpdate args and inspect the project_id slot -----
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> batchCaptor =
            ArgumentCaptor.forClass(List.class);
        verify(jdbcTemplate, atLeastOnce()).batchUpdate(anyString(), batchCaptor.capture());
        List<Object[]> batchArgs = batchCaptor.getValue();
        assertThat(batchArgs).hasSize(1);
        Object[] insertedRow = batchArgs.get(0);

        // Column order matches the discovered ResultSet order:
        //   [0] id, [1] project_id, [2] architecture_id
        Object insertedId = insertedRow[0];
        Object insertedProjectId = insertedRow[1];
        Object insertedArchId = insertedRow[2];

        // The cloned row's id must be a fresh UUID (not the source mf id).
        assertThat(insertedId)
            .as("cloned row id must be a fresh UUID, not the source id")
            .isNotEqualTo(existingMfId);

        // ----- LOAD-BEARING ASSERTION (Hotfix #2) -----
        // project_id MUST be preserved as the original projectId, NOT
        // rewritten to the new architecture id. Pre-fix this would have
        // been the new architecture's UUID, tripping fk_model_files_project.
        assertThat(insertedProjectId)
            .as("project_id must pass through verbatim — NEVER substituted "
                + "via the FK rewire map, even when source.id == project.id")
            .isInstanceOf(UUID.class)
            .isEqualTo(projectId);

        // architecture_id must be rewritten to the NEW architecture id —
        // and crucially must NOT equal the source architecture id (which
        // also equals projectId in this scenario).
        assertThat(insertedArchId)
            .as("architecture_id must be the NEW architecture's UUID")
            .isInstanceOf(UUID.class);
        assertThat((UUID) insertedArchId)
            .as("architecture_id must not be the source id")
            .isNotEqualTo(sourceArchitectureId);
    }

    /**
     * Proves the fix is targeted: ordinary FK columns (e.g. {@code
     * model_file_id} on a child row) still get rewired via the
     * old-to-new id map. We use a synthetic 3-column model_files schema
     * (id + a generic {@code parent_ref} column + architecture_id) where
     * the {@code parent_ref} value matches the source row's id — proving
     * the rewriter still substitutes intra-scope FK references.
     *
     * <p>Note: model_files itself doesn't have a generic FK column in
     * production, but mocking the column-discovery layer lets us simulate
     * the structural shape of a child row generically without needing a
     * second table fixture.</p>
     */
    @Test
    @DisplayName("Genuine FK rewire still fires for in-scope, non-excluded columns")
    void testGenuineFkRewireStillWorks() throws Exception {
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

        // Schema: id TEXT, parent_ref TEXT (a generic FK column not in the
        // NON_REWIRABLE_FK_COLUMNS exclusion list), architecture_id UUID.
        when(databaseMetaData.getColumns(any(), any(), eq("model_files"), any()))
            .thenAnswer(inv -> mockModelFilesWithParentRefColumns());

        // Two rows: row A and row B. Row B's parent_ref points at row A's
        // id, which simulates an intra-table FK (or any in-scope FK).
        // After clone, B.parent_ref MUST be rewritten to A's NEW id.
        String rowAId = UUID.randomUUID().toString();
        String rowBId = UUID.randomUUID().toString();

        Map<String, Object> rowA = new HashMap<>();
        rowA.put("id", rowAId);
        rowA.put("parent_ref", null); // root
        rowA.put("architecture_id", sourceArchitectureId);

        Map<String, Object> rowB = new HashMap<>();
        rowB.put("id", rowBId);
        rowB.put("parent_ref", rowAId); // points at row A
        rowB.put("architecture_id", sourceArchitectureId);

        when(jdbcTemplate.queryForList(
                startsWith("SELECT id, parent_ref, architecture_id FROM model_files"),
                any(Object.class)))
            .thenReturn(List.of(rowA, rowB));

        // ----- Run clone -----
        cloneService.cloneArchitecture(
            projectId, sourceArchitectureId, "Target", null, null);

        // ----- Inspect captured INSERTs -----
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> batchCaptor =
            ArgumentCaptor.forClass(List.class);
        verify(jdbcTemplate, atLeastOnce()).batchUpdate(anyString(), batchCaptor.capture());
        List<Object[]> batchArgs = batchCaptor.getValue();
        assertThat(batchArgs).hasSize(2);

        Object[] insertedA = batchArgs.get(0);
        Object[] insertedB = batchArgs.get(1);

        String newAId = (String) insertedA[0];
        Object newAParentRef = insertedA[1];
        String newBId = (String) insertedB[0];
        Object newBParentRef = insertedB[1];

        // Both ids are fresh.
        assertThat(newAId).isNotEqualTo(rowAId).isNotEqualTo(rowBId);
        assertThat(newBId).isNotEqualTo(rowAId).isNotEqualTo(rowBId);
        assertThat(newAId).isNotEqualTo(newBId);

        // Row A had no parent_ref — preserved as null.
        assertThat(newAParentRef).isNull();

        // ----- LOAD-BEARING ASSERTION -----
        // Row B's parent_ref must be REWRITTEN to row A's NEW id (the
        // genuine intra-scope FK rewire), NOT preserved as the source
        // row A's id. This proves the project_id exclusion is targeted
        // by column name and doesn't accidentally turn off rewiring
        // for legitimate FK columns.
        assertThat(newBParentRef)
            .as("parent_ref FK must still be rewritten to the cloned parent's new id")
            .isEqualTo(newAId);
    }

    /**
     * Hotfix #1 + #2 interaction safety check: the {@code architecture_id}
     * column must STILL be rewritten to the NEW architecture's UUID even
     * after removing the {@code idMap.put(sourceArchId, newArchId)} line.
     * The architecture_id column has its own explicit branch in the
     * column-resolution loop (NOT going through the FK map), so removing
     * the map entry is safe.
     */
    @Test
    @DisplayName("architecture_id is bound to the NEW architecture's UUID via explicit branch (Hotfix #1 + #2)")
    void testArchitectureIdAlwaysRewrittenToNewArchUuid() throws Exception {
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
            .thenAnswer(inv -> mockModelFilesColumns());

        Map<String, Object> existingRow = new HashMap<>();
        String existingMfId = UUID.randomUUID().toString();
        existingRow.put("id", existingMfId);
        existingRow.put("project_id", projectId);
        existingRow.put("architecture_id", sourceArchitectureId);
        when(jdbcTemplate.queryForList(
                startsWith("SELECT id, project_id, architecture_id FROM model_files"),
                any(Object.class)))
            .thenReturn(List.of(existingRow));

        cloneService.cloneArchitecture(
            projectId, sourceArchitectureId, "Cloned", null, null);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> batchCaptor =
            ArgumentCaptor.forClass(List.class);
        verify(jdbcTemplate, atLeastOnce()).batchUpdate(anyString(), batchCaptor.capture());
        Object[] insertedRow = batchCaptor.getValue().get(0);

        // [2] = architecture_id slot.
        Object archIdArg = insertedRow[2];
        assertThat(archIdArg)
            .as("architecture_id must be bound as a UUID (Hotfix #1)")
            .isInstanceOf(UUID.class);
        assertThat((UUID) archIdArg)
            .as("architecture_id must be the NEW architecture's UUID — not the source's, "
                + "and NOT relying on the (now-removed) idMap entry")
            .isNotEqualTo(sourceArchitectureId)
            .isNotEqualTo(projectId);
    }

    // -----------------------------------------------------------------------
    // Test scaffolding helpers
    // -----------------------------------------------------------------------

    private ResultSet emptyColumnsResultSet() throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.next()).thenReturn(false);
        return rs;
    }

    /**
     * Returns a fresh ResultSet describing the model_files columns
     * relevant to the project_id regression:
     *   id              TEXT (Types.VARCHAR)
     *   project_id      UUID (Types.OTHER, TYPE_NAME = "uuid")
     *   architecture_id UUID (Types.OTHER, TYPE_NAME = "uuid")
     */
    private ResultSet mockModelFilesColumns() throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.next()).thenReturn(true, true, true, false);
        when(rs.getString("COLUMN_NAME"))
            .thenReturn("id", "project_id", "architecture_id");
        when(rs.getInt("DATA_TYPE"))
            .thenReturn(Types.VARCHAR, Types.OTHER, Types.OTHER);
        when(rs.getString("TYPE_NAME"))
            .thenReturn("text", "uuid", "uuid");
        return rs;
    }

    /**
     * Returns a synthetic ResultSet for a model_files-shaped table that
     * also has a {@code parent_ref} TEXT column (used by the genuine-FK
     * rewire test):
     *   id              TEXT (Types.VARCHAR)
     *   parent_ref      TEXT (Types.VARCHAR)
     *   architecture_id UUID (Types.OTHER, TYPE_NAME = "uuid")
     */
    private ResultSet mockModelFilesWithParentRefColumns() throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.next()).thenReturn(true, true, true, false);
        when(rs.getString("COLUMN_NAME"))
            .thenReturn("id", "parent_ref", "architecture_id");
        when(rs.getInt("DATA_TYPE"))
            .thenReturn(Types.VARCHAR, Types.VARCHAR, Types.OTHER);
        when(rs.getString("TYPE_NAME"))
            .thenReturn("text", "text", "uuid");
        return rs;
    }
}
