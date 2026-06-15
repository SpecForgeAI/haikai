package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.model.dto.targetstate.ApplyMappingMutationsRequest;
import com.example.architecturemodel.model.entity.ArchitectureElementMappingEntity;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.repository.entity.ArchitectureElementMappingRepository;
import com.example.architecturemodel.service.ApplyMappingMutationsService;
import com.example.architecturemodel.service.TargetStateCapturedDecisionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests for the new apply-mapping-mutations endpoint.
 *
 * <p>Spec: Target State Architect-Persona Conversation
 * (2026-05-24-target-state-architect-conversation) -- Task Group 4.1
 * (AMS-side tests).</p>
 *
 * <p>Standalone MockMvc setup mirrors {@code TargetStateCapturedDecisionsControllerTest}:
 * no full Spring context (the project has unrelated pre-existing failures
 * documented in MEMORY.md), and {@code GlobalExceptionHandler} is wired by
 * hand so error envelopes go through the same mapping as in production.</p>
 *
 * <p>The {@link ApplyMappingMutationsService} is exercised through its public
 * surface in most tests so the {@code @Transactional} boundary, decorator
 * invocation, and {@code created_by_task} invariant are verified at the
 * spec-relevant level. Mocked dependencies are the
 * {@link TargetStateCapturedDecisionService} (so we control the cross-project
 * leak guard outcome) and the {@link ArchitectureElementMappingRepository}
 * (so we control candidate-row loading + assert per-row save behaviour).</p>
 */
@ExtendWith(MockitoExtension.class)
class ApplyMappingMutationsEndpointTest {

    @Mock
    private TargetStateCapturedDecisionService capturedDecisionService;

    @Mock
    private ArchitectureElementMappingRepository mappingRepository;

    private ApplyMappingMutationsService service;
    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TARGET_ARCH_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID DECISION_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SOURCE_ARCH_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");
    private static final String BASE =
        "/api/projects/{projectId}/target-architectures/{targetArchId}"
        + "/captured-decisions/{decisionId}/apply-mapping-mutations";

