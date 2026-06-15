package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ArchitectureTagRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * Tests for the {@code elementCount} aggregation introduced by the Four-Spec
 * Hardening Pass (2026-05-25), Item 3.
 *
 * <p>Two focused tests covering the spec's backend cap allocation
 * (2 backend tests for Item 3):</p>
 * <ol>
 *   <li>{@code listTargets} populates {@code elementCount} on every draft
 *       using the 4 grouped queries (one per user-visible supertype table).
 *       Aggregation correctness across mixed empty + populated drafts.</li>
 *   <li>Backward compatibility -- callers that use the 10-arg or 8-arg
 *       {@code ArchitectureDto} constructors compile and default
 *       {@code elementCount} to {@code null}; this preserves the
 *       additive-constructor pattern from spec 2026-05-20.</li>
 * </ol>
 *
 * <p>Spec: Four-Spec Hardening Pass (2026-05-25) -- Item 3.</p>
 */
@ExtendWith(MockitoExtension.class)
class TargetArchitecturePromoteServiceElementCountTest {

    @Mock
    private ArchitectureRepository architectureRepository;

    @Mock
    private ArchitectureTagRepository architectureTagRepository;

    @Mock
    private ArchitectureElementMappingRepository mappingRepository;

    @Mock
    private TargetArchitectureStaleMarkService staleMarkService;

    @Mock
    private JdbcTemplate jdbcTemplate;

    private TargetArchitecturePromoteService promoteService;

    private UUID projectId;
    private UUID draftEmptyId;
    private UUID draftPopulatedId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        draftEmptyId = UUID.randomUUID();
        draftPopulatedId = UUID.randomUUID();

