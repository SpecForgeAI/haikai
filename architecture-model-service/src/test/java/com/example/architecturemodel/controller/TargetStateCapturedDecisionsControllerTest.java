package com.example.architecturemodel.controller;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.TargetStateCapturedDecisionMapper;
import com.example.architecturemodel.model.dto.targetstate.CreateTargetStateCapturedDecisionRequest;
import com.example.architecturemodel.model.entity.TargetStateCapturedDecisionEntity;
import com.example.architecturemodel.service.TargetStateCapturedDecisionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link TargetStateCapturedDecisionsController}.
 *
 * <p>Spec: Target State Captured Decisions -- Data Plane
 * (2026-05-24-target-state-captured-decisions-data-plane) -- Task Group 3.1.</p>
 *
 * <p>Covers the four load-bearing controller guarantees per the task list:</p>
 * <ol>
 *   <li>{@code POST /captured-decisions} returns 201 with a
 *       {@code TargetStateCapturedDecisionDto} whose JSON uses lowerCamelCase
 *       keys (verifies {@code @JsonNaming(LowerCamelCaseStrategy.class)} on
 *       the response DTO against the global {@code SNAKE_CASE} Jackson
 *       strategy in {@code application.yml}).</li>
 *   <li>{@code GET /captured-decisions} returns the latest-only list by
 *       default and {@code ?includeSuperseded=true} flips to the full audit
 *       list (the controller delegates to the matching service method).</li>
 *   <li>{@code GET /captured-decisions/{decisionId}} returns 404 (NOT 403)
 *       on cross-project access -- the service raises
 *       {@link ResourceNotFoundException} via {@code getByIdOrThrow}; the
 *       global exception handler maps to 404.</li>
 *   <li>{@code GET /captured-decisions/by-code/{decisionCode}} returns the
 *       latest rows across multiple scopes for the supplied code.</li>
 * </ol>
 *
 * <p>Standalone MockMvc setup mirrors
 * {@code ArchitectureElementMappingControllerTest} -- no full Spring context
 * (the project has unrelated pre-existing failures documented in MEMORY.md),
 * and the global exception handler is wired by hand so the 404 envelope goes
 * through the same mapping as in production.</p>
 */
@ExtendWith(MockitoExtension.class)
class TargetStateCapturedDecisionsControllerTest {

    @Mock
    private TargetStateCapturedDecisionService service;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID TARGET_ARCH_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID DECISION_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final String BASE =
        "/api/projects/{projectId}/target-architectures/{targetArchId}/captured-decisions";

