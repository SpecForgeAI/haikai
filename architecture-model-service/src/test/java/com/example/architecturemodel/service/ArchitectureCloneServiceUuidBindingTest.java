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
 * Regression test for the production hotfix on top of spec #6 + #7:
 * PostgreSQL strict-mode rejection of {@code uuid = varchar} comparisons.
 *
 * <p>Before the fix, {@link ArchitectureCloneService} bound
 * {@code architecture_id} (a native PostgreSQL {@code uuid} column) as a
 * {@link String} via {@code sourceArchitectureId.toString()}. H2 in
 * PostgreSQL mode silently coerced the binding; production PostgreSQL
 * surfaced {@code "ERROR: operator does not exist: uuid = character
 * varying"} and rolled the clone back at the first {@code SELECT id, ...
 * FROM model_files WHERE architecture_id = ?}.</p>
 *
 * <p>This test asserts at the JdbcTemplate-bind layer that the SELECT
 * filter and any INSERT / UPDATE arg destined for the
 * {@code architecture_id} column is bound as a {@link UUID} object — not
 * a {@link String}. It complements (does not replace) the existing
 * {@link com.example.architecturemodel.integration.ArchitectureCloneIntegrationTest}
 * which exercises the same path end-to-end against H2.</p>
 *
 * <p>Static helpers {@link ArchitectureCloneService#coerceForSqlType(Object,
 * int)} and {@link ArchitectureCloneService#isUuidSqlType(int)} are also
 * unit-tested here for the value-type-projection rules they encode.</p>
 *
 * @see ArchitectureCloneService
 * @see ArchitectureSelectiveCopyService
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCloneServiceUuidBindingTest {

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

    private UUID projectId;
    private UUID sourceArchitectureId;

    @BeforeEach
    void setUp() throws Exception {
        projectId = UUID.randomUUID();
        sourceArchitectureId = UUID.randomUUID();

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

        // Standard JDBC-meta scaffold; tests override per scenario.
        lenient().when(jdbcTemplate.getDataSource()).thenReturn(dataSource);
        lenient().when(dataSource.getConnection()).thenReturn(connection);
        lenient().when(connection.getMetaData()).thenReturn(databaseMetaData);
        // Default factory: each unconfigured table reports zero columns
        // (so cloneTableRows skips it). Per-test overrides install a
        // populated ResultSet for the table they care about.
        lenient().when(databaseMetaData.getColumns(any(), any(), anyString(), any()))
            .thenAnswer(inv -> emptyColumnsResultSet());
        // Stub batchUpdate so the production code's `inserted.length` does
        // not NPE; we only care about the captured args.
        lenient().when(jdbcTemplate.batchUpdate(anyString(),
                org.mockito.ArgumentMatchers.<List<Object[]>>any()))
            .thenReturn(new int[]{1});
    }

    /**
     * The clone path's SELECT against {@code model_files} (the first
     * in-scope table) must bind the {@code WHERE architecture_id = ?}
     * filter as a {@link UUID} object — never a {@link String}. This is
     * the load-bearing assertion against the production bug:
     * {@code "operator does not exist: uuid = character varying"}.
     */
    @Test
    @DisplayName("clone binds architecture_id filter as UUID (not String) — PG strict-mode regression")
    void testSelectArchitectureIdFilterBoundAsUuid() throws Exception {
        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Current State")
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

        // Pretend `model_files` has just two columns (id TEXT,
        // architecture_id UUID) so the SELECT executes; every other
        // in-scope table reports zero columns and is skipped (default).
        when(databaseMetaData.getColumns(any(), any(), eq("model_files"), any()))
            .thenAnswer(inv -> mockUuidArchitectureIdTable());

        // The model_files SELECT returns one row so the INSERT path also
        // exercises UUID binding. The architecture_id slot is a
        // java.util.UUID (mirroring how PG returns native UUID columns).
        Map<String, Object> existingRow = new HashMap<>();
        String existingId = UUID.randomUUID().toString();
        existingRow.put("id", existingId);
        existingRow.put("architecture_id", sourceArchitectureId);
        when(jdbcTemplate.queryForList(
                startsWith("SELECT id, architecture_id FROM model_files"),
                any(Object.class)))
            .thenReturn(List.of(existingRow));

        cloneService.cloneArchitecture(
            projectId, sourceArchitectureId, "Target", null, null);

        // ---- Assert SELECT bound architecture_id filter as a UUID ----
        ArgumentCaptor<Object> selectArgs = ArgumentCaptor.forClass(Object.class);
        verify(jdbcTemplate, atLeastOnce()).queryForList(
            startsWith("SELECT"),
            selectArgs.capture());
        Object boundArchId = selectArgs.getValue();
        assertThat(boundArchId)
            .as("architecture_id filter must be bound as UUID, not String — "
                + "production PG strictly rejects `uuid = varchar`")
            .isInstanceOf(UUID.class)
            .isEqualTo(sourceArchitectureId);

        // ---- Assert batchUpdate (INSERT) bound architecture_id arg as UUID ----
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<Object[]>> batchCaptor =
            ArgumentCaptor.forClass(List.class);
        verify(jdbcTemplate, atLeastOnce()).batchUpdate(anyString(), batchCaptor.capture());
        List<Object[]> batchArgs = batchCaptor.getValue();
        assertThat(batchArgs).isNotEmpty();
        Object[] firstRowArgs = batchArgs.get(0);
        // model_files INSERT column order matches discovery: id, architecture_id.
        assertThat(firstRowArgs[1])
            .as("architecture_id INSERT arg must be bound as UUID, not String")
            .isInstanceOf(UUID.class);
    }

    /**
     * Asserts the {@link ArchitectureCloneService#coerceForSqlType(Object,
     * int)} helper marshals string and UUID inputs to UUID for UUID-typed
     * columns and passes other types through.
     */
    @Test
    @DisplayName("coerceForSqlType marshals String -> UUID for UUID columns and passes through others")
    void testCoerceForSqlTypeBehaviour() {
        UUID id = UUID.randomUUID();
        String idStr = id.toString();

        // UUID columns: String -> UUID.
        assertThat(ArchitectureCloneService.coerceForSqlType(idStr, Types.OTHER))
            .isInstanceOf(UUID.class)
            .isEqualTo(id);
        assertThat(ArchitectureCloneService.coerceForSqlType(id, Types.OTHER))
            .isSameAs(id);
        // null pass-through.
        assertThat(ArchitectureCloneService.coerceForSqlType(null, Types.OTHER)).isNull();
        // Non-UUID columns: pass-through.
        assertThat(ArchitectureCloneService.coerceForSqlType("hello", Types.VARCHAR))
            .isEqualTo("hello");
        assertThat(ArchitectureCloneService.coerceForSqlType(42, Types.INTEGER))
            .isEqualTo(42);
        // Bad UUID string + UUID column: returned verbatim so the JDBC
        // driver surfaces the error rather than this helper swallowing it.
        assertThat(ArchitectureCloneService.coerceForSqlType("not-a-uuid", Types.OTHER))
            .isEqualTo("not-a-uuid");
    }

    /**
     * Asserts {@link ArchitectureCloneService#isUuidSqlType(int)} matches
     * the codes a UUID column is reported under across PG and H2.
     */
    @Test
    @DisplayName("isUuidSqlType returns true for OTHER / JAVA_OBJECT / 2000")
    void testIsUuidSqlType() {
        assertThat(ArchitectureCloneService.isUuidSqlType(Types.OTHER)).isTrue();
        assertThat(ArchitectureCloneService.isUuidSqlType(Types.JAVA_OBJECT)).isTrue();
        assertThat(ArchitectureCloneService.isUuidSqlType(2000)).isTrue();
        // Negative cases.
        assertThat(ArchitectureCloneService.isUuidSqlType(Types.VARCHAR)).isFalse();
        assertThat(ArchitectureCloneService.isUuidSqlType(Types.INTEGER)).isFalse();
        assertThat(ArchitectureCloneService.isUuidSqlType(Types.TIMESTAMP)).isFalse();
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
     * Returns a fresh ResultSet mock describing two columns:
     *   id              TEXT (Types.VARCHAR)
     *   architecture_id UUID (Types.OTHER, TYPE_NAME = "uuid")
     * which is a faithful sketch of the {@code model_files} prod schema for
     * the columns this test cares about.
     */
    private ResultSet mockUuidArchitectureIdTable() throws Exception {
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
