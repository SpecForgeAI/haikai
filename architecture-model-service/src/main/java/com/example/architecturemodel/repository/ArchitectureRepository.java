package com.example.architecturemodel.repository;

import com.example.architecturemodel.model.entity.ArchitectureEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Spring Data JPA Repository for ArchitectureEntity.
 *
 * Provides CRUD operations and the queries needed for list and default
 * resolution.
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3) -- name
 *       uniqueness lookups + non-archived count for last-architecture protection.
 * Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3
 *       adds {@link #findByProjectIdAndKind(UUID, String)} and
 *       {@link #findByProjectIdAndKindAndDraftState(UUID, String, String)}
 *       so the target-architecture promote / list / debounce paths can
 *       resolve rows by kind+draft_state without scanning the full project.
 */
@Repository
public interface ArchitectureRepository extends JpaRepository<ArchitectureEntity, UUID> {

    /**
     * Find all architectures for a project ordered by created_at ascending.
     * Used by the list endpoint and as input to default-resolution.
     *
     * @param projectId the project UUID
     * @return ordered list (oldest first); empty list if project has none.
     */
    List<ArchitectureEntity> findByProjectIdOrderByCreatedAtAsc(UUID projectId);

    /**
     * Find the oldest non-archived architecture for a project. This is the
     * canonical "Default" architecture for the project, per spec #1 decision
     * #6 (oldest non-archived; survives renames and additions; no is_default
     * flag).
     *
     * @param projectId the project UUID
     * @return Optional containing the oldest non-archived architecture, or
     *   empty if the project has none (e.g. all archived, or no rows yet).
     */
    Optional<ArchitectureEntity> findFirstByProjectIdAndArchivedFalseOrderByCreatedAtAsc(UUID projectId);

    /**
     * Case-insensitive duplicate-name check used by the create flow.
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * Backed by the {@code architecture_project_id_lower_name_uidx} index
     * created in changeset 092. The application checks this before insert
     * so it can return a friendly 409 with the offending name; the index
     * is the safety net for races past the application check.
     *
     * @param projectId the project UUID
     * @param name      the candidate name (compared case-insensitively)
     * @return true if any architecture in the project already uses the name
     */
    boolean existsByProjectIdAndNameIgnoreCase(UUID projectId, String name);

    /**
     * Case-insensitive duplicate-name check used by the update / PATCH flow.
     *
     * Excludes the architecture being edited so the user can keep their own
     * current name unchanged without triggering a false 409.
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * @param projectId the project UUID
     * @param name      the candidate name (compared case-insensitively)
     * @param id        the architecture being edited (excluded from the search)
     * @return true if any OTHER architecture in the project uses the name
     */
    boolean existsByProjectIdAndNameIgnoreCaseAndIdNot(UUID projectId, String name, UUID id);

    /**
     * Counts non-archived architectures for a project. Used by the archive
     * flow to enforce the "every project must have at least one architecture"
     * invariant (last-architecture protection).
     *
     * Spec: Multi-Architecture CRUD UI + Tag Management (Spec #3)
     *
     * @param projectId the project UUID
     * @return number of non-archived architectures (>= 0)
     */
    long countByProjectIdAndArchivedFalse(UUID projectId);

    /**
     * Lists every architecture row for a project with the given {@code kind}.
     * Used by the target-architecture list endpoint
     * ({@code GET /api/projects/{projectId}/target-architectures}) so we can
     * surface every {@code kind='target'} row (active + drafts).
     *
     * <p>Result is ordered by {@code createdAt DESC} so the list naturally
     * surfaces the most-recent drafts first; the controller layer applies an
     * "active-first" sort on top.</p>
     *
     * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
     *
     * @param projectId the project UUID
     * @param kind      either {@code current} or {@code target}
     * @return ordered list of matching architecture rows; empty list when none
     */
    List<ArchitectureEntity> findByProjectIdAndKindOrderByCreatedAtDesc(
        UUID projectId, String kind);

    /**
     * Finds the active row for a given {@code kind} on a project.
     *
     * <p>Used to resolve "the active target" on a project in a single query.
     * In practice every project has at most one {@code kind='target'} row
     * with {@code draftState='active'} at any moment; multi-row results are
     * a data integrity violation surfaced via the caller.</p>
     *
     * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 3.</p>
     *
     * @param projectId   the project UUID
     * @param kind        either {@code current} or {@code target}
     * @param draftState  either {@code active} or {@code draft}
     * @return the matching row when present; empty when no row matches
     */
    Optional<ArchitectureEntity> findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc(
        UUID projectId, String kind, String draftState);

    /**
     * Case-insensitive lookup of a single architecture by project + name.
     *
     * <p>Used by {@code SuggestFromCurrentService} for the 5-second
     * double-click guard: after resolving the candidate auto-name, the
     * service fetches the matching row (if any) to inspect
     * {@code createdAt} and decide whether to throw a
     * {@code RecentDuplicateSuggestException} (HTTP 409) or proceed with
     * the next numeric suffix.</p>
     *
     * <p>Spec: Target State Sub-tab + Deterministic Suggest (2026-05-24).</p>
     */
    Optional<ArchitectureEntity> findFirstByProjectIdAndNameIgnoreCase(
        UUID projectId, String name);

    /**
     * Finds the project's MOST-RECENT-SAVED target-state conversation: the
     * newest {@code kind='target' AND archived=false} row whose
     * {@code conversation_saved_at} marker is set, ordered by that marker
     * descending (LIMIT 1 via {@code findFirst}).
     *
     * <p>Decoupled from {@code draft_state='active'} on purpose -- a saved
     * conversation lives on an un-promoted draft, so the plan must source it
     * from the save marker, not from "active". Net-new for this spec; modelled
     * on {@link #findFirstByProjectIdAndKindAndDraftStateAndArchivedFalseOrderByCreatedAtDesc}
     * but ordered by {@code conversationSavedAt DESC}. Backs the gateway
     * saved-id resolver default + the wizard's most-recent-saved default.</p>
     *
     * <p>Spec: Target-State Conversation Save/Resume/Plan-Sourcing
     * (2026-06-26) -- Task Group 2 (FR2).</p>
     *
     * @param projectId the project UUID
     * @param kind      {@code target} in practice
     * @return the newest saved target row, or empty when the project has none
     */
    Optional<ArchitectureEntity> findFirstByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
        UUID projectId, String kind);

    /**
     * Lists every SAVED target-state conversation in the project: all
     * {@code kind='target' AND archived=false} rows whose
     * {@code conversation_saved_at} marker is set, newest-first. Same predicate
     * as the most-recent-saved finder above, with no limit.
     *
     * <p>Backs the wizard's saved-conversation picker + the extended
     * saved-conversations list. Net-new for this spec; modelled on
     * {@link #findByProjectIdAndKindOrderByCreatedAtDesc} but filtered to saved
     * rows and ordered by {@code conversationSavedAt DESC}.</p>
     *
     * <p>Spec: Target-State Conversation Save/Resume/Plan-Sourcing
     * (2026-06-26) -- Task Group 2 (FR2).</p>
     *
     * @param projectId the project UUID
     * @param kind      {@code target} in practice
     * @return saved target rows newest-first; empty list when none are saved
     */
    List<ArchitectureEntity> findByProjectIdAndKindAndArchivedFalseAndConversationSavedAtIsNotNullOrderByConversationSavedAtDesc(
        UUID projectId, String kind);
}