        promoteService = new TargetArchitecturePromoteService(
            architectureRepository,
            architectureTagRepository,
            new ArchitectureMapper(),
            mappingRepository,
            staleMarkService,
            jdbcTemplate);
    }

    /**
     * Test 1 (AMS backend test 1): list endpoint returns correct
     * {@code elementCount} per draft for a fixture mixing empty + populated
     * drafts across all four supertype tables.
     *
     * <p>Stubs the four grouped queries to return synthetic rows per supertype
     * table, asserts that the per-draft counts are summed correctly, and
     * confirms an empty draft surfaces {@code elementCount == 0L} (not
     * {@code null}).</p>
     */
    @Test
    @DisplayName("Test 1: list endpoint surfaces elementCount across the 4 supertype tables; mixed empty/populated drafts")
    void listTargetsAggregatesElementCountAcrossSupertypeTables() {
        ArchitectureEntity draftPopulated = ArchitectureEntity.builder()
            .id(draftPopulatedId)
            .projectId(projectId)
            .name("Populated draft")
            .kind("target")
            .draftState("active")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        ArchitectureEntity draftEmpty = ArchitectureEntity.builder()
            .id(draftEmptyId)
            .projectId(projectId)
            .name("Empty draft")
            .kind("target")
            .draftState("draft")
            .archived(false)
            .createdAt(Instant.now())
            .updatedAt(Instant.now())
            .build();
        when(architectureRepository.findByProjectIdAndKindOrderByCreatedAtDesc(
                projectId, "target"))
            .thenReturn(List.of(draftPopulated, draftEmpty));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of());

        // Synthetic per-supertype-table counts:
        //   application_components: populated=3 (empty draft has no row).
        //   interfaces:             populated=2.
        //   data_entity_points:     populated=5.
        //   infrastructure_points:  populated=1.
        // Expected: populated total = 11; empty total = 0.
        Map<String, Map<UUID, Long>> perTable = new HashMap<>();
        perTable.put("application_components", Map.of(draftPopulatedId, 3L));
        perTable.put("interfaces", Map.of(draftPopulatedId, 2L));
        perTable.put("data_entity_points", Map.of(draftPopulatedId, 5L));
        perTable.put("infrastructure_points", Map.of(draftPopulatedId, 1L));

        // Stub each of the four grouped queries by reading the SQL string the
        // service builds. The service issues exactly four queries -- one per
        // supertype table -- and the test pivots on the table name in the SQL.
        // Production uses the non-deprecated
        // jdbcTemplate.query(sql, RowCallbackHandler, Object...) overload;
        // the matcher pattern below pairs the RowCallbackHandler with a
        // trailing varargs Object[] so Mockito's stub resolves to that
        // overload at runtime.
        doAnswer(invocation -> {
            String sql = invocation.getArgument(0);
            RowCallbackHandler handler = invocation.getArgument(1);
            for (Map.Entry<String, Map<UUID, Long>> entry : perTable.entrySet()) {
                if (sql.contains(" " + entry.getKey() + " ")) {
                    for (Map.Entry<UUID, Long> row : entry.getValue().entrySet()) {
                        ResultSet rs = stubResultSetRow(row.getKey(), row.getValue());
                        handler.processRow(rs);
                    }
                    break;
                }
            }
            return null;
        }).when(jdbcTemplate).query(anyString(), any(RowCallbackHandler.class), any(Object[].class));

        // ACT
        List<ArchitectureDto> result = promoteService.listTargets(projectId);

        // ASSERT
        assertThat(result).hasSize(2);
        // Active-first ordering: populated draft surfaces first.
        ArchitectureDto populatedDto = result.get(0);
        ArchitectureDto emptyDto = result.get(1);
        assertThat(populatedDto.id()).isEqualTo(draftPopulatedId);
        assertThat(populatedDto.elementCount()).isEqualTo(11L);
        assertThat(emptyDto.id()).isEqualTo(draftEmptyId);
        // Empty draft surfaces 0L (not null) so the UI can branch on `=== 0`.
        assertThat(emptyDto.elementCount()).isEqualTo(0L);
    }

    /**
     * Test 2 (AMS backend test 2): backward compatibility -- the
     * {@code ArchitectureDto} 10-arg and 8-arg constructors still work and
     * default {@code elementCount} to {@code null}.
     *
     * <p>Locks the additive-constructor pattern: any caller that built the
     * DTO with the older signature (pre-Item-3) compiles, runs, and surfaces
     * {@code elementCount() == null} -- which the frontend interprets as
     * "count unknown" rather than "zero elements".</p>
     */
    @Test
    @DisplayName("Test 2: 10-arg and 8-arg ArchitectureDto constructors default elementCount to null")
    void architectureDtoBackwardCompatibleConstructorsDefaultElementCountToNull() {
        UUID id = UUID.randomUUID();
        UUID projId = UUID.randomUUID();
        Instant now = Instant.now();

        // 10-arg constructor (pre-Item-3 canonical signature) -- the form the
        // ArchitectureMapper currently emits.
        ArchitectureDto tenArg = new ArchitectureDto(
            id, projId, "name", "desc",
            new ArrayList<>(),
            Boolean.FALSE, "target", "active", now, now);
        assertThat(tenArg.elementCount()).isNull();
        assertThat(tenArg.kind()).isEqualTo("target");
        assertThat(tenArg.draftState()).isEqualTo("active");

        // 8-arg constructor (pre-Target-Architecture-Authoring-Flow signature).
        ArchitectureDto eightArg = new ArchitectureDto(
            id, projId, "name", "desc",
            new ArrayList<>(),
            Boolean.FALSE, now, now);
        assertThat(eightArg.elementCount()).isNull();
        assertThat(eightArg.kind()).isNull();
        assertThat(eightArg.draftState()).isNull();

        // Canonical 11-arg constructor preserves the explicit value.
        ArchitectureDto elevenArg = new ArchitectureDto(
            id, projId, "name", "desc",
            new ArrayList<>(),
            Boolean.FALSE, "target", "draft", now, now, 42L);
        assertThat(elevenArg.elementCount()).isEqualTo(42L);
    }

    /**
     * Builds a minimal {@link ResultSet} double that responds to the two
     * column accesses the service uses ({@code getObject("architecture_id")}
     * and {@code getLong(2)}). A full mock would be overkill -- this stub is
     * the smallest surface that exercises the production code path.
     */
    private static ResultSet stubResultSetRow(UUID archId, long count) throws SQLException {
        ResultSet rs = org.mockito.Mockito.mock(ResultSet.class);
        when(rs.getObject(eq("architecture_id"))).thenReturn(archId);
        when(rs.getLong(2)).thenReturn(count);
        return rs;
    }
}
