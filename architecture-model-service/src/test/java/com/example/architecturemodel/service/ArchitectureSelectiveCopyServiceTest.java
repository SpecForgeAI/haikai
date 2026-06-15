package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ArchivedArchitectureSourceException;
import com.example.architecturemodel.exception.SameArchitectureCopyException;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitRequest.ResolutionItem;
import com.example.architecturemodel.model.dto.SelectiveCopyCommitResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightRequest;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.AutoIncludedItem;
import com.example.architecturemodel.model.dto.SelectiveCopyPreflightResponse.ConflictItem;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for {@link ArchitectureSelectiveCopyService}.
 *
 * <p>Mocked {@link JdbcTemplate} + mocked {@link DatabaseMetaData}, mirroring
 * the lightweight pattern from {@link ArchitectureCloneServiceTest} and
 * {@link ArchitectureElementInventoryServiceTest}. Full graph correctness
 * (FK rewiring against a real DB, atomic rollback) lives in the Group 4
 * integration test against H2.</p>
 *
 * <p>Required tests per Task Group 2.1:</p>
 * <ol>
 *   <li>Preflight detects {@code same_uuid} conflict (safety property (b)).</li>
 *   <li>Preflight auto-includes a missing reference (safety property (d) -
 *       missing branch).</li>
 *   <li>Preflight reuses (no auto-include, no conflict) when the reference
 *       already exists in the target by UUID match (safety property (d) -
 *       reuse branch).</li>
 *   <li>Commit {@code skip} action — element not copied; no INSERT.</li>
 *   <li>Commit {@code overwrite} action — UPDATE issued preserving id.</li>
 *   <li>Commit {@code duplicate} action — fresh UUID + intra-copy-set FK
 *       rewiring.</li>
 *   <li>Refuse archived source -> 422 archived_source (safety property (e)).</li>
 *   <li>Refuse same architecture -> 422 same_architecture (safety property
 *       (f)).</li>
 * </ol>
 *
 * <p>Spec: Multi-Architecture Selective Cross-Architecture Copy (Spec #7)</p>
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureSelectiveCopyServiceTest {

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private JdbcTemplate jdbcTemplate;

    @Mock
    private ArchitectureElementMappingRepository mappingRepository;

    @Mock
    private DataSource dataSource;

    @Mock
    private Connection connection;

    @Mock
    private DatabaseMetaData databaseMetaData;

    private ArchitectureSelectiveCopyService service;

    private UUID projectId;
    private UUID sourceArchitectureId;
    private UUID targetArchitectureId;

    @BeforeEach
    void setUp() throws Exception {
        projectId = UUID.randomUUID();
        sourceArchitectureId = UUID.randomUUID();
        targetArchitectureId = UUID.randomUUID();

        service = new ArchitectureSelectiveCopyService(
            architectureRepository, jdbcTemplate, mappingRepository);

        // JDBC scaffolding for column discovery. Only the "applications"
        // table is configured to have columns (id, architecture_id, name,
        // service_id) so the cascading walk picks rows up. Every other
        // table reports no columns and is skipped cleanly. Tests that
        // need additional tables override on a per-test basis.
        lenient().when(jdbcTemplate.getDataSource()).thenReturn(dataSource);
        lenient().when(dataSource.getConnection()).thenReturn(connection);
        lenient().when(connection.getMetaData()).thenReturn(databaseMetaData);

        // Default empty result for all column probes, including the
        // case-folded upper-case fallback. Specific tests override the
        // "applications" table below.
        lenient().when(databaseMetaData.getColumns(any(), any(), anyString(), any()))
            .thenAnswer(inv -> emptyResultSet());

        // Default: every SELECT returns empty rows.
        lenient().when(jdbcTemplate.queryForList(anyString(), any(Object[].class)))
            .thenReturn(List.of());
    }

    /**
     * Returns a brand-new ResultSet mock that immediately reports next() = false,
     * so column probes for unconfigured tables yield an empty column list.
     */
    private ResultSet emptyResultSet() throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.next()).thenReturn(false);
        return rs;
    }

    /**
     * Configure the column-discovery mock to return the supplied columns
     * for the given table (in lower-case, as the service itself emits).
     */
    private void configureTableColumns(String table, String... columns) throws Exception {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        // next() returns true once per column then false.
        Boolean[] nextValues = new Boolean[columns.length + 1];
        for (int i = 0; i < columns.length; i++) nextValues[i] = Boolean.TRUE;
        nextValues[columns.length] = Boolean.FALSE;
        when(rs.next()).thenReturn(nextValues[0],
            java.util.Arrays.copyOfRange(nextValues, 1, nextValues.length));
        when(rs.getString("COLUMN_NAME")).thenReturn(
            columns[0],
            java.util.Arrays.copyOfRange(columns, 1, columns.length));
        when(databaseMetaData.getColumns(any(), any(), eq(table), any())).thenReturn(rs);
    }

    /**
     * Configure the column-discovery mock so a given table returns the same
     * column list every time the probe is invoked (vs. the default factory
     * that hands out a fresh single-use ResultSet each call).
     *
     * <p>Achieved by registering a fresh mock ResultSet on each invocation
     * of {@code databaseMetaData.getColumns(...)} for the given table.</p>
     */
    private void configureTableColumnsRepeatable(String table, String... columns) throws Exception {
        when(databaseMetaData.getColumns(any(), any(), eq(table), any())).thenAnswer(inv -> {
            ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
            Boolean[] nextValues = new Boolean[columns.length + 1];
            for (int i = 0; i < columns.length; i++) nextValues[i] = Boolean.TRUE;
            nextValues[columns.length] = Boolean.FALSE;
            when(rs.next()).thenReturn(nextValues[0],
                java.util.Arrays.copyOfRange(nextValues, 1, nextValues.length));
            when(rs.getString("COLUMN_NAME")).thenReturn(
                columns[0],
                java.util.Arrays.copyOfRange(columns, 1, columns.length));
            return rs;
        });
    }

    private ArchitectureEntity buildArch(UUID id, UUID projId, boolean archived) {
        return ArchitectureEntity.builder()
            .id(id)
            .projectId(projId)
            .name("Arch-" + id)
            .archived(archived)
            .build();
    }

    private void mockArchitectures(boolean sourceArchived) {
        lenient().when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(buildArch(sourceArchitectureId, projectId, sourceArchived)));
        lenient().when(architectureRepository.findById(targetArchitectureId))
            .thenReturn(Optional.of(buildArch(targetArchitectureId, projectId, false)));
    }

    // =========================================================================
    // TEST 1: Preflight detects same_uuid conflict
    // =========================================================================

    @Test
    @DisplayName("preflight reports same_uuid conflict when selected id exists in target")
    void testPreflightDetectsSameUuidConflict() throws Exception {
        mockArchitectures(false);
        configureTableColumnsRepeatable("applications", "id", "architecture_id", "name", "model_file_id");;

        UUID appId = UUID.randomUUID();
        // Source row exists.
        when(jdbcTemplate.queryForList(
                contains("FROM applications t"),
                eq(appId.toString()), eq(sourceArchitectureId)))
            .thenReturn(List.of(Map.of(
                "id", appId.toString(),
                "architecture_id", sourceArchitectureId.toString(),
                "name", "Order Service")));
        // Target also has a row with the same id.
        when(jdbcTemplate.queryForList(
                startsWith("SELECT 1 FROM applications t"),
                eq(appId.toString()), eq(targetArchitectureId)))
            .thenReturn(List.of(Map.of("1", 1)));

        SelectiveCopyPreflightResponse response = service.preflight(
            projectId,
            targetArchitectureId,
            new SelectiveCopyPreflightRequest(sourceArchitectureId, List.of(appId)));

        assertThat(response.conflicts())
            .as("Same-UUID conflict should be reported")
            .hasSize(1);
        ConflictItem conflict = response.conflicts().get(0);
        assertThat(conflict.elementId()).isEqualTo(appId);
        assertThat(conflict.elementType()).isEqualTo("applications");
        assertThat(conflict.name()).isEqualTo("Order Service");
        assertThat(conflict.conflictReason()).isEqualTo("same_uuid");

        assertThat(response.autoIncluded()).isEmpty();
        assertThat(response.summary().conflictCount()).isEqualTo(1);
        assertThat(response.summary().totalSelected()).isEqualTo(1);
    }

    // =========================================================================
    // TEST 2: Preflight auto-includes missing reference
    // =========================================================================

    @Test
    @DisplayName("preflight auto-includes a missing referenced element with parent name")
    void testPreflightAutoIncludesMissingReference() throws Exception {
        mockArchitectures(false);
        configureTableColumnsRepeatable("applications", "id", "architecture_id", "name", "owner_id", "model_file_id");;

        UUID parentAppId = UUID.randomUUID();
        UUID childAppId = UUID.randomUUID();

        // Single id-source-lookup query route. We treat both ids as
        // belonging to the applications table.
        when(jdbcTemplate.queryForList(
                contains("FROM applications t"),
                anyString(), any()))
            .thenAnswer(inv -> {
                Object[] args = inv.getArguments();
                String id = (String) args[1];
                String archId = args[2].toString();
                if (!archId.equals(sourceArchitectureId.toString())) return List.of();
                if (id.equals(parentAppId.toString())) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", parentAppId.toString());
                    row.put("architecture_id", sourceArchitectureId.toString());
                    row.put("name", "Parent");
                    row.put("owner_id", childAppId.toString()); // FK ref!
                    return List.of(row);
                }
                if (id.equals(childAppId.toString())) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", childAppId.toString());
                    row.put("architecture_id", sourceArchitectureId.toString());
                    row.put("name", "Child");
                    row.put("owner_id", null);
                    return List.of(row);
                }
                return List.of();
            });
        // Target has neither id (existence probes always return empty).
        when(jdbcTemplate.queryForList(
                startsWith("SELECT 1 FROM"),
                anyString(), any()))
            .thenReturn(List.of());

        SelectiveCopyPreflightResponse response = service.preflight(
            projectId,
            targetArchitectureId,
            new SelectiveCopyPreflightRequest(sourceArchitectureId, List.of(parentAppId)));

        assertThat(response.autoIncluded())
            .as("Child reference should be auto-included")
            .hasSize(1);
        AutoIncludedItem auto = response.autoIncluded().get(0);
        assertThat(auto.elementId()).isEqualTo(childAppId);
        assertThat(auto.elementType()).isEqualTo("applications");
        assertThat(auto.name()).isEqualTo("Child");
        assertThat(auto.includedBecause()).isEqualTo("Parent");

        assertThat(response.conflicts()).isEmpty();
        assertThat(response.summary().autoIncludedCount()).isEqualTo(1);
        assertThat(response.summary().willCopyCount()).isEqualTo(2);
    }

    // =========================================================================
    // TEST 3: Preflight reuses (does NOT auto-include) when ref exists in target
    // =========================================================================

    @Test
    @DisplayName("preflight silently reuses references already present in target by UUID match")
    void testPreflightReusesUuidMatchInTarget() throws Exception {
        mockArchitectures(false);
        configureTableColumnsRepeatable("applications", "id", "architecture_id", "name", "owner_id", "model_file_id");;

        UUID parentAppId = UUID.randomUUID();
        UUID childAppId = UUID.randomUUID();

        when(jdbcTemplate.queryForList(
                contains("FROM applications t"),
                anyString(), any()))
            .thenAnswer(inv -> {
                Object[] args = inv.getArguments();
                String id = (String) args[1];
                String archId = args[2].toString();
                if (archId.equals(sourceArchitectureId.toString())
                    && id.equals(parentAppId.toString())) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", parentAppId.toString());
                    row.put("architecture_id", sourceArchitectureId.toString());
                    row.put("name", "Parent");
                    row.put("owner_id", childAppId.toString());
                    return List.of(row);
                }
                if (archId.equals(sourceArchitectureId.toString())
                    && id.equals(childAppId.toString())) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", childAppId.toString());
                    row.put("architecture_id", sourceArchitectureId.toString());
                    row.put("name", "Child");
                    return List.of(row);
                }
                return List.of();
            });

        // Target existence: child IS present, parent is NOT.
        when(jdbcTemplate.queryForList(
                startsWith("SELECT 1 FROM applications t"),
                anyString(), any()))
            .thenAnswer(inv -> {
                Object[] args = inv.getArguments();
                String id = (String) args[1];
                String archId = args[2].toString();
                if (archId.equals(targetArchitectureId.toString())
                    && id.equals(childAppId.toString())) {
                    return List.of(Map.of("1", 1));
                }
                return List.of();
            });

        SelectiveCopyPreflightResponse response = service.preflight(
            projectId,
            targetArchitectureId,
            new SelectiveCopyPreflightRequest(sourceArchitectureId, List.of(parentAppId)));

        assertThat(response.autoIncluded())
            .as("Child should be silently reused, NOT auto-included")
            .isEmpty();
        assertThat(response.conflicts())
            .as("Parent does NOT exist in target so no conflict")
            .isEmpty();
        assertThat(response.summary().willCopyCount()).isEqualTo(1);
    }

    // =========================================================================
    // TEST 4: Commit skip action - element not copied
    // =========================================================================

    @Test
    @DisplayName("commit with skip action does not INSERT or UPDATE the conflicting element")
    void testCommitSkipDoesNotCopy() throws Exception {
        mockArchitectures(false);
        configureTableColumnsRepeatable("applications", "id", "architecture_id", "name", "model_file_id");;

        UUID appId = UUID.randomUUID();
        // Source row.
        when(jdbcTemplate.queryForList(
                contains("FROM applications t"),
                eq(appId.toString()), eq(sourceArchitectureId)))
            .thenReturn(List.of(Map.of(
                "id", appId.toString(),
                "architecture_id", sourceArchitectureId.toString(),
                "name", "OrderSvc")));
        // Target conflict (same id present).
        when(jdbcTemplate.queryForList(
                startsWith("SELECT 1 FROM applications t"),
                eq(appId.toString()), eq(targetArchitectureId)))
            .thenReturn(List.of(Map.of("1", 1)));

        SelectiveCopyCommitResponse response = service.commit(
            projectId,
            targetArchitectureId,
            new SelectiveCopyCommitRequest(
                sourceArchitectureId,
                List.of(appId),
                List.of(new ResolutionItem(appId, "skip"))));

        assertThat(response.skipped()).isEqualTo(1);
        assertThat(response.copied()).isEqualTo(0);
        assertThat(response.overwritten()).isEqualTo(0);
        assertThat(response.duplicated()).isEqualTo(0);

        // No mutation should have been issued (only SELECTs).
        verify(jdbcTemplate, never()).update(anyString(), any(Object[].class));
    }

    // =========================================================================
    // TEST 5: Commit overwrite action - UPDATE preserving id
    // =========================================================================

    @Test
    @DisplayName("commit with overwrite action UPDATEs the target row preserving id")
    void testCommitOverwriteIssuesUpdate() throws Exception {
        mockArchitectures(false);
        configureTableColumnsRepeatable("applications", "id", "architecture_id", "name", "model_file_id");;

        UUID appId = UUID.randomUUID();
        when(jdbcTemplate.queryForList(
                contains("FROM applications t"),
                eq(appId.toString()), eq(sourceArchitectureId)))
            .thenReturn(List.of(Map.of(
                "id", appId.toString(),
                "architecture_id", sourceArchitectureId.toString(),
                "name", "Renamed Service")));
        // Target conflict.
        when(jdbcTemplate.queryForList(
                startsWith("SELECT 1 FROM applications t"),
                eq(appId.toString()), eq(targetArchitectureId)))
            .thenReturn(List.of(Map.of("1", 1)));

        SelectiveCopyCommitResponse response = service.commit(
            projectId,
            targetArchitectureId,
            new SelectiveCopyCommitRequest(
                sourceArchitectureId,
                List.of(appId),
                List.of(new ResolutionItem(appId, "overwrite"))));

        assertThat(response.overwritten()).isEqualTo(1);
        assertThat(response.copied()).isEqualTo(1);
        assertThat(response.skipped()).isEqualTo(0);
        assertThat(response.duplicated()).isEqualTo(0);

        // Capture the UPDATE call: it should be against applications,
        // matching the existing id, with target architecture_id.
        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> argsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbcTemplate, atLeastOnce()).update(sqlCaptor.capture(), argsCaptor.capture());

        boolean foundUpdate = false;
        for (int i = 0; i < sqlCaptor.getAllValues().size(); i++) {
            String sql = sqlCaptor.getAllValues().get(i);
            Object[] args = argsCaptor.getAllValues().get(i);
            if (sql.startsWith("UPDATE applications")) {
                foundUpdate = true;
                // The last two args are the WHERE id + WHERE architecture_id values.
                assertThat(args[args.length - 2]).isEqualTo(appId.toString());
                assertThat(args[args.length - 1]).isEqualTo(targetArchitectureId);
            }
        }
        assertThat(foundUpdate).as("Expected an UPDATE on applications").isTrue();
        // No INSERT for the conflicting element.
        for (String sql : sqlCaptor.getAllValues()) {
            assertThat(sql).doesNotStartWith("INSERT INTO applications");
        }
    }

    // =========================================================================
    // TEST 6: Commit duplicate action - fresh UUID + intra-copy-set FK rewiring
    // =========================================================================

    @Test
    @DisplayName("commit with duplicate action assigns fresh UUID and rewires FKs from other copied elements")
    void testCommitDuplicateRewiresIntraCopySetFks() throws Exception {
        mockArchitectures(false);
        configureTableColumnsRepeatable("applications", "id", "architecture_id", "name", "owner_id", "model_file_id");;

        // Two applications: parent references child's id via owner_id.
        // Child is the conflicting one and the user resolves to "duplicate".
        // Parent should INSERT with owner_id rewired to the child's NEW id.
        UUID parentId = UUID.randomUUID();
        UUID childId = UUID.randomUUID();

        when(jdbcTemplate.queryForList(
                contains("FROM applications t"),
                anyString(), any()))
            .thenAnswer(inv -> {
                Object[] args = inv.getArguments();
                String id = (String) args[1];
                String archId = args[2].toString();
                if (!archId.equals(sourceArchitectureId.toString())) return List.of();
                if (id.equals(parentId.toString())) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", parentId.toString());
                    row.put("architecture_id", sourceArchitectureId.toString());
                    row.put("name", "Parent");
                    row.put("owner_id", childId.toString());
                    return List.of(row);
                }
                if (id.equals(childId.toString())) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    row.put("id", childId.toString());
                    row.put("architecture_id", sourceArchitectureId.toString());
                    row.put("name", "Child");
                    row.put("owner_id", null);
                    return List.of(row);
                }
                return List.of();
            });

        // Child id IS in target (same UUID conflict). Parent is not.
        when(jdbcTemplate.queryForList(
                startsWith("SELECT 1 FROM applications t"),
                anyString(), any()))
            .thenAnswer(inv -> {
                Object[] args = inv.getArguments();
                String id = (String) args[1];
                String archId = args[2].toString();
                if (archId.equals(targetArchitectureId.toString())
                    && id.equals(childId.toString())) {
                    return List.of(Map.of("1", 1));
                }
                return List.of();
            });

        SelectiveCopyCommitResponse response = service.commit(
            projectId,
            targetArchitectureId,
            new SelectiveCopyCommitRequest(
                sourceArchitectureId,
                List.of(parentId, childId),
                List.of(new ResolutionItem(childId, "duplicate"))));

        assertThat(response.duplicated()).isEqualTo(1);
        // Parent + child both effectively copied (parent INSERT verbatim,
        // child INSERT with new UUID).
        assertThat(response.copied()).isEqualTo(2);

        // Verify: TWO inserts against applications. Capture all updates and
        // inspect.
        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> argsCaptor = ArgumentCaptor.forClass(Object[].class);
        verify(jdbcTemplate, atLeastOnce()).update(sqlCaptor.capture(), argsCaptor.capture());

        List<Object[]> appsInserts = new ArrayList<>();
        for (int i = 0; i < sqlCaptor.getAllValues().size(); i++) {
            if (sqlCaptor.getAllValues().get(i).startsWith("INSERT INTO applications")) {
                appsInserts.add(argsCaptor.getAllValues().get(i));
            }
        }
        assertThat(appsInserts)
            .as("Both parent and child should be INSERTed into applications")
            .hasSize(2);

        // Find the parent insert (id == parentId.toString()) and assert its
        // owner_id has been rewired to the child's NEW id (not the original
        // childId).
        Object[] parentInsert = null;
        Object[] childInsert = null;
        // columns order: id, architecture_id, name, owner_id
        for (Object[] args : appsInserts) {
            String idArg = (String) args[0];
            if (idArg.equals(parentId.toString())) {
                parentInsert = args;
            } else if (!idArg.equals(childId.toString())) {
                // This is the duplicated child with a fresh id.
                childInsert = args;
            }
        }
        assertThat(parentInsert).as("parent insert").isNotNull();
        assertThat(childInsert).as("duplicated child insert with fresh id").isNotNull();

        String newChildId = (String) childInsert[0];
        assertThat(newChildId).isNotEqualTo(childId.toString());

        // owner_id is column index 3.
        assertThat(parentInsert[3])
            .as("parent's owner_id should be rewired to the child's NEW id")
            .isEqualTo(newChildId);

        // architecture_id should be the target id on both inserts.
        assertThat(parentInsert[1]).isEqualTo(targetArchitectureId);
        assertThat(childInsert[1]).isEqualTo(targetArchitectureId);
    }

    // =========================================================================
    // TEST 7: Refuse archived source -> 422 archived_source
    // =========================================================================

    @Test
    @DisplayName("preflight refuses archived source with ArchivedArchitectureSourceException")
    void testPreflightRejectsArchivedSource() {
        mockArchitectures(true /* sourceArchived */);

        UUID someId = UUID.randomUUID();
        assertThatThrownBy(() -> service.preflight(
                projectId,
                targetArchitectureId,
                new SelectiveCopyPreflightRequest(sourceArchitectureId, List.of(someId))))
            .isInstanceOf(ArchivedArchitectureSourceException.class);

        verify(jdbcTemplate, never()).update(anyString(), any(Object[].class));
    }

    // =========================================================================
    // TEST 8: Refuse same-architecture -> 422 same_architecture
    // =========================================================================

    @Test
    @DisplayName("preflight refuses same source/target with SameArchitectureCopyException")
    void testPreflightRejectsSameArchitecture() {
        // Both source and target are the SAME architecture id.
        UUID sameId = UUID.randomUUID();
        when(architectureRepository.findById(sameId))
            .thenReturn(Optional.of(buildArch(sameId, projectId, false)));

        UUID someElement = UUID.randomUUID();
        assertThatThrownBy(() -> service.preflight(
                projectId,
                sameId,
                new SelectiveCopyPreflightRequest(sameId, List.of(someElement))))
            .isInstanceOf(SameArchitectureCopyException.class);

        verify(jdbcTemplate, never()).update(anyString(), any(Object[].class));
    }
}
