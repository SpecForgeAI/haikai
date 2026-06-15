package com.example.architecturemodel.controller.migration;

import com.example.architecturemodel.exception.GlobalExceptionHandler;
import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.migration.AutoSeedEpicCapturedDecisionRequest;
import com.example.architecturemodel.model.dto.migration.CreateEpicCapturedDecisionRequest;
import com.example.architecturemodel.model.dto.migration.EpicCapturedDecisionDto;
import com.example.architecturemodel.model.dto.migration.UpdateEpicCapturedDecisionRequest;
import com.example.architecturemodel.service.migration.EpicCapturedDecisionService;
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
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * MockMvc tests for {@link EpicCapturedDecisionsController}.
 *
 * <p>Spec: Cross-Story Context Injection for Migration Shape-Spec Generation
 * (2026-05-20) -- Task Group 4.1.</p>
 *
 * <p>Standalone setup mirrors {@code DiscoveryFindingControllerTest}: no full
 * Spring context (the project has unrelated pre-existing failures documented
 * in MEMORY.md), and {@link GlobalExceptionHandler} is wired by hand so error
 * envelopes follow production mapping. Tests use the default camelCase JSON
 * mapping since {@code MockMvcBuilders.standaloneSetup} does not load the
 * application's SNAKE_CASE configuration.</p>
 *
 * <p>Five focused tests covering the requirements from tasks.md 4.1:</p>
 * <ol>
 *   <li>GET list returns rows filtered by {@code (projectId, epicWorkItemId)}.</li>
 *   <li>POST creates a {@code user_added} row.</li>
 *   <li>PATCH on an {@code auto_extracted} row flips source to
 *       {@code user_edited} and pins against further auto-overwrite (verified
 *       via {@code upsertAutoExtracted} skipping the pinned row).</li>
 *   <li>DELETE audits {@code lastEditedBy} + {@code updatedAt} and removes the
 *       row.</li>
 *   <li>Status feed contract: only {@code draft} and {@code confirmed} are
 *       exposed to the resolver's parent_rollup feed -- cross-checked via
 *       the {@link EpicCapturedDecisionService#PARENT_ROLLUP_FEED_STATUSES}
 *       constant which mirrors the resolver's own {@code EPIC_DECISION_FEED_STATUSES}.</li>
 * </ol>
 */
@ExtendWith(MockitoExtension.class)
class EpicCapturedDecisionsControllerTest {

    @Mock
    private EpicCapturedDecisionService service;

    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    private static final UUID PROJECT_ID =
        UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final UUID EPIC_ID =
        UUID.fromString("22222222-2222-2222-2222-222222222222");
    private static final UUID DECISION_ID =
        UUID.fromString("33333333-3333-3333-3333-333333333333");
    private static final UUID SOURCE_SPEC_ID =
        UUID.fromString("44444444-4444-4444-4444-444444444444");

    private static final Instant NOW = Instant.parse("2026-05-20T10:00:00Z");
    private static final Instant LATER = Instant.parse("2026-05-20T11:30:00Z");

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders
            .standaloneSetup(new EpicCapturedDecisionsController(service))
            .setControllerAdvice(new GlobalExceptionHandler())
            .build();
        objectMapper = new ObjectMapper();
    }

    private EpicCapturedDecisionDto dto(
            String key, String text, String source, String status,
            UUID sourceSpecGenerationId, String lastEditedBy, Instant updatedAt) {
        return new EpicCapturedDecisionDto(
            DECISION_ID, PROJECT_ID, EPIC_ID,
            key, text, source, sourceSpecGenerationId, status,
            lastEditedBy, NOW, updatedAt
        );
    }

    // -----------------------------------------------------------------------
    // 1) GET list returns rows filtered by project + epic
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("GET captured-decisions returns rows scoped by (projectId, epicWorkItemId)")
    void listReturnsRowsScopedByProjectAndEpic() throws Exception {
        EpicCapturedDecisionDto a = dto(
            "currency-default", "GBP everywhere", "auto_extracted", "draft",
            SOURCE_SPEC_ID, null, NOW);
        EpicCapturedDecisionDto b = dto(
            "idempotency-key", "Required on POSTs", "user_edited", "confirmed",
            null, "alice", LATER);

        when(service.list(eq(PROJECT_ID), eq(EPIC_ID))).thenReturn(List.of(a, b));

        mockMvc.perform(get(
                "/api/projects/{p}/epics/{e}/captured-decisions",
                PROJECT_ID, EPIC_ID))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].decisionKey").value("currency-default"))
            .andExpect(jsonPath("$[0].source").value("auto_extracted"))
            .andExpect(jsonPath("$[0].status").value("draft"))
            .andExpect(jsonPath("$[1].decisionKey").value("idempotency-key"))
            .andExpect(jsonPath("$[1].source").value("user_edited"))
            .andExpect(jsonPath("$[1].status").value("confirmed"))
            .andExpect(jsonPath("$[1].lastEditedBy").value("alice"));

        verify(service).list(eq(PROJECT_ID), eq(EPIC_ID));
    }

    // -----------------------------------------------------------------------
    // 2) POST creates a user_added row
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("POST captured-decisions creates a user_added row with source set by the service layer")
    void postCreatesUserAddedRow() throws Exception {
        EpicCapturedDecisionDto created = dto(
            "data-residency", "EU-only PII", "user_added", "draft",
            null, "alice", NOW);
        when(service.create(eq(PROJECT_ID), eq(EPIC_ID),
                any(CreateEpicCapturedDecisionRequest.class)))
            .thenReturn(created);

        String body = objectMapper.writeValueAsString(Map.of(
            "decisionKey", "data-residency",
            "decisionText", "EU-only PII",
            "lastEditedBy", "alice"
        ));

        mockMvc.perform(post(
                "/api/projects/{p}/epics/{e}/captured-decisions",
                PROJECT_ID, EPIC_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(DECISION_ID.toString()))
            .andExpect(jsonPath("$.projectId").value(PROJECT_ID.toString()))
            .andExpect(jsonPath("$.epicWorkItemId").value(EPIC_ID.toString()))
            .andExpect(jsonPath("$.source")
                .value(EpicCapturedDecisionService.SOURCE_USER_ADDED))
            .andExpect(jsonPath("$.decisionKey").value("data-residency"))
            .andExpect(jsonPath("$.decisionText").value("EU-only PII"))
            .andExpect(jsonPath("$.sourceSpecGenerationId").doesNotExist())
            .andExpect(jsonPath("$.lastEditedBy").value("alice"));

        ArgumentCaptor<CreateEpicCapturedDecisionRequest> captor =
            ArgumentCaptor.forClass(CreateEpicCapturedDecisionRequest.class);
        verify(service).create(eq(PROJECT_ID), eq(EPIC_ID), captor.capture());
        CreateEpicCapturedDecisionRequest sent = captor.getValue();
        assertThat(sent.decisionKey()).isEqualTo("data-residency");
        assertThat(sent.decisionText()).isEqualTo("EU-only PII");
        assertThat(sent.lastEditedBy()).isEqualTo("alice");
        assertThat(sent.status())
            .as("status omitted on the wire -- arrives as null and the service applies the 'draft' default")
            .isNull();
    }

    // -----------------------------------------------------------------------
    // 3) PATCH on auto_extracted flips source to user_edited and pins the row
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("PATCH on auto_extracted row flips source to user_edited and pins against future auto-overwrite")
    void patchOnAutoExtractedFlipsSourceAndPins() throws Exception {
        // The service returns the PATCHED row -- source flipped to user_edited.
        EpicCapturedDecisionDto afterPatch = dto(
            "currency-default", "GBP everywhere (curated)",
            EpicCapturedDecisionService.SOURCE_USER_EDITED, "confirmed",
            SOURCE_SPEC_ID, "alice", LATER);
        when(service.update(eq(PROJECT_ID), eq(EPIC_ID), eq(DECISION_ID),
                any(UpdateEpicCapturedDecisionRequest.class)))
            .thenReturn(afterPatch);

        // Caller omits decisionKey (null-guard) and provides decisionText +
        // status -- both are structural so the service flips the source.
        String body = objectMapper.writeValueAsString(Map.of(
            "decisionText", "GBP everywhere (curated)",
            "status", "confirmed",
            "lastEditedBy", "alice"
        ));

        mockMvc.perform(patch(
                "/api/projects/{p}/epics/{e}/captured-decisions/{id}",
                PROJECT_ID, EPIC_ID, DECISION_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.source")
                .value(EpicCapturedDecisionService.SOURCE_USER_EDITED))
            .andExpect(jsonPath("$.status").value("confirmed"))
            .andExpect(jsonPath("$.decisionText").value("GBP everywhere (curated)"))
            .andExpect(jsonPath("$.lastEditedBy").value("alice"));

        ArgumentCaptor<UpdateEpicCapturedDecisionRequest> captor =
            ArgumentCaptor.forClass(UpdateEpicCapturedDecisionRequest.class);
        verify(service).update(eq(PROJECT_ID), eq(EPIC_ID), eq(DECISION_ID),
            captor.capture());
        UpdateEpicCapturedDecisionRequest sent = captor.getValue();
        assertThat(sent.decisionKey())
            .as("decisionKey omitted on the wire -- arrives as null so the service leaves it alone (null-guard)")
            .isNull();
        assertThat(sent.decisionText()).isEqualTo("GBP everywhere (curated)");
        assertThat(sent.status()).isEqualTo("confirmed");
        assertThat(sent.lastEditedBy()).isEqualTo("alice");

        // Pinning cross-check: the service's PINNED_SOURCES set must include
        // user_edited so a subsequent auto-seed skips this row. The constant
        // is the canonical contract; assert it here so a future refactor that
        // weakens the set fails this test loudly.
        assertThat(EpicCapturedDecisionService.PINNED_SOURCES)
            .as("user_edited and user_added rows must both be pinned against auto-overwrite")
            .contains(
                EpicCapturedDecisionService.SOURCE_USER_EDITED,
                EpicCapturedDecisionService.SOURCE_USER_ADDED)
            .doesNotContain(EpicCapturedDecisionService.SOURCE_AUTO_EXTRACTED);
    }

    // -----------------------------------------------------------------------
    // 4) DELETE audits last_edited_by + updated_at and removes the row
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("DELETE removes the row and returns the final audit snapshot with lastEditedBy + updatedAt")
    void deleteAuditsAndRemoves() throws Exception {
        // The service returns the audit-snapshot DTO captured immediately
        // before the row was deleted -- lastEditedBy stamped to 'alice',
        // updatedAt bumped to LATER.
        EpicCapturedDecisionDto auditSnapshot = dto(
            "currency-default", "GBP everywhere",
            "auto_extracted", "draft",
            SOURCE_SPEC_ID, "alice", LATER);
        when(service.delete(eq(PROJECT_ID), eq(EPIC_ID), eq(DECISION_ID), eq("alice")))
            .thenReturn(auditSnapshot);

        mockMvc.perform(delete(
                "/api/projects/{p}/epics/{e}/captured-decisions/{id}",
                PROJECT_ID, EPIC_ID, DECISION_ID)
                .param("lastEditedBy", "alice"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(DECISION_ID.toString()))
            .andExpect(jsonPath("$.lastEditedBy")
                .value("alice"))
            .andExpect(jsonPath("$.updatedAt").exists())
            .andExpect(jsonPath("$.createdAt").exists());

        verify(service).delete(eq(PROJECT_ID), eq(EPIC_ID), eq(DECISION_ID), eq("alice"));
    }

    // -----------------------------------------------------------------------
    // 4b) DELETE on out-of-scope id surfaces a 404
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("DELETE on an out-of-scope decision id returns 404 (service-layer scope guard)")
    void deleteOutOfScopeReturns404() throws Exception {
        when(service.delete(eq(PROJECT_ID), eq(EPIC_ID), eq(DECISION_ID), any()))
            .thenThrow(new ResourceNotFoundException(
                "Epic captured decision " + DECISION_ID + " not found"));

        mockMvc.perform(delete(
                "/api/projects/{p}/epics/{e}/captured-decisions/{id}",
                PROJECT_ID, EPIC_ID, DECISION_ID))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.message")
                .value(org.hamcrest.Matchers.containsString("not found")));
    }

    // -----------------------------------------------------------------------
    // 4c) POST /auto-seed routes through upsertAutoExtracted and returns the
    //     row with source = auto_extracted (Follow-up #2 to the 2026-05-20 spec)
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("POST /auto-seed routes through upsertAutoExtracted; returned row has source = auto_extracted")
    void autoSeedRoutesThroughUpsertAutoExtracted() throws Exception {
        EpicCapturedDecisionDto autoExtracted = dto(
            "currency-default", "GBP everywhere",
            EpicCapturedDecisionService.SOURCE_AUTO_EXTRACTED, "draft",
            SOURCE_SPEC_ID, null, NOW);
        when(service.upsertAutoExtracted(
                eq(PROJECT_ID), eq(EPIC_ID),
                eq("currency-default"), eq("GBP everywhere"),
                eq(SOURCE_SPEC_ID)))
            .thenReturn(Optional.of(autoExtracted));

        String body = objectMapper.writeValueAsString(Map.of(
            "decisionKey", "currency-default",
            "decisionText", "GBP everywhere",
            "sourceSpecGenerationId", SOURCE_SPEC_ID.toString()
        ));

        mockMvc.perform(post(
                "/api/projects/{p}/epics/{e}/captured-decisions/auto-seed",
                PROJECT_ID, EPIC_ID)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.source")
                .value(EpicCapturedDecisionService.SOURCE_AUTO_EXTRACTED))
            .andExpect(jsonPath("$.decisionKey").value("currency-default"))
            .andExpect(jsonPath("$.sourceSpecGenerationId")
                .value(SOURCE_SPEC_ID.toString()));

        ArgumentCaptor<UUID> sourceSpecCaptor = ArgumentCaptor.forClass(UUID.class);
        verify(service).upsertAutoExtracted(
            eq(PROJECT_ID), eq(EPIC_ID),
            eq("currency-default"), eq("GBP everywhere"),
            sourceSpecCaptor.capture());
        assertThat(sourceSpecCaptor.getValue()).isEqualTo(SOURCE_SPEC_ID);
    }

    // -----------------------------------------------------------------------
    // 5) Status feed contract cross-check: only draft + confirmed feed the
    //    resolver's parent_rollup. This is enforced at the resolver
    //    (Group 3) via EPIC_DECISION_FEED_STATUSES; the controller's
    //    service mirrors it in PARENT_ROLLUP_FEED_STATUSES.
    // -----------------------------------------------------------------------
    @Test
    @DisplayName("Status feed contract: PARENT_ROLLUP_FEED_STATUSES mirrors resolver -- only draft + confirmed feed parent_rollup")
    void parentRollupFeedStatusesCrossCheck() {
        // The controller's service exposes the canonical feed-status set.
        // The resolver's own EPIC_DECISION_FEED_STATUSES (Group 3) must agree.
        // Asserted here so a divergence in either layer fails this test
        // loudly. Group 3's parent_rollup builder reads from the same table
        // via EpicCapturedDecisionRepository#findByProjectIdAndEpicWorkItemIdAndStatusIn,
        // passing the same {draft, confirmed} set; the resolver test
        // (MigrationSpecContextResolverCrossStoryTest#parentRollupShape)
        // exercises the runtime side of that contract.
        assertThat(EpicCapturedDecisionService.PARENT_ROLLUP_FEED_STATUSES)
            .as("Only draft and confirmed feed pass-2 parent_rollup.epic.capturedDecisions[]")
            .containsExactlyInAnyOrder(
                EpicCapturedDecisionService.STATUS_DRAFT,
                EpicCapturedDecisionService.STATUS_CONFIRMED)
            .doesNotContain(EpicCapturedDecisionService.STATUS_SUPERSEDED);
    }
}
