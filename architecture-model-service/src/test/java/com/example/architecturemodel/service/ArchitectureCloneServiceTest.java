package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ArchitectureNotFoundException;
import com.example.architecturemodel.exception.ArchivedArchitectureSourceException;
import com.example.architecturemodel.exception.DuplicateArchitectureNameException;
import com.example.architecturemodel.mapper.ArchitectureMapper;
import com.example.architecturemodel.model.dto.ArchitectureDto;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ArchitectureTagEntity;
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
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level tests for ArchitectureCloneService.
 *
 * Covers the critical service-level safety properties that don't need a
 * live database (those move to the Group 3 integration test):
 *   - happy path: a clone returns a new architecture DTO with the
 *     requested name/description/tags.
 *   - source-not-found: 404 surfaces correctly.
 *   - cross-project source: also 404.
 *   - archived source: 422 ArchivedArchitectureSourceException
 *     (safety property (d)).
 *   - validation reuse: empty name is rejected by the same helper as
 *     spec #3's create / update (no duplicate validation logic).
 *   - duplicate name: 409 DuplicateArchitectureNameException
 *     (pre-flight check; the unique index from Liquibase 092 is the
 *     race-condition safety net).
 *
 * JdbcTemplate is mocked. All in-scope tables return empty rows in the
 * happy-path test, which is sufficient to verify the architecture-row
 * creation, tag insertion, and DTO mapping. Graph-clone correctness
 * (fresh UUIDs, FK rewiring, atomic rollback) is asserted by the
 * Group 3 integration test against a real (H2 / testcontainers)
 * database where JDBC actually executes.
 *
 * Spec: Multi-Architecture Full Clone (Spec #6)
 * Task Group 1: Backend Foundation (Task 1.1)
 */
@ExtendWith(MockitoExtension.class)
class ArchitectureCloneServiceTest {

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

    @Mock
    private ResultSet columnsResultSet;

    private ArchitectureMapper architectureMapper;
    private ArchitectureService architectureService;
    private ArchitectureCloneService cloneService;

    private UUID projectId;
    private UUID sourceArchitectureId;

    @BeforeEach
    void setUp() throws Exception {
        projectId = UUID.randomUUID();
        sourceArchitectureId = UUID.randomUUID();

        // Real mapper + real validation-helper-owning service; the
        // mapper is a tiny, no-state utility and the service's helpers
        // are the same ones spec #3's create / update tests already
        // exercise -- we want them really called from the clone path.
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

        // JDBC schema-discovery scaffolding: the clone service will
        // call jdbcTemplate.getDataSource() once per in-scope table
        // and then walk DatabaseMetaData.getColumns(...). Returning an
        // immediately-finished result set means every table is reported
        // as having no columns, which makes discoverColumns return an
        // empty list and cloneTableRows skip the table cleanly. This
        // isolates the architecture-row-creation behaviour without
        // requiring a real DB.
        //
        // Marked lenient because the four tests that throw before
        // entering the clone loop never touch JDBC.
        lenient().when(jdbcTemplate.getDataSource()).thenReturn(dataSource);
        lenient().when(dataSource.getConnection()).thenReturn(connection);
        lenient().when(connection.getMetaData()).thenReturn(databaseMetaData);
        lenient().when(databaseMetaData.getColumns(any(), any(), anyString(), any()))
            .thenReturn(columnsResultSet);
        lenient().when(columnsResultSet.next()).thenReturn(false);
    }

    /**
     * Test 1: happy path -- clone produces a new architecture row with
     * the requested name/description/tags and returns the DTO.
     */
    @Test
    @DisplayName("clone returns new architecture DTO with requested name/description/tags")
    void testCloneHappyPath() {
        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Current State")
            .description("Captured via Discovery")
            .archived(false)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(source));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(
                projectId, "Copy of Current State"))
            .thenReturn(false);
        // The save is a pass-through that returns the entity it was given;
        // capturing the argument lets us verify the new row's fields.
        when(architectureRepository.saveAndFlush(any(ArchitectureEntity.class)))
            .thenAnswer(inv -> inv.getArgument(0));
        when(architectureTagRepository.findByArchitectureId(any(UUID.class)))
            .thenReturn(List.of(
                ArchitectureTagEntity.builder()
                    .architectureId(UUID.randomUUID())
                    .tagValue("target-state")
                    .build()));

        ArchitectureDto result = cloneService.cloneArchitecture(
            projectId,
            sourceArchitectureId,
            "  Copy of Current State  ", // exercises trimming
            "  A trimmed description  ",
            List.of(" target-state "));

        assertThat(result).isNotNull();
        assertThat(result.name()).isEqualTo("Copy of Current State");
        assertThat(result.description()).isEqualTo("A trimmed description");
        assertThat(result.projectId()).isEqualTo(projectId);
        assertThat(result.archived()).isFalse();
        assertThat(result.id()).isNotEqualTo(sourceArchitectureId);
        assertThat(result.tags()).containsExactly("target-state");

        // Verify the architecture row was inserted with a fresh id (NOT
        // the source's id) and the trimmed payload.
        ArgumentCaptor<ArchitectureEntity> archCaptor =
            ArgumentCaptor.forClass(ArchitectureEntity.class);
        verify(architectureRepository).saveAndFlush(archCaptor.capture());
        ArchitectureEntity inserted = archCaptor.getValue();
        assertThat(inserted.getId()).isNotEqualTo(sourceArchitectureId);
        assertThat(inserted.getProjectId()).isEqualTo(projectId);
        assertThat(inserted.getName()).isEqualTo("Copy of Current State");
        assertThat(inserted.getArchived()).isFalse();

        // Verify the tag row was inserted (trimmed).
        ArgumentCaptor<ArchitectureTagEntity> tagCaptor =
            ArgumentCaptor.forClass(ArchitectureTagEntity.class);
        verify(architectureTagRepository).save(tagCaptor.capture());
        assertThat(tagCaptor.getValue().getTagValue()).isEqualTo("target-state");
    }

    /**
     * Test 2: source not found -- throws ArchitectureNotFoundException
     * mapped to 404 by GlobalExceptionHandler.
     */
    @Test
    @DisplayName("clone throws ArchitectureNotFoundException when source id does not exist")
    void testCloneThrowsWhenSourceMissing() {
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.empty());

        assertThatThrownBy(() -> cloneService.cloneArchitecture(
                projectId, sourceArchitectureId, "Copy of X", null, null))
            .isInstanceOf(ArchitectureNotFoundException.class)
            .hasMessageContaining(sourceArchitectureId.toString());

        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
    }

    /**
     * Test 3: source belongs to a different project -- also surfaces as
     * 404 (per the standard cross-project-safety pattern).
     */
    @Test
    @DisplayName("clone throws ArchitectureNotFoundException when source belongs to another project")
    void testCloneThrowsWhenSourceCrossProject() {
        UUID otherProjectId = UUID.randomUUID();
        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(otherProjectId)
            .name("Foreign Architecture")
            .archived(false)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(source));

        assertThatThrownBy(() -> cloneService.cloneArchitecture(
                projectId, sourceArchitectureId, "Copy of Foreign", null, null))
            .isInstanceOf(ArchitectureNotFoundException.class)
            .hasMessageContaining("not found in project");

        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
    }

    /**
     * Test 4 (safety property (d)): clone of an archived source is
     * refused with ArchivedArchitectureSourceException, mapped to 422
     * {code: "archived_source"} by GlobalExceptionHandler.
     */
    @Test
    @DisplayName("clone of an archived source throws ArchivedArchitectureSourceException")
    void testCloneRejectsArchivedSource() {
        ArchitectureEntity archivedSource = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Old State")
            .archived(true)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(archivedSource));

        assertThatThrownBy(() -> cloneService.cloneArchitecture(
                projectId, sourceArchitectureId, "Copy of Old State", null, null))
            .isInstanceOf(ArchivedArchitectureSourceException.class);

        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
        verify(architectureTagRepository, never()).save(any(ArchitectureTagEntity.class));
    }

    /**
     * Test 5: name-validation reuse -- an empty name surfaces the same
     * IllegalArgumentException ("Architecture name is required") that
     * spec #3's create / update use, proving the clone path delegates
     * to the same validateAndTrimName helper rather than re-implementing
     * it (mapped to 400 by GlobalExceptionHandler).
     */
    @Test
    @DisplayName("clone rejects empty name with the shared validation helper")
    void testCloneRejectsEmptyName() {
        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Default")
            .archived(false)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(source));

        assertThatThrownBy(() -> cloneService.cloneArchitecture(
                projectId, sourceArchitectureId, "   ", null, null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Architecture name is required");

        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
    }

    /**
     * Test 6 (safety property (e)): duplicate name surfaces as
     * DuplicateArchitectureNameException (mapped to 409
     * {code: "duplicate_name"}). The application's pre-flight check
     * fires before the unique-index safety net from Liquibase 092.
     */
    @Test
    @DisplayName("clone with a duplicate name throws DuplicateArchitectureNameException")
    void testCloneRejectsDuplicateName() {
        ArchitectureEntity source = ArchitectureEntity.builder()
            .id(sourceArchitectureId)
            .projectId(projectId)
            .name("Default")
            .archived(false)
            .build();
        when(architectureRepository.findById(sourceArchitectureId))
            .thenReturn(Optional.of(source));
        when(architectureRepository.existsByProjectIdAndNameIgnoreCase(
                eq(projectId), eq("Copy of Default")))
            .thenReturn(true);

        assertThatThrownBy(() -> cloneService.cloneArchitecture(
                projectId, sourceArchitectureId, "Copy of Default", null, null))
            .isInstanceOf(DuplicateArchitectureNameException.class)
            .hasMessageContaining("Copy of Default");

        verify(architectureRepository, never()).save(any(ArchitectureEntity.class));
    }
}
