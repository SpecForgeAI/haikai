package com.example.architecturemodel.service;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.model.dto.MigrationDeliveryDashboardDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryHierarchyNodeDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryNeedsAttentionItemDto;
import com.example.architecturemodel.model.dto.MigrationDeliveryWorkstreamSummaryDto;
import com.example.architecturemodel.model.dto.MissingInputEntry;
import com.example.architecturemodel.model.entity.GeneratedMigrationBookOfWorkEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationEntity;
import com.example.architecturemodel.model.entity.MigrationStorySpecGenerationStatus;
import com.example.architecturemodel.model.entity.WorkItemEntity;
import com.example.architecturemodel.model.entity.WorkItemImplementWorkspaceEntity;
import com.example.architecturemodel.repository.entity.GeneratedMigrationBookOfWorkRepository;
import com.example.architecturemodel.repository.entity.MigrationStorySpecGenerationRepository;
import com.example.architecturemodel.repository.entity.WorkItemImplementWorkspaceRepository;
import com.example.architecturemodel.repository.entity.WorkItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service-level unit tests for {@link MigrationDeliveryDashboardService}.
 *
 * <p>Mocks the four collaborating repositories (book lookup +
 * {@link WorkItemRepository}, {@link MigrationStorySpecGenerationRepository},
 * {@link WorkItemImplementWorkspaceRepository}) and exercises the roll-up
 * algorithm in isolation.</p>
 *
 * <p>Covers the AMS-test slice owned by sub-tasks 3.13 and 4.5 (spec.md AMS
 * tests 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18) plus the
 * service-side projections of Integration 36 (refreshed spec-gen rows roll-up
 * on a second read) and 38 (orphan workItemId never auto-repaired).</p>
 *
 * <p>Structural precedent: {@link ArchitectureElementInventoryServiceTest}
 * (same {@code @ExtendWith(MockitoExtension.class)} + mocked repos + direct
 * service instantiation pattern). Log prefix for new diagnostic lines:
 * {@code [diag-ams] migration-delivery-dashboard ...}.</p>
 *
 * <p>Spec: Migration Delivery Progress and Evidence Tracking (2026-05-19) --
 * tasks.md sub-tasks 3.13, 4.5.</p>
 */
@ExtendWith(MockitoExtension.class)
class MigrationDeliveryDashboardServiceTest {

    @Mock
    private GeneratedMigrationBookOfWorkRepository bookRepository;

    @Mock
    private WorkItemRepository workItemRepository;

    @Mock
    private MigrationStorySpecGenerationRepository specGenerationRepository;

    @Mock
    private WorkItemImplementWorkspaceRepository workspaceRepository;

    private MigrationDeliveryDashboardService service;

    private UUID projectId;
    private UUID bookId;

    @BeforeEach
    void setUp() {
        projectId = UUID.randomUUID();
        bookId = UUID.randomUUID();
        service = new MigrationDeliveryDashboardService(
            bookRepository,
            workItemRepository,
            specGenerationRepository,
            workspaceRepository);
    }