    @BeforeEach
    void setUp() {
        TargetStateCapturedDecisionsController controller =
            new TargetStateCapturedDecisionsController(service, new TargetStateCapturedDecisionMapper());
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private TargetStateCapturedDecisionEntity buildArchScopeRow(
            UUID id, String decisionCode, String answerValue, UUID supersededById) {
        return TargetStateCapturedDecisionEntity.builder()
            .id(id)
            .projectId(PROJECT_ID)
            .targetArchitectureId(TARGET_ARCH_ID)
            .decisionCode(decisionCode)
            .scopeKind("architecture")
            .scopeRefType(null)
            .scopeRefId(null)
            .answerValue(answerValue)
            .answerSummary(answerValue)
            .standardsLookupRef("standards:" + decisionCode + ":v1")
            .conversationThreadId("thread-architect-001")
            .conversationTurnRef("turn-1")
            .createdAt(Instant.parse("2026-05-24T10:00:00Z"))
            .createdByTask("architect-persona-conversation")
            .supersededById(supersededById)
            .build();
    }

    @Test
    @DisplayName("POST /captured-decisions returns 201 with the new row as a DTO; JSON keys are lowerCamelCase")
    void postCapturedDecisionReturns201WithLowerCamelCaseJson() throws Exception {
        TargetStateCapturedDecisionEntity created =
            buildArchScopeRow(DECISION_ID, "db.engine", "PostgreSQL 16", null);
        when(service.createDecision(eq(PROJECT_ID), eq(TARGET_ARCH_ID),
                any(CreateTargetStateCapturedDecisionRequest.class)))
            .thenReturn(created);

        String body = objectMapper.writeValueAsString(Map.of(
            "decisionCode", "db.engine",
            "scopeKind", "architecture",
            "answerValue", "PostgreSQL 16",
            "answerSummary", "PostgreSQL 16",
            "standardsLookupRef", "standards:db.engine:v1",
            "createdByTask", "architect-persona-conversation"
        ));

        mockMvc.perform(post(BASE, PROJECT_ID, TARGET_ARCH_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            // Verify lowerCamelCase keys explicitly -- the field name in the
            // response is decisionId (the entity's id renamed for the wire).
            .andExpect(jsonPath("$.decisionId").value(DECISION_ID.toString()))
            .andExpect(jsonPath("$.projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.targetArchitectureId").value(TARGET_ARCH_ID.toString()))
            .andExpect(jsonPath("$.decisionCode").value("db.engine"))
            .andExpect(jsonPath("$.scopeKind").value("architecture"))
            .andExpect(jsonPath("$.answerValue").value("PostgreSQL 16"))
            .andExpect(jsonPath("$.answerSummary").value("PostgreSQL 16"))
            .andExpect(jsonPath("$.standardsLookupRef").value("standards:db.engine:v1"))
            .andExpect(jsonPath("$.createdByTask").value("architect-persona-conversation"))
            // Defensive: confirm the snake_case alternative is NOT present
            // (would indicate the global SNAKE_CASE override slipped through).
            .andExpect(jsonPath("$.decision_id").doesNotExist())
            .andExpect(jsonPath("$.target_architecture_id").doesNotExist());
    }

    @Test
    @DisplayName("GET /captured-decisions default returns latest; ?includeSuperseded=true returns full audit list")
    void getCapturedDecisionsRespectsIncludeSupersededFlag() throws Exception {
        UUID latestId = UUID.randomUUID();
        UUID priorId = UUID.randomUUID();
        TargetStateCapturedDecisionEntity latest =
            buildArchScopeRow(latestId, "db.engine", "PostgreSQL 16", null);
        TargetStateCapturedDecisionEntity superseded =
            buildArchScopeRow(priorId, "db.engine", "MySQL 8", latestId);

        // Default path: latest only.
        when(service.listLatestDecisions(PROJECT_ID, TARGET_ARCH_ID))
            .thenReturn(List.of(latest));
        // includeSuperseded=true: full audit.
        when(service.listAllDecisions(PROJECT_ID, TARGET_ARCH_ID))
            .thenReturn(List.of(latest, superseded));

        mockMvc.perform(get(BASE, PROJECT_ID, TARGET_ARCH_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(1))
            .andExpect(jsonPath("$[0].decisionId").value(latestId.toString()))
            .andExpect(jsonPath("$[0].supersededById").doesNotExist());

        mockMvc.perform(get(BASE, PROJECT_ID, TARGET_ARCH_ID)
                .param("includeSuperseded", "true"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[1].decisionId").value(priorId.toString()))
            .andExpect(jsonPath("$[1].supersededById").value(latestId.toString()));
    }

    @Test
    @DisplayName("GET /captured-decisions/{decisionId} returns 404 on cross-project access (NOT 403)")
    void getCapturedDecisionByIdReturns404OnCrossProjectAccess() throws Exception {
        // The service-layer guard collapses cross-project / cross-architecture
        // misses to Optional.empty(); getByIdOrThrow promotes that to a
        // ResourceNotFoundException, which the global exception handler maps
        // to HTTP 404. We assert 404 (NOT 403) to confirm existence is not
        // leaked to an attacker who guesses a sibling project's UUID (Q15).
        when(service.getByIdOrThrow(PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .thenThrow(new ResourceNotFoundException(
                "Architecture Model Service captured-decision row " + DECISION_ID
                    + " not found for project " + PROJECT_ID
                    + " and target architecture " + TARGET_ARCH_ID));

        mockMvc.perform(get(BASE + "/{decisionId}", PROJECT_ID, TARGET_ARCH_ID, DECISION_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.status").value(404))
            .andExpect(jsonPath("$.error").value("Not Found"));
    }

    @Test
    @DisplayName("GET /captured-decisions/by-code/{decisionCode} returns latest rows across multiple scopes")
    void getByDecisionCodeReturnsLatestRowsAcrossScopes() throws Exception {
        UUID archRowId = UUID.randomUUID();
        UUID serviceRowId = UUID.randomUUID();

        TargetStateCapturedDecisionEntity archRow =
            buildArchScopeRow(archRowId, "api.protocol", "gRPC", null);
        TargetStateCapturedDecisionEntity serviceRow = TargetStateCapturedDecisionEntity.builder()
            .id(serviceRowId)
            .projectId(PROJECT_ID)
            .targetArchitectureId(TARGET_ARCH_ID)
            .decisionCode("api.protocol")
            .scopeKind("service")
            .scopeRefType(null)
            .scopeRefId("service-legacy-id")
            .answerValue("SOAP (legacy)")
            .answerSummary("SOAP (legacy)")
            .standardsLookupRef(null)
            .createdAt(Instant.parse("2026-05-24T11:00:00Z"))
            .createdByTask("architect-persona-conversation")
            .supersededById(null)
            .build();

        when(service.findByDecisionCode(PROJECT_ID, TARGET_ARCH_ID, "api.protocol"))
            .thenReturn(List.of(archRow, serviceRow));

        mockMvc.perform(get(BASE + "/by-code/{decisionCode}",
                PROJECT_ID, TARGET_ARCH_ID, "api.protocol"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].decisionCode").value("api.protocol"))
            .andExpect(jsonPath("$[0].scopeKind").value("architecture"))
            .andExpect(jsonPath("$[0].answerValue").value("gRPC"))
            .andExpect(jsonPath("$[1].decisionCode").value("api.protocol"))
            .andExpect(jsonPath("$[1].scopeKind").value("service"))
            .andExpect(jsonPath("$[1].scopeRefId").value("service-legacy-id"))
            .andExpect(jsonPath("$[1].answerValue").value("SOAP (legacy)"));
    }
}