    @BeforeEach
    void setUp() {
        service = new ApplyMappingMutationsService(capturedDecisionService, mappingRepository);
        CapturedDecisionsApplyMappingMutationsController controller =
            new CapturedDecisionsApplyMappingMutationsController(service);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    // ---------------------------------------------------------------------
    // Fixture helpers
    // ---------------------------------------------------------------------

    private TargetStateCapturedDecisionEntity decisionFor(String decisionCode,
                                                          UUID projectId,
                                                          UUID targetArchId) {
        return TargetStateCapturedDecisionEntity.builder()
            .id(DECISION_ID)
            .projectId(projectId)
            .targetArchitectureId(targetArchId)
            .decisionCode(decisionCode)
            .scopeKind("architecture")
            .scopeRefType(null)
            .scopeRefId(null)
            .answerValue("PostgreSQL 18")
            .answerSummary("PostgreSQL 18")
            .standardsLookupRef("standards:" + decisionCode + ":v1")
            .conversationThreadId("thread-1")
            .conversationTurnRef("turn-1")
            .createdAt(Instant.parse("2026-05-24T10:00:00Z"))
            .createdByTask("architect-persona-conversation")
            .supersededById(null)
            .build();
    }

    private ArchitectureElementMappingEntity mapping(
            String sourceElementType,
            String sourceElementId,
            String targetElementType,
            String targetElementId,
            String mappingType,
            String originalCreatedByTask,
            String existingNotes) {
        return ArchitectureElementMappingEntity.builder()
            .id(UUID.randomUUID())
            .projectId(PROJECT_ID)
            .sourceArchitectureId(SOURCE_ARCH_ID)
            .targetArchitectureId(TARGET_ARCH_ID)
            .sourceElementType(sourceElementType)
            .sourceElementId(sourceElementId)
            .targetElementType(targetElementType)
            .targetElementId(targetElementId)
            .mappingType(mappingType)
            .status("confirmed")
            .createdByTask(originalCreatedByTask)
            .notes(existingNotes)
            .confidence(1.0)
            .createdAt(Instant.parse("2026-05-15T10:00:00Z"))
            .updatedAt(Instant.parse("2026-05-15T10:00:00Z"))
            .build();
    }

    private ApplyMappingMutationsRequest dbEngineRequest() {
        return new ApplyMappingMutationsRequest(
            List.of("physical_data_entity", "physical_data_attribute", "data_entity_points"),
            "keep-equivalent",
            "parent-not-leaf",
            null,
            null);
    }

    private ApplyMappingMutationsRequest apiProtocolRequest() {
        return new ApplyMappingMutationsRequest(
            List.of("interface", "endpoint"),
            "replaced_by",
            "parent-not-leaf",
            null,
            null);
    }

    private ApplyMappingMutationsRequest notesOnlyRequest() {
        return new ApplyMappingMutationsRequest(
            List.of(),
            "none",
            "parent-not-leaf",
            null,
            null);
    }

    // ---------------------------------------------------------------------
    // AMS Test 1 (combined Test 2): Happy path -- apply rules invokes the
    // decorator, returns a per-table-set summary, and the response uses
    // lowerCamelCase JSON keys (verifies @JsonNaming).
    //
    // Combined with AMS Test 2 (decorator invoked + idempotency): the second
    // invocation produces zero additional notesDecorations.
    // ---------------------------------------------------------------------

    @Test
    @DisplayName(
        "POST apply-mapping-mutations decorates notes idempotently, returns lowerCamelCase "
        + "per-table-set summary, and a second run produces zero further notesDecorations")
    void happyPathDecoratesNotesAndReturnsSummary() throws Exception {
        // Single physical_data_entity mapping; the decorator should add
        // [decision:db.engine] to notes; mapping_type already 'equivalent'
        // so keep-equivalent results in zero mappingTypeChanges.
        ArchitectureElementMappingEntity pdeMapping = mapping(
            "physical_data_entities", "src-pde-1",
            "physical_data_entities", "tgt-pde-1",
            "equivalent",
            "selective-copy-with-auto-map",
            "auto-mapped");

        when(capturedDecisionService.findById(PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .thenReturn(Optional.of(decisionFor("db.engine", PROJECT_ID, TARGET_ARCH_ID)));
        when(mappingRepository.findAll()).thenReturn(List.of(pdeMapping));

        String body = objectMapper.writeValueAsString(dbEngineRequest());

        // First run -- decorates, returns a summary.
        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            // Aggregate counts at the top level.
            .andExpect(jsonPath("$.affectedMappings").value(1))
            .andExpect(jsonPath("$.mappingTypeChanges").value(0))
            .andExpect(jsonPath("$.notesDecorations").value(1))
            // Per-table-set summary entries -- lowerCamelCase keys, singular
            // table identifiers as the gateway sent them.
            .andExpect(jsonPath("$.tableSetSummary.length()").value(3))
            .andExpect(jsonPath("$.tableSetSummary[0].tableSet").value("physical_data_entity"))
            .andExpect(jsonPath("$.tableSetSummary[0].affectedMappings").value(1))
            .andExpect(jsonPath("$.tableSetSummary[0].notesDecorations").value(1))
            // Defensive: confirm snake_case alternative is NOT present
            // (global SNAKE_CASE override does not slip through).
            .andExpect(jsonPath("$.affected_mappings").doesNotExist())
            .andExpect(jsonPath("$.table_set_summary").doesNotExist());

        // The notes field on the mapping was decorated with [decision:db.engine].
        ArgumentCaptor<ArchitectureElementMappingEntity> saved =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(mappingRepository, atLeastOnce()).save(saved.capture());
        assertThat(saved.getAllValues()).anySatisfy(m -> {
            assertThat(m.getNotes()).contains("[decision:db.engine]");
            // Q14: created_by_task untouched.
            assertThat(m.getCreatedByTask()).isEqualTo("selective-copy-with-auto-map");
        });

        // Second run -- decorator idempotency: re-run on the already-decorated
        // mapping. notesDecorations must be 0 because no row changed value.
        // The mapping returned has the [decision:db.engine] tag already.
        ArchitectureElementMappingEntity alreadyDecorated = saved.getValue();
        when(mappingRepository.findAll()).thenReturn(List.of(alreadyDecorated));

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            // No mapping row required a save -- notes already had the tag,
            // mapping_type already 'equivalent'.
            .andExpect(jsonPath("$.affectedMappings").value(0))
            .andExpect(jsonPath("$.notesDecorations").value(0))
            .andExpect(jsonPath("$.mappingTypeChanges").value(0));
    }

    // ---------------------------------------------------------------------
    // AMS Test 2: api.protocol rule -- mapping_type goes from equivalent to
    // replaced_by, notes decorated, created_by_task preserved.
    // ---------------------------------------------------------------------

    @Test
    @DisplayName(
        "api.protocol rule changes mapping_type to replaced_by, decorates notes, "
        + "and preserves created_by_task")
    void apiProtocolRuleAppliesMappingTypeChangeAndDecoratesNotes() throws Exception {
        ArchitectureElementMappingEntity interfaceMapping = mapping(
            "interfaces", "src-iface-1",
            "interfaces", "tgt-iface-1",
            "equivalent",
            "selective-copy-with-auto-map",
            null);

        when(capturedDecisionService.findById(PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .thenReturn(Optional.of(decisionFor("api.protocol", PROJECT_ID, TARGET_ARCH_ID)));
        when(mappingRepository.findAll()).thenReturn(List.of(interfaceMapping));

        String body = objectMapper.writeValueAsString(apiProtocolRequest());

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.affectedMappings").value(1))
            .andExpect(jsonPath("$.mappingTypeChanges").value(1))
            .andExpect(jsonPath("$.notesDecorations").value(1));

        ArgumentCaptor<ArchitectureElementMappingEntity> saved =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(mappingRepository).save(saved.capture());
        ArchitectureElementMappingEntity result = saved.getValue();
        // mapping_type changed from 'equivalent' to 'replaced_by'.
        assertThat(result.getMappingType()).isEqualTo("replaced_by");
        // Notes decorated with the api.protocol tag.
        assertThat(result.getNotes()).isEqualTo("[decision:api.protocol]");
        // Q14: created_by_task preserved.
        assertThat(result.getCreatedByTask()).isEqualTo("selective-copy-with-auto-map");
    }

    // ---------------------------------------------------------------------
    // AMS Test 3: Notes-only rule -- no mapping_type change, only notes
    // decoration. Affected set defaults to ALL mappings under the target
    // architecture (the decision is architecture-wide and no table sets are
    // listed).
    // ---------------------------------------------------------------------

    @Test
    @DisplayName("notes-only rule (defaultMappingTypeChange='none') decorates notes only; "
        + "no mapping_type changes")
    void notesOnlyRuleDoesNotChangeMappingType() throws Exception {
        ArchitectureElementMappingEntity serviceMapping = mapping(
            "services", "src-svc-1",
            "services", "tgt-svc-1",
            "equivalent",
            "selective-copy-with-auto-map",
            null);

        when(capturedDecisionService.findById(PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .thenReturn(Optional.of(decisionFor("ci.pipeline", PROJECT_ID, TARGET_ARCH_ID)));
        when(mappingRepository.findAll()).thenReturn(List.of(serviceMapping));

        String body = objectMapper.writeValueAsString(notesOnlyRequest());

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.affectedMappings").value(1))
            .andExpect(jsonPath("$.mappingTypeChanges").value(0))
            .andExpect(jsonPath("$.notesDecorations").value(1))
            // notes-only: tableSetSummary is empty.
            .andExpect(jsonPath("$.tableSetSummary.length()").value(0));

        ArgumentCaptor<ArchitectureElementMappingEntity> saved =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(mappingRepository).save(saved.capture());
        // mapping_type unchanged from 'equivalent'.
        assertThat(saved.getValue().getMappingType()).isEqualTo("equivalent");
        assertThat(saved.getValue().getNotes()).contains("[decision:ci.pipeline]");
    }

    // ---------------------------------------------------------------------
    // AMS Test 4: Cross-project leak protection. The service.findById guard
    // returns Optional.empty() on cross-project access; the endpoint must
    // return HTTP 404 (mirrors Spec 2 pattern -- NOT 403, NEVER leaks
    // existence to an attacker guessing sibling project UUIDs).
    // ---------------------------------------------------------------------

    @Test
    @DisplayName("cross-project mismatch returns HTTP 404 (not 403); existence is not leaked")
    void crossProjectMismatchReturns404() throws Exception {
        // The service-layer guard returns Optional.empty() on mismatch;
        // ApplyMappingMutationsService converts that to a
        // ResourceNotFoundException which the GlobalExceptionHandler maps to
        // HTTP 404.
        when(capturedDecisionService.findById(PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .thenReturn(Optional.empty());

        String body = objectMapper.writeValueAsString(dbEngineRequest());

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"));
    }

    // ---------------------------------------------------------------------
    // AMS Test 5: Per-element exception narrowing. When the request carries
    // elementRefType + elementRefId, the affected set narrows to a single
    // mapping row matching the source side (architecture exception is
    // anchored to the source-side element).
    // ---------------------------------------------------------------------

    @Test
    @DisplayName("per-element exception narrows the affected set to a single matching row")
    void perElementExceptionNarrowsToOneRow() throws Exception {
        ArchitectureElementMappingEntity targetedService = mapping(
            "services", "src-svc-target",
            "services", "tgt-svc-target",
            "equivalent",
            "selective-copy-with-auto-map",
            null);
        ArchitectureElementMappingEntity untouchedService = mapping(
            "services", "src-svc-other",
            "services", "tgt-svc-other",
            "equivalent",
            "selective-copy-with-auto-map",
            null);
        ArchitectureElementMappingEntity unrelatedInterface = mapping(
            "interfaces", "src-iface",
            "interfaces", "tgt-iface",
            "equivalent",
            "selective-copy-with-auto-map",
            null);

        when(capturedDecisionService.findById(PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .thenReturn(Optional.of(decisionFor("service.framework", PROJECT_ID, TARGET_ARCH_ID)));
        when(mappingRepository.findAll())
            .thenReturn(List.of(targetedService, untouchedService, unrelatedInterface));

        ApplyMappingMutationsRequest perElementRequest = new ApplyMappingMutationsRequest(
            List.of("service"),
            "keep-equivalent",
            "parent-not-leaf",
            "service",
            "src-svc-target");
        String body = objectMapper.writeValueAsString(perElementRequest);

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            // Only the targeted mapping was touched.
            .andExpect(jsonPath("$.affectedMappings").value(1))
            .andExpect(jsonPath("$.notesDecorations").value(1));

        // Verify only the targeted row was saved.
        ArgumentCaptor<ArchitectureElementMappingEntity> saved =
            ArgumentCaptor.forClass(ArchitectureElementMappingEntity.class);
        verify(mappingRepository).save(saved.capture());
        List<ArchitectureElementMappingEntity> savedRows = new ArrayList<>(saved.getAllValues());
        assertThat(savedRows).hasSize(1);
        assertThat(savedRows.get(0).getSourceElementId()).isEqualTo("src-svc-target");
    }

    // ---------------------------------------------------------------------
    // AMS Test 6: Validation -- HTTP 400 envelope on malformed request (e.g.
    // unknown defaultMappingTypeChange). Demonstrates the validation is
    // surfaced through GlobalExceptionHandler the same way as the rest of
    // the surface. Validation runs BEFORE the captured-decision findById
    // guard -- no mock setup is needed.
    // ---------------------------------------------------------------------

    @Test
    @DisplayName("malformed defaultMappingTypeChange returns HTTP 400 with the bad-request envelope")
    void malformedChangeKindReturns400() throws Exception {
        String body = objectMapper.writeValueAsString(Map.of(
            "affectedTableSets", List.of("service"),
            "defaultMappingTypeChange", "not-a-real-change-kind",
            "scopeBoundary", "parent-not-leaf"));

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.status").value(400))
            .andExpect(jsonPath("$.error").value("Bad Request"));
    }
}
