package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.EmptyCurrentArchitectureException;
import com.example.architecturemodel.model.dto.SuggestFromCurrentRequest;
import com.example.architecturemodel.model.dto.SuggestFromCurrentResponse;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.ArchitectureEntity;
import com.example.architecturemodel.model.entity.ModelFileEntity;
import com.example.architecturemodel.repository.ArchitectureRepository;
import com.example.architecturemodel.repository.ModelFileRepository;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Integration tests for {@link SuggestFromCurrentService}.
 *
 * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24) -- Task
 * Group 1, sub-task 1.1.</p>
 *
 * <p>Scope (per spec Test Coverage section + task limit of 2-8 highly focused
 * tests; we ship exactly 2):</p>
 * <ol>
 *   <li><b>Happy path</b> -- seeds a current architecture with a non-trivial
 *       mix and asserts (a) a new target draft created with auto-name
 *       {@code "Target State - Suggested YYYY-MM-DD"}, {@code kind='target'},
 *       {@code draft_state='draft'}; (b) every source element has a cloned
 *       counterpart with matching name + {@code provenance='cloned-from'};
 *       (c) exactly one {@code architecture_element_mappings} row per cloned
 *       element with the spec's required values; (d) diagram tables NOT
 *       cloned.</li>
 *   <li><b>Empty-source 422</b> -- seeds a current architecture with zero
 *       in-scope elements and asserts the service throws
 *       {@link EmptyCurrentArchitectureException} with the exact message,
 *       no new draft row, no mapping rows.</li>
 * </ol>
 *
 * <p>Follows the {@code ArchitectureCloneIntegrationTest} fixture pattern:
 * JPA's {@code create-drop} only generates {@code architecture_id} columns
 * for entities that declare the field, so this test manually adds the column
 * to additional tables via {@code ALTER TABLE ... ADD COLUMN IF NOT EXISTS}.
 * Tests are NOT {@code @Transactional} so the service's own
 * {@code @Transactional} boundary is real and rollback semantics behave
 * authentically.</p>
 */
@SpringBootTest
@TestPropertySource(properties = {
    "app.data-entity-points.startup-ensure=false"
})
class SuggestFromCurrentServiceIntegrationTest {

    private static final DateTimeFormatter DATE_FORMAT = DateTimeFormatter.ofPattern("yyyy-MM-dd");

    @Autowired
    private SuggestFromCurrentService suggestService;

    @Autowired
    private ArchitectureRepository architectureRepository;

    @Autowired
    private ModelFileRepository modelFileRepository;

    @Autowired
    private ArchitectureElementMappingRepository mappingRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private UnmappedCurrentElementsService unmappedService;

    private UUID projectId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();