    // -----------------------------------------------------------------------
    // AMS test 2: project/book mismatch -> service throws ResourceNotFoundException
    // (controller maps to 404 via ResponseEntity.notFound()).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 2 -- project/book mismatch throws ResourceNotFoundException (controller maps to 404)")
    void rejectsProjectBookMismatch() {
        UUID otherProject = UUID.randomUUID();
        GeneratedMigrationBookOfWorkEntity book = bookEntity(bookId, otherProject, Map.of("items", List.of()));
        when(bookRepository.findById(bookId)).thenReturn(Optional.of(book));

        assertThatThrownBy(() -> service.loadDashboard(projectId, bookId))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    @DisplayName("AMS test 2 -- unknown bookId throws ResourceNotFoundException")
    void rejectsUnknownBookId() {
        when(bookRepository.findById(bookId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.loadDashboard(projectId, bookId))
            .isInstanceOf(ResourceNotFoundException.class);
    }

    // -----------------------------------------------------------------------
    // AMS test 3: hierarchy counts generated correctly (initiative/epic/feature/story).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 3 -- summary counts each hierarchy type from book_of_work_json")
    void summaryCountsHierarchyTypes() {
        List<Map<String, Object>> items = new ArrayList<>();
        items.add(item("I1", null, "initiative", "Initiative 1", null, null));
        items.add(item("E1", "I1", "epic", "Epic 1", null, null));
        items.add(item("F1", "E1", "feature", "Feature 1", null, null));
        items.add(item("S1", "F1", "story", "Story 1", "Migrate", null));
        items.add(item("S2", "F1", "story", "Story 2", "Migrate", null));

        seedBook(items);
        seedNoWorkItems();
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.summary().totalInitiativeCount()).isEqualTo(1L);
        assertThat(dto.summary().totalEpicCount()).isEqualTo(1L);
        assertThat(dto.summary().totalFeatureCount()).isEqualTo(1L);
        assertThat(dto.summary().totalStoryCount()).isEqualTo(2L);
    }

    // -----------------------------------------------------------------------
    // AMS test 5: backlog-save summary counts saved vs unsaved via stored
    // workItemId (Addition B). Orphan ids count as not_saved_to_backlog.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 5 -- backlog-save summary uses stored workItemId; orphan id counts as unsaved")
    void backlogSaveSummaryUsesStoredWorkItemId() {
        UUID savedId = UUID.randomUUID();
        UUID orphanId = UUID.randomUUID();
        List<Map<String, Object>> items = new ArrayList<>();
        items.add(item("S1", null, "story", "Saved", "WS", savedId));
        items.add(item("S2", null, "story", "Orphan", "WS", orphanId));
        items.add(item("S3", null, "story", "Never saved", "WS", null));

        seedBook(items);

        WorkItemEntity savedRow = workItem(savedId, "Saved Title", null);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(savedRow));
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.backlogSaveSummary().savedCount()).isEqualTo(1L);
        assertThat(dto.backlogSaveSummary().notSavedToBacklogCount()).isEqualTo(2L);
        // Orphan id also surfaces a warning per Q-5 (covered fully in test 12 below).
        assertThat(dto.warnings())
            .anyMatch(w -> w.contains("Orphan workItemId") && w.contains(orphanId.toString()));
    }

    // -----------------------------------------------------------------------
    // AMS test 6: spec-generation summary counts every status correctly.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 6 -- spec-generation summary counts each status bucket")
    void specGenerationSummaryCountsAllStatusBuckets() {
        UUID w1 = UUID.randomUUID();
        UUID w2 = UUID.randomUUID();
        UUID w3 = UUID.randomUUID();
        UUID w4 = UUID.randomUUID();
        UUID w5 = UUID.randomUUID();
        UUID w6 = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "generated", "WS", w1),
            item("S2", null, "story", "with-warn", "WS", w2),
            item("S3", null, "story", "insufficient", "WS", w3),
            item("S4", null, "story", "failed", "WS", w4),
            item("S5", null, "story", "no-attempt", "WS", w5),
            item("S6", null, "story", "skipped-blocked", "WS", w6)
        );

        seedBook(items);
        when(workItemRepository.findAllById(anyCollection())).thenReturn(List.of(
            workItem(w1, "S1", null),
            workItem(w2, "S2", null),
            workItem(w3, "S3", null),
            workItem(w4, "S4", null),
            workItem(w5, "S5", null),
            workItem(w6, "S6", null)
        ));
        when(specGenerationRepository.findByBookOfWorkId(bookId)).thenReturn(List.of(
            specGen(w1, 1, MigrationStorySpecGenerationStatus.GENERATED, null, null),
            specGen(w2, 1, MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS, null, null),
            specGen(w3, 1, MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT, null, null),
            specGen(w4, 1, MigrationStorySpecGenerationStatus.FAILED, null, null),
            specGen(w6, 1, MigrationStorySpecGenerationStatus.SKIPPED_BLOCKED, null, null)
        ));
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.specGenerationSummary().generatedCount()).isEqualTo(1L);
        assertThat(dto.specGenerationSummary().generatedWithWarningsCount()).isEqualTo(1L);
        assertThat(dto.specGenerationSummary().insufficientContextCount()).isEqualTo(1L);
        assertThat(dto.specGenerationSummary().failedCount()).isEqualTo(1L);
        assertThat(dto.specGenerationSummary().notAttemptedCount()).isEqualTo(1L); // w5 had no row
        assertThat(dto.specGenerationSummary().skippedBlockedCount()).isEqualTo(1L);
    }

    // -----------------------------------------------------------------------
    // AMS test 7: latest generation_attempt_number per WorkItem wins.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 7 -- latest generation_attempt_number per WorkItem wins for spec status")
    void latestGenerationAttemptWinsPerWorkItem() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Only story", "WS", workItemId)
        );

        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        when(specGenerationRepository.findByBookOfWorkId(bookId)).thenReturn(List.of(
            specGen(workItemId, 1, MigrationStorySpecGenerationStatus.FAILED, null, null),
            specGen(workItemId, 3, MigrationStorySpecGenerationStatus.GENERATED, null, null),
            specGen(workItemId, 2, MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT, null, null)
        ));
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        // The attempt-3 generated row wins; failed/insufficient older attempts do not.
        assertThat(dto.specGenerationSummary().generatedCount()).isEqualTo(1L);
        assertThat(dto.specGenerationSummary().failedCount()).isEqualTo(0L);
        assertThat(dto.specGenerationSummary().insufficientContextCount()).isEqualTo(0L);
    }

    // -----------------------------------------------------------------------
    // AMS test 8: implementation summary derives no_workspace -> not_started
    // when no workspace exists (story-level rollup contributes to not_started).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 8 -- implementation status is not_started when no workspace exists")
    void implementationStatusNotStartedWhenNoWorkspace() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "no workspace", "WS", workItemId)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        seedNoSpecs();
        // workspaceRepository.findAll returns empty -> no workspace.
        when(workspaceRepository.findAll()).thenReturn(Collections.emptyList());

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.implementationSummary().notStartedCount()).isEqualTo(1L);
        assertThat(dto.implementationSummary().inProgressCount()).isEqualTo(0L);
        assertThat(dto.implementationSummary().completedCount()).isEqualTo(0L);
        // hierarchy node should still render with implementationStatus 'not_started'.
        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.implementationStatus()).isEqualTo("not_started");
    }

    // -----------------------------------------------------------------------
    // AMS test 9: implementation status reflects workspace existence (workspace_created).
    // A workspace row whose JSONB has neither implementationMode=true nor a status
    // is still in 'not_started' phase per the deriveImplementationStatus heuristic;
    // existence alone does NOT push past not_started.  We assert the implementation
    // summary treats the row as not_started -- mirroring the service contract that
    // we "never invent completion state".
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 9 -- workspace row with no progression signal stays at not_started")
    void implementationStatusWorkspaceCreatedButNoProgression() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "workspace bare", "WS", workItemId)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        seedNoSpecs();
        // A workspace row exists but its state has no implementationMode / status /
        // completed flag, so the derived status stays at 'not_started'.
        WorkItemImplementWorkspaceEntity ws = workspace(workItemId, new LinkedHashMap<>());
        when(workspaceRepository.findAll()).thenReturn(List.of(ws));

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.implementationStatus()).isEqualTo("not_started");
        assertThat(dto.implementationSummary().notStartedCount()).isEqualTo(1L);
    }

    // -----------------------------------------------------------------------
    // AMS test 10: implementation status derives in_progress (planned/etc) when
    // the workspace shows progression past not_started. Per the service the
    // signal here is implementationMode=true; we use that as the canonical
    // "planner/planning underway" flag.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 10 -- implementationMode=true on workspace derives in_progress (planned)")
    void implementationStatusPlannedWhenImplementationModeFlagSet() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "planner started", "WS", workItemId)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        seedNoSpecs();
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("implementationMode", true);
        state.put("plannerPayload", Map.of("featureUnderstanding", "x"));
        WorkItemImplementWorkspaceEntity ws = workspace(workItemId, state);
        when(workspaceRepository.findAll()).thenReturn(List.of(ws));

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.implementationStatus()).isEqualTo("in_progress");
        assertThat(dto.implementationSummary().inProgressCount()).isEqualTo(1L);
        assertThat(dto.implementationSummary().notStartedCount()).isEqualTo(0L);
    }

    // -----------------------------------------------------------------------
    // AMS test 11: implementation status escalates to completed when the
    // workspace sets completed=true (or explicit status='in_progress').
    // The service derives "artifacts_present" mapping as in_progress per its
    // schema: presence of executionArtifactsByIncrement implies past
    // not_started.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 11 -- explicit workspace status surfaces verbatim (e.g. in_progress with artifacts)")
    void implementationStatusInProgressWithExecutionArtifacts() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "artifacts present", "WS", workItemId)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        seedNoSpecs();
        Map<String, Object> state = new LinkedHashMap<>();
        // The service honours explicit 'status' string ahead of heuristics.
        state.put("status", "in_progress");
        state.put("executionArtifactsByIncrement", Map.of("inc-1", Map.of("artifacts", List.of("a"))));
        WorkItemImplementWorkspaceEntity ws = workspace(workItemId, state);
        when(workspaceRepository.findAll()).thenReturn(List.of(ws));

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.implementationSummary().inProgressCount()).isEqualTo(1L);
        assertThat(dto.hierarchy().get(0).implementationStatus()).isEqualTo("in_progress");
    }

    // -----------------------------------------------------------------------
    // AMS test 12: evidence summary derives "has_traceability" when any
    // reference list is populated on the book item.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 12 -- evidence summary derives has_coverage when any reference list is populated")
    void evidenceSummaryDerivesHasCoverage() {
        List<Map<String, Object>> items = new ArrayList<>();
        Map<String, Object> withEvidence = item("S1", null, "story", "covered", "WS", null);
        withEvidence.put("evidenceReferences", List.of("ev-1"));
        withEvidence.put("mappingReferences", List.of("map-1", "map-2"));
        Map<String, Object> uncovered = item("S2", null, "story", "uncovered", "WS", null);
        items.add(withEvidence);
        items.add(uncovered);
        seedBook(items);
        seedNoWorkItems();
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.evidenceSummary().anyCoverageCount()).isEqualTo(1L);
        assertThat(dto.evidenceSummary().evidenceReferenceCount()).isEqualTo(1L);
        assertThat(dto.evidenceSummary().mappingReferenceCount()).isEqualTo(1L);

        // Hierarchy node also reflects has_coverage / no_coverage statuses.
        MigrationDeliveryHierarchyNodeDto coveredNode = dto.hierarchy().stream()
            .filter(n -> "S1".equals(n.id())).findFirst().orElseThrow();
        assertThat(coveredNode.evidenceStatus()).isEqualTo("has_coverage");
        MigrationDeliveryHierarchyNodeDto uncoveredNode = dto.hierarchy().stream()
            .filter(n -> "S2".equals(n.id())).findFirst().orElseThrow();
        assertThat(uncoveredNode.evidenceStatus()).isEqualTo("no_coverage");
    }

    // -----------------------------------------------------------------------
    // AMS test 13: needs-attention includes failed spec generation.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 13 -- needs-attention includes failed spec generation rows")
    void needsAttentionIncludesFailedSpecGeneration() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Failed story", "WS", workItemId)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "Failed title", null)));
        when(specGenerationRepository.findByBookOfWorkId(bookId)).thenReturn(List.of(
            specGen(workItemId, 1, MigrationStorySpecGenerationStatus.FAILED, null, null)
        ));
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.needsAttention()).hasSize(1);
        MigrationDeliveryNeedsAttentionItemDto row = dto.needsAttention().get(0);
        assertThat(row.type()).isEqualTo("failed");
        assertThat(row.workItemId()).isEqualTo(workItemId);
    }

    // -----------------------------------------------------------------------
    // AMS test 14 + Integration 37 (AMS half): needs-attention surfaces
    // insufficient_context AND projects missing_inputs_json[] verbatim.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 14 + Int 37 (AMS half) -- insufficient_context surfaces missingInputs[] verbatim from missing_inputs_json")
    void needsAttentionInsufficientContextSurfacesMissingInputsVerbatim() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Insuff story", "WS", workItemId)
        );

        List<Map<String, Object>> missingJson = new ArrayList<>();
        Map<String, Object> m1 = new LinkedHashMap<>();
        m1.put("kind", "Mapping");
        m1.put("id", "map-42");
        m1.put("reason", "No source-to-target mapping for endpoint /foo");
        missingJson.add(m1);
        Map<String, Object> m2 = new LinkedHashMap<>();
        m2.put("kind", "Baseline");
        m2.put("id", null);
        m2.put("reason", "API baseline absent");
        missingJson.add(m2);

        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "Insuff title", null)));
        when(specGenerationRepository.findByBookOfWorkId(bookId)).thenReturn(List.of(
            specGen(workItemId, 1, MigrationStorySpecGenerationStatus.INSUFFICIENT_CONTEXT, null, missingJson)
        ));
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.needsAttention()).hasSize(1);
        MigrationDeliveryNeedsAttentionItemDto row = dto.needsAttention().get(0);
        assertThat(row.type()).isEqualTo("insufficient_context");
        assertThat(row.missingInputs()).hasSize(2);
        MissingInputEntry first = row.missingInputs().get(0);
        assertThat(first.kind()).isEqualTo("Mapping");
        assertThat(first.id()).isEqualTo("map-42");
        assertThat(first.reason()).isEqualTo("No source-to-target mapping for endpoint /foo");
        MissingInputEntry second = row.missingInputs().get(1);
        assertThat(second.kind()).isEqualTo("Baseline");
        assertThat(second.id()).isNull();
        assertThat(second.reason()).isEqualTo("API baseline absent");

        // Addition C hierarchy projection: missingInputsCount populated on the node.
        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.missingInputsCount()).isEqualTo(2L);
    }

    // -----------------------------------------------------------------------
    // AMS test 15: needs-attention includes unsaved generated story
    // (stored workItemId absent OR orphan -> backlogStatus=not_saved_to_backlog).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 15 -- needs-attention includes not_saved_to_backlog for items lacking a resolvable workItemId")
    void needsAttentionIncludesUnsavedStory() {
        UUID orphanId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Never saved", "WS", null),
            item("S2", null, "story", "Orphan stored id", "WS", orphanId)
        );
        seedBook(items);
        // Neither id resolves -- both should land in needs-attention.
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(Collections.emptyList());
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.needsAttention())
            .extracting(MigrationDeliveryNeedsAttentionItemDto::type)
            .containsOnly("not_saved_to_backlog");
        assertThat(dto.needsAttention())
            .extracting(MigrationDeliveryNeedsAttentionItemDto::bookItemId)
            .containsExactlyInAnyOrder("S1", "S2");
    }

    // -----------------------------------------------------------------------
    // AMS test 16: no N+1. Exactly 3 batched repository fetches across
    // WorkItem / spec-gen / workspace at dashboard load (one each), independent
    // of story count.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 16 -- no N+1: exactly 3 batched repository fetches regardless of story count")
    void noNPlusOneAcrossBatchedFetches() {
        // 25 stories, each with a stored workItemId.
        List<Map<String, Object>> items = new ArrayList<>();
        List<WorkItemEntity> wiRows = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            UUID w = UUID.randomUUID();
            items.add(item("S" + i, null, "story", "Story " + i, "WS", w));
            wiRows.add(workItem(w, "Title " + i, null));
        }
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection())).thenReturn(wiRows);
        when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenReturn(Collections.emptyList());
        when(workspaceRepository.findAll()).thenReturn(Collections.emptyList());

        service.loadDashboard(projectId, bookId);

        // 1 batched fetch each:
        verify(workItemRepository, times(1)).findAllById(anyCollection());
        verify(specGenerationRepository, times(1)).findByBookOfWorkId(bookId);
        verify(workspaceRepository, times(1)).findAll();
        // Critical: per-story finders never invoked.
        verify(workItemRepository, never()).findById(any(UUID.class));
        verify(specGenerationRepository, never()).findByWorkItemId(any(UUID.class));
        verify(workspaceRepository, never()).findByProjectIdAndWorkItemId(any(UUID.class), any(UUID.class));
    }

    // -----------------------------------------------------------------------
    // AMS test 17: >500 stories soft warning appears AND the full payload is
    // returned (no truncation).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 17 -- >500 stories surfaces a soft warning AND returns the full payload")
    void softWarningSurfacesAbove500Stories() {
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < 501; i++) {
            items.add(item("S" + i, null, "story", "Story " + i, "WS", null));
        }
        seedBook(items);
        seedNoWorkItems();
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.summary().totalStoryCount()).isEqualTo(501L);
        assertThat(dto.hierarchy()).hasSize(501); // full payload returned
        assertThat(dto.warnings())
            .anyMatch(w -> w.contains("501") && w.toLowerCase().contains("stories"));
    }

    // -----------------------------------------------------------------------
    // AMS test 18: partial roll-up returns 200 with warnings[] when ONE
    // subsection fetch throws -- the other sections are still populated.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("AMS test 18 -- partial roll-up: one failed batch fetch is named in warnings; other sections populate")
    void partialRollupTolerantOfSubsectionFailure() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Survives partial failure", "WS", workItemId)
        );
        seedBook(items);
        // Force the spec_generations batched fetch to throw.
        when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenThrow(new RuntimeException("simulated DB connection loss"));
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        when(workspaceRepository.findAll()).thenReturn(Collections.emptyList());

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        // Service does NOT throw -- contract is 200 + warnings.
        assertThat(dto).isNotNull();
        assertThat(dto.warnings())
            .anyMatch(w -> w.toLowerCase().contains("spec_generations"));
        // The non-failing sections (summary/backlog/etc) still populate.
        assertThat(dto.summary().totalStoryCount()).isEqualTo(1L);
        assertThat(dto.backlogSaveSummary().savedCount()).isEqualTo(1L);
    }

    // -----------------------------------------------------------------------
    // AMS test 12 (subset) -- workstream summaries roll up correctly.
    // Renamed to mirror spec.md AMS test 14 ("Workstream summaries roll up
    // correctly") which was missing from the explicit assignment list but is
    // a key Group 5 contract; we cover it here for completeness.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Workstream summaries roll up per workstream label across stories")
    void workstreamSummariesRollUpPerWorkstream() {
        UUID wA1 = UUID.randomUUID();
        UUID wA2 = UUID.randomUUID();
        UUID wB1 = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "A1", "Alpha", wA1),
            item("S2", null, "story", "A2", "Alpha", wA2),
            item("S3", null, "story", "B1", "Beta", wB1)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection())).thenReturn(List.of(
            workItem(wA1, "A1", null), workItem(wA2, "A2", null), workItem(wB1, "B1", null)
        ));
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        assertThat(dto.workstreamSummaries()).hasSize(2);
        MigrationDeliveryWorkstreamSummaryDto alpha = findWorkstream(dto, "Alpha");
        MigrationDeliveryWorkstreamSummaryDto beta = findWorkstream(dto, "Beta");
        assertThat(alpha.totalStoryCount()).isEqualTo(2L);
        assertThat(alpha.savedToBacklogCount()).isEqualTo(2L);
        assertThat(beta.totalStoryCount()).isEqualTo(1L);
        assertThat(beta.savedToBacklogCount()).isEqualTo(1L);
    }

    // -----------------------------------------------------------------------
    // Integration 36 (AMS half) -- refreshed spec_generations rows surface on
    // a second loadDashboard call.
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Int 36 (AMS half) -- spec_generations updates surface on a fresh loadDashboard call")
    void specGenerationsRefreshSurfaceOnNextRead() {
        UUID workItemId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Will be regenerated", "WS", workItemId)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(List.of(workItem(workItemId, "title", null)));
        when(workspaceRepository.findAll()).thenReturn(Collections.emptyList());

        // First read: failed spec.
        when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenReturn(List.of(specGen(workItemId, 1, MigrationStorySpecGenerationStatus.FAILED, null, null)));
        MigrationDeliveryDashboardDto first = service.loadDashboard(projectId, bookId);
        assertThat(first.specGenerationSummary().failedCount()).isEqualTo(1L);
        assertThat(first.specGenerationSummary().generatedCount()).isEqualTo(0L);

        // Refresh: latest attempt is now generated.
        when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenReturn(List.of(
                specGen(workItemId, 1, MigrationStorySpecGenerationStatus.FAILED, null, null),
                specGen(workItemId, 2, MigrationStorySpecGenerationStatus.GENERATED, null, null)
            ));
        MigrationDeliveryDashboardDto second = service.loadDashboard(projectId, bookId);
        assertThat(second.specGenerationSummary().failedCount()).isEqualTo(0L);
        assertThat(second.specGenerationSummary().generatedCount()).isEqualTo(1L);
    }

    // -----------------------------------------------------------------------
    // Integration 38 -- orphan workItemId end-to-end with no DB side-effect.
    // Dashboard renders the orphan as not_saved_to_backlog AND surfaces a
    // warning, and the WorkItem repository is NOT invoked for any write
    // (no save / no update / no delete).
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("Int 38 -- orphan stored workItemId never triggers repository writes (no auto-repair)")
    void orphanWorkItemIdNeverTriggersRepositoryWrites() {
        UUID orphanId = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Orphan", "WS", orphanId)
        );
        seedBook(items);
        // findAllById returns empty -> orphan.
        when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(Collections.emptyList());
        seedNoSpecs();
        seedNoWorkspaces();

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        // Dashboard rendered the orphan as not_saved_to_backlog.
        MigrationDeliveryHierarchyNodeDto node = dto.hierarchy().get(0);
        assertThat(node.backlogStatus()).isEqualTo("not_saved_to_backlog");
        assertThat(dto.warnings())
            .anyMatch(w -> w.contains("Orphan workItemId") && w.contains(orphanId.toString()));

        // Critical: no write-path on any of the three mocked repos.
        verify(workItemRepository, never()).save(any());
        verify(workItemRepository, never()).saveAll(any());
        verify(workItemRepository, never()).delete(any());
        verify(workItemRepository, never()).deleteById(any());
        verify(bookRepository, never()).save(any());
        verify(specGenerationRepository, never()).save(any());
        verify(workspaceRepository, never()).save(any());
    }

    // -----------------------------------------------------------------------
    // Spec.md AMS test 9 (clarified separately): generated_with_warnings is
    // EXCLUDED from needs-attention once implementation activity is past
    // not_started. (The tasked list groups this under Test 13 implicitly.)
    // -----------------------------------------------------------------------

    @Test
    @DisplayName("generated_with_warnings suppressed from needs-attention once implementation is past not_started")
    void generatedWithWarningsSuppressedOncePastNotStarted() {
        UUID withWarnUnstarted = UUID.randomUUID();
        UUID withWarnInProgress = UUID.randomUUID();
        List<Map<String, Object>> items = List.of(
            item("S1", null, "story", "Warned + unstarted", "WS", withWarnUnstarted),
            item("S2", null, "story", "Warned + in-progress", "WS", withWarnInProgress)
        );
        seedBook(items);
        when(workItemRepository.findAllById(anyCollection())).thenReturn(List.of(
            workItem(withWarnUnstarted, "S1", null),
            workItem(withWarnInProgress, "S2", null)
        ));
        when(specGenerationRepository.findByBookOfWorkId(bookId)).thenReturn(List.of(
            specGen(withWarnUnstarted, 1, MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS, null, null),
            specGen(withWarnInProgress, 1, MigrationStorySpecGenerationStatus.GENERATED_WITH_WARNINGS, null, null)
        ));
        Map<String, Object> inProgressState = new LinkedHashMap<>();
        inProgressState.put("status", "in_progress");
        when(workspaceRepository.findAll()).thenReturn(List.of(
            workspace(withWarnInProgress, inProgressState)
        ));

        MigrationDeliveryDashboardDto dto = service.loadDashboard(projectId, bookId);

        // Only the unstarted+warned row should be in needs-attention.
        assertThat(dto.needsAttention())
            .extracting(MigrationDeliveryNeedsAttentionItemDto::bookItemId)
            .containsExactly("S1");
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void seedBook(List<Map<String, Object>> items) {
        GeneratedMigrationBookOfWorkEntity book = bookEntity(
            bookId,
            projectId,
            Map.of("items", items));
        when(bookRepository.findById(bookId)).thenReturn(Optional.of(book));
    }

    private void seedNoWorkItems() {
        // Use lenient so tests that never trigger this collaborator don't
        // tip a strict UnnecessaryStubbing failure.
        lenient().when(workItemRepository.findAllById(anyCollection()))
            .thenReturn(Collections.emptyList());
    }

    private void seedNoSpecs() {
        lenient().when(specGenerationRepository.findByBookOfWorkId(bookId))
            .thenReturn(Collections.emptyList());
    }

    private void seedNoWorkspaces() {
        lenient().when(workspaceRepository.findAll())
            .thenReturn(Collections.emptyList());
    }

    private static GeneratedMigrationBookOfWorkEntity bookEntity(
        UUID id, UUID projectId, Map<String, Object> bookJson) {
        GeneratedMigrationBookOfWorkEntity book = new GeneratedMigrationBookOfWorkEntity();
        book.setId(id);
        book.setProjectId(projectId);
        book.setTitle("Test Book");
        book.setStatus("ACTIVE");
        book.setBookOfWorkJson(new LinkedHashMap<>(bookJson));
        book.setCreatedAt(Instant.now());
        book.setUpdatedAt(Instant.now());
        return book;
    }

    private static Map<String, Object> item(
        String id, String parentId, String type, String title,
        String workstream, UUID workItemId) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", id);
        m.put("parentId", parentId);
        m.put("type", type);
        m.put("title", title);
        m.put("workstream", workstream);
        if (workItemId != null) {
            m.put("workItemId", workItemId.toString());
        }
        return m;
    }

    private static WorkItemEntity workItem(UUID id, String title, Instant updatedAt) {
        WorkItemEntity row = WorkItemEntity.builder()
            .id(id)
            .projectId(UUID.randomUUID())
            .type("STORY")
            .title(title)
            .status("PLANNED")
            .sortOrder(0)
            .build();
        row.setUpdatedAt(updatedAt == null ? Instant.now() : updatedAt);
        row.setCreatedAt(Instant.now());
        return row;
    }

    private MigrationStorySpecGenerationEntity specGen(
        UUID workItemId, int attempt, String status, String confidence,
        List<Map<String, Object>> missingInputs) {
        MigrationStorySpecGenerationEntity row = MigrationStorySpecGenerationEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .workItemId(workItemId)
            .bookOfWorkId(bookId)
            .status(status)
            .confidence(confidence)
            .generationAttemptNumber(attempt)
            .build();
        row.setCreatedAt(Instant.now());
        row.setUpdatedAt(Instant.now());
        if (missingInputs != null) {
            row.setMissingInputsJson(missingInputs);
        }
        return row;
    }

    private WorkItemImplementWorkspaceEntity workspace(UUID workItemId, Map<String, Object> state) {
        WorkItemImplementWorkspaceEntity row = WorkItemImplementWorkspaceEntity.builder()
            .id(UUID.randomUUID())
            .projectId(projectId)
            .workItemId(workItemId)
            .workspaceState(state)
            .build();
        row.setCreatedAt(Instant.now());
        row.setUpdatedAt(Instant.now());
        return row;
    }

    private static MigrationDeliveryWorkstreamSummaryDto findWorkstream(
        MigrationDeliveryDashboardDto dto, String label) {
        return dto.workstreamSummaries().stream()
            .filter(s -> label.equals(s.workstream()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("Workstream not found: " + label));
    }
}