        // JPA create-drop only adds architecture_id columns to entities that
        // declare the field. Production runs Liquibase changeset 089 to add
        // the same column to every meta-model entity table. We ensure the
        // columns on every table the Suggest path will touch.
        for (String table : List.of(
                "applications",
                "application_components",
                "services",
                "interfaces",
                "endpoints",
                "logical_data_entities",
                "logical_data_attributes",
                "physical_data_entities")) {
            ensureArchitectureIdColumn(table);
        }
    }

    @AfterEach
    void tearDown() {
        // Clean mappings first to clear the FK references on architecture rows.
        try {
            jdbcTemplate.update("DELETE FROM architecture_element_mappings WHERE 1=1");
        } catch (DataAccessException ignored) {
            // Table may not exist in some test profiles.
        }
        // Element tables in dependency order.
        for (String table : List.of(
                "endpoints",
                "interfaces",
                "services",
                "application_components",
                "applications",
                "logical_data_attributes",
                "logical_data_entities",
                "physical_data_entities",
                "model_files",
                "architecture_tag")) {
            try {
                jdbcTemplate.update("DELETE FROM " + table + " WHERE 1=1");
            } catch (DataAccessException ignored) {
                // Table may not exist in some test profiles.
            }
        }
        jdbcTemplate.update("DELETE FROM architecture WHERE 1=1");
    }

    private void ensureArchitectureIdColumn(String table) {
        try {
            jdbcTemplate.execute(
                "ALTER TABLE " + table + " ADD COLUMN IF NOT EXISTS architecture_id UUID");
        } catch (DataAccessException e) {
            throw new IllegalStateException(
                "Failed to ensure architecture_id column on " + table + ": " + e.getMessage(), e);
        }
    }

    // ------------------------------------------------------------------------
    // Test 1: happy path -- non-trivial source, deterministic clone + mappings
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 1: happy path -- clones the current architecture, stamps provenance, writes equivalence mappings, excludes diagrams")
    void happyPathSuggestFromCurrent() {
        // ----- Seed source current architecture -----
        UUID sourceArchId = UUID.randomUUID();
        seedArchitecture(sourceArchId, projectId, "Current State");

        String mfId = "mf-" + UUID.randomUUID();
        ModelFileEntity modelFile = ModelFileEntity.builder()
            .id(mfId)
            .filename("model-file-" + UUID.randomUUID())
            .description("Source model file")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .projectId(projectId)
            .architectureId(sourceArchId)
            .build();
        modelFileRepository.save(modelFile);

        // 1 application
        String appId = "app-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO applications (id, model_file_id, name, abbreviation, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            appId, mfId, "Order System", "ORD", sourceArchId);

        // 2 application_components under the application
        String comp1Id = "comp-" + UUID.randomUUID();
        String comp2Id = "comp-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO application_components (id, model_file_id, application_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            comp1Id, mfId, appId, "Order API Component", sourceArchId);
        jdbcTemplate.update(
            "INSERT INTO application_components (id, model_file_id, application_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            comp2Id, mfId, appId, "Order Worker Component", sourceArchId);

        // 1 service under the application
        String svcId = "svc-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO services (id, model_file_id, application_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            svcId, mfId, appId, "Order Service", sourceArchId);

        // 1 interface under the service
        String ifId = "if-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO interfaces (id, model_file_id, service_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            ifId, mfId, svcId, "Order REST API", sourceArchId);

        // 2 endpoints under the interface
        String ep1Id = "ep-" + UUID.randomUUID();
        String ep2Id = "ep-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO endpoints (id, model_file_id, interface_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            ep1Id, mfId, ifId, "POST /orders", sourceArchId);
        jdbcTemplate.update(
            "INSERT INTO endpoints (id, model_file_id, interface_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            ep2Id, mfId, ifId, "GET /orders/{id}", sourceArchId);

        // 1 logical data entity with 2 attributes
        String ldeId = "lde-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO logical_data_entities (id, model_file_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?)",
            ldeId, mfId, "Order", sourceArchId);
        String attr1Id = "attr-" + UUID.randomUUID();
        String attr2Id = "attr-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO logical_data_attributes "
                + "(id, model_file_id, logical_entity_id, name, is_primary_key, is_nullable, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)",
            attr1Id, mfId, ldeId, "order_id", true, false, sourceArchId);
        jdbcTemplate.update(
            "INSERT INTO logical_data_attributes "
                + "(id, model_file_id, logical_entity_id, name, is_primary_key, is_nullable, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?)",
            attr2Id, mfId, ldeId, "customer_id", false, true, sourceArchId);

        // 1 physical data entity
        String pdeId = "pde-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO physical_data_entities (id, model_file_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?)",
            pdeId, mfId, "orders_table", sourceArchId);

        // Sanity-check: source has the expected element count (11 mappable rows:
        // 1 application + 2 components + 1 service + 1 interface + 2 endpoints +
        // 1 logical entity + 2 logical attributes + 1 physical entity).
        long sourceMappableCount = countSourceMappableRows(sourceArchId);
        assertThat(sourceMappableCount).isEqualTo(11);

        // ----- ACT -----
        SuggestFromCurrentResponse response = suggestService.suggestFromCurrent(
            projectId,
            new SuggestFromCurrentRequest(sourceArchId));

        // ----- (a) new target draft created with the spec's auto-name + flags -----
        assertThat(response).isNotNull();
        assertThat(response.newDraftId()).isNotEqualTo(sourceArchId);
        String expectedAutoName = "Target State - Suggested "
            + LocalDate.now(ZoneOffset.UTC).format(DATE_FORMAT);
        assertThat(response.resolvedName())
            .as("auto-name follows the spec's 'Target State - Suggested YYYY-MM-DD' pattern")
            .startsWith("Target State - Suggested ");
        // Accept either the base name or a same-day numeric suffix in case
        // another test in the cached Spring context created today's draft.
        assertThat(response.resolvedName()).matches(
            "Target State - Suggested " + LocalDate.now(ZoneOffset.UTC).format(DATE_FORMAT)
                + "( \\(\\d+\\))?");

        UUID newDraftId = response.newDraftId();
        ArchitectureEntity newDraft = architectureRepository.findById(newDraftId).orElseThrow();
        assertThat(newDraft.getKind()).isEqualTo("target");
        assertThat(newDraft.getDraftState()).isEqualTo("draft");
        assertThat(newDraft.getProjectId()).isEqualTo(projectId);
        assertThat(newDraft.getArchived()).isFalse();

        // ----- (b) every source element has a cloned counterpart with the
        //           spec's provenance value on the four supertype tables -----
        // application_components has provenance: assert both got stamped.
        List<Map<String, Object>> clonedComps = jdbcTemplate.queryForList(
            "SELECT name, provenance FROM application_components WHERE architecture_id = ?",
            newDraftId);
        assertThat(clonedComps).hasSize(2);
        for (Map<String, Object> row : clonedComps) {
            assertThat(row.get("provenance"))
                .as("application_components row should be stamped provenance='cloned-from'")
                .isEqualTo("cloned-from");
            assertThat(List.of("Order API Component", "Order Worker Component"))
                .contains((String) row.get("name"));
        }
        // interfaces also have a provenance column.
        List<Map<String, Object>> clonedIfs = jdbcTemplate.queryForList(
            "SELECT name, provenance FROM interfaces WHERE architecture_id = ?",
            newDraftId);
        assertThat(clonedIfs).hasSize(1);
        assertThat(clonedIfs.get(0).get("provenance")).isEqualTo("cloned-from");
        assertThat(clonedIfs.get(0).get("name")).isEqualTo("Order REST API");

        // Tables without a provenance column still get cloned 1:1: assert
        // names + counts on each mappable table.
        assertNameCountAndCloned("applications", newDraftId, sourceArchId,
            Set.of("Order System"));
        assertNameCountAndCloned("services", newDraftId, sourceArchId,
            Set.of("Order Service"));
        assertNameCountAndCloned("endpoints", newDraftId, sourceArchId,
            Set.of("POST /orders", "GET /orders/{id}"));
        assertNameCountAndCloned("logical_data_entities", newDraftId, sourceArchId,
            Set.of("Order"));
        assertNameCountAndCloned("logical_data_attributes", newDraftId, sourceArchId,
            Set.of("order_id", "customer_id"));
        assertNameCountAndCloned("physical_data_entities", newDraftId, sourceArchId,
            Set.of("orders_table"));

        // ----- (c) exactly one mapping row per cloned element with the spec's values -----
        List<ArchitectureElementMappingEntity> mappings =
            mappingRepository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                projectId, sourceArchId, newDraftId);
        // 11 mappable rows == 11 mappings (response count matches).
        assertThat(mappings).hasSize(11);
        assertThat(response.mappingRowCount()).isEqualTo(11);
        assertThat(response.clonedElementCount())
            .as("response clonedElementCount counts mappable rows (the elements that participated in Phase 3)")
            .isEqualTo(11);

        for (ArchitectureElementMappingEntity m : mappings) {
            assertThat(m.getMappingType()).isEqualTo("equivalent");
            assertThat(m.getStatus()).isEqualTo("confirmed");
            assertThat(m.getConfidence()).isEqualTo(1.0d);
            assertThat(m.getCreatedByTask()).isEqualTo("target-state-suggest");
            assertThat(m.getSourceArchitectureId()).isEqualTo(sourceArchId);
            assertThat(m.getTargetArchitectureId()).isEqualTo(newDraftId);
            assertThat(m.getSourceElementType()).isEqualTo(m.getTargetElementType());
            // source_element_id and target_element_id are populated and distinct.
            assertThat(m.getSourceElementId()).isNotBlank();
            assertThat(m.getTargetElementId()).isNotBlank();
            assertThat(m.getSourceElementId()).isNotEqualTo(m.getTargetElementId());
        }

        // ----- (d) diagram tables are NOT cloned -----
        // sequence_diagrams should have zero rows on the new architecture
        // even if the table exists in the H2 fixture.
        assertDiagramTableEmpty("sequence_diagrams", newDraftId);
        assertDiagramTableEmpty("sequence_fragments", newDraftId);
    }

    // ------------------------------------------------------------------------
    // Test 2: empty source -> 422 with the spec's message; no rows written
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 2: empty source architecture -> 422 with 'Current architecture has no elements to suggest from'; no draft + no mappings written")
    void emptySourceArchitectureReturns422() {
        // Seed only the architecture row -- no model_files, no applications,
        // no elements anywhere.
        UUID sourceArchId = UUID.randomUUID();
        seedArchitecture(sourceArchId, projectId, "Empty Current");

        long architecturesBefore = architectureRepository.count();
        long mappingsBefore = mappingRepository.count();

        // ACT + ASSERT
        assertThatThrownBy(() -> suggestService.suggestFromCurrent(
                projectId,
                new SuggestFromCurrentRequest(sourceArchId)))
            .isInstanceOf(EmptyCurrentArchitectureException.class)
            .hasMessage("Current architecture has no elements to suggest from");

        // No new architecture row was created.
        long architecturesAfter = architectureRepository.count();
        assertThat(architecturesAfter)
            .as("empty-source rejection must not commit any new architecture row")
            .isEqualTo(architecturesBefore);

        // No new mapping rows.
        long mappingsAfter = mappingRepository.count();
        assertThat(mappingsAfter)
            .as("empty-source rejection must not commit any architecture_element_mappings rows")
            .isEqualTo(mappingsBefore);

        // The source architecture row is still present and untouched.
        ArchitectureEntity sourceStill =
            architectureRepository.findById(sourceArchId).orElseThrow();
        assertThat(sourceStill.getName()).isEqualTo("Empty Current");
    }

    // ------------------------------------------------------------------------
    // Test 3: duplicate-named elements each get their OWN mapping (id
    // correlation, not by name), and the VIEWED draft reconciles before promote
    // (regression for the user-reported "everything unmapped / decommissioned").
    // ------------------------------------------------------------------------

    @Test
    @DisplayName("Test 3: duplicate-named elements both get mappings (id-correlation); the viewed draft reconciles before promote; null target no longer floods")
    void duplicateNamesMappedAndDraftScopedUnmappedReconciles() {
        // Seed 1 application + TWO application_components SHARING a name. This
        // mirrors the user's two physical_data_attributes named "ValidFrom":
        // the old by-name pairing collapsed duplicates into one mapping, leaving
        // the other current element flagged unmapped / "decommissioned in target".
        UUID sourceArchId = UUID.randomUUID();
        seedArchitecture(sourceArchId, projectId, "Current State");

        String mfId = "mf-" + UUID.randomUUID();
        modelFileRepository.save(ModelFileEntity.builder()
            .id(mfId)
            .filename("model-file-" + UUID.randomUUID())
            .description("Source model file")
            .createdAt(OffsetDateTime.now())
            .updatedAt(OffsetDateTime.now())
            .isDefault(false)
            .projectId(projectId)
            .architectureId(sourceArchId)
            .build());

        String appId = "app-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO applications (id, model_file_id, name, abbreviation, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            appId, mfId, "Order System", "ORD", sourceArchId);

        String dupA = "comp-" + UUID.randomUUID();
        String dupB = "comp-" + UUID.randomUUID();
        jdbcTemplate.update(
            "INSERT INTO application_components (id, model_file_id, application_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            dupA, mfId, appId, "Shared Component", sourceArchId);
        jdbcTemplate.update(
            "INSERT INTO application_components (id, model_file_id, application_id, name, architecture_id) "
                + "VALUES (?, ?, ?, ?, ?)",
            dupB, mfId, appId, "Shared Component", sourceArchId);

        // ----- ACT -----
        SuggestFromCurrentResponse response = suggestService.suggestFromCurrent(
            projectId, new SuggestFromCurrentRequest(sourceArchId));
        UUID newDraftId = response.newDraftId();

        // ----- Both duplicate-named components got their OWN mapping -----
        List<ArchitectureElementMappingEntity> compMappings =
            mappingRepository.findByProjectIdAndSourceArchitectureIdAndTargetArchitectureId(
                    projectId, sourceArchId, newDraftId)
                .stream()
                .filter(m -> "application_components".equals(m.getSourceElementType()))
                .toList();
        assertThat(compMappings)
            .as("each duplicate-named application_component must get its OWN mapping "
                + "(the by-name collapse dropped one before the id-correlation fix)")
            .hasSize(2);
        assertThat(compMappings)
            .extracting(ArchitectureElementMappingEntity::getSourceElementId)
            .containsExactlyInAnyOrder(dupA, dupB);

        // ----- The viewed draft reconciles BEFORE promote: scoping the unmapped
        //        gap to the new (draft_state='draft') target returns empty -----
        assertThat(unmappedService.findUnmapped(projectId, sourceArchId, newDraftId))
            .as("every current supertype element is mapped into the viewed draft, so "
                + "the unmapped gap is empty even though the draft is not yet promoted")
            .isEmpty();

        // ----- Null-target guard fix: with NO active target and no explicit
        //        target, the panel returns empty (NOT a false 'everything unmapped') -----
        assertThat(unmappedService.findUnmapped(projectId, sourceArchId, null))
            .as("no resolvable target -> empty list, not the old null-guard flood")
            .isEmpty();
    }

    // ------------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------------

    private void seedArchitecture(UUID id, UUID projectId, String name) {
        ArchitectureEntity arch = ArchitectureEntity.builder()
            .id(id)
            .projectId(projectId)
            .name(name)
            .archived(false)
            .build();
        architectureRepository.save(arch);
    }

    private long countSourceMappableRows(UUID archId) {
        long total = 0;
        for (String table : List.of(
                "applications",
                "application_components",
                "services",
                "interfaces",
                "endpoints",
                "logical_data_entities",
                "logical_data_attributes",
                "physical_data_entities")) {
            Long c = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE architecture_id = ?",
                Long.class, archId);
            if (c != null) {
                total += c;
            }
        }
        return total;
    }

    private void assertNameCountAndCloned(String table, UUID newArchId, UUID sourceArchId,
                                          Set<String> expectedNames) {
        List<Map<String, Object>> newRows = jdbcTemplate.queryForList(
            "SELECT id, name FROM " + table + " WHERE architecture_id = ?", newArchId);
        assertThat(newRows)
            .as("table '%s' should have %d cloned rows", table, expectedNames.size())
            .hasSize(expectedNames.size());
        Set<String> actualNames = new HashSet<>();
        Set<String> newIds = new HashSet<>();
        for (Map<String, Object> row : newRows) {
            actualNames.add((String) row.get("name"));
            newIds.add(row.get("id").toString());
        }
        assertThat(actualNames).isEqualTo(expectedNames);

        // Cloned ids must NOT collide with source ids (fresh UUIDs assertion).
        List<Map<String, Object>> sourceRows = jdbcTemplate.queryForList(
            "SELECT id FROM " + table + " WHERE architecture_id = ?", sourceArchId);
        Set<String> sourceIds = new HashSet<>();
        for (Map<String, Object> row : sourceRows) {
            sourceIds.add(row.get("id").toString());
        }
        for (String newId : newIds) {
            assertThat(sourceIds)
                .as("cloned row id '%s' on table '%s' must be a fresh UUID, not the source's id",
                    newId, table)
                .doesNotContain(newId);
        }
    }

    private void assertDiagramTableEmpty(String table, UUID newArchId) {
        try {
            Long count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM " + table + " WHERE architecture_id = ?",
                Long.class, newArchId);
            assertThat(count)
                .as("diagram table '%s' must have zero rows on the cloned target draft "
                    + "(spec: diagrams excluded from Suggest clone)",
                    table)
                .isEqualTo(0L);
        } catch (DataAccessException ex) {
            // Table may not exist in the H2 fixture; absent table also
            // satisfies the "diagram tables not cloned" assertion.
        }
    }
}
