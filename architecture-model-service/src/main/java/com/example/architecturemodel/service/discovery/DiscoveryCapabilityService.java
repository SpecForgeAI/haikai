package com.example.architecturemodel.service.discovery;

import com.example.architecturemodel.exception.ResourceNotFoundException;
import com.example.architecturemodel.mapper.discovery.DiscoveryCapabilityMapper;
import com.example.architecturemodel.model.dto.discovery.BulkCreateDiscoveryCapabilitiesRequest;
import com.example.architecturemodel.model.dto.discovery.CreateDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityDto;
import com.example.architecturemodel.model.dto.discovery.DiscoveryCapabilityMemberDto;
import com.example.architecturemodel.model.dto.discovery.ReviewDiscoveryCapabilityRequest;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityMemberEntity;
import com.example.architecturemodel.model.entity.discovery.DiscoveryCapabilityReviewStatus;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityMemberRepository;
import com.example.architecturemodel.repository.discovery.DiscoveryCapabilityRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for the {@code discovery_capability} + {@code discovery_capability_member}
 * persistence (Liquibase changeset 184, Task Group 1).
 *
 * <p>Wraps {@link DiscoveryCapabilityRepository} +
 * {@link DiscoveryCapabilityMemberRepository} with the discovery-synthesis- and
 * findings-review-facing surface:</p>
 * <ul>
 *   <li>{@link #listByRun(UUID, UUID, UUID)} /
 *       {@link #listByProjectAndArchitecture(UUID, UUID)} -- the read lists
 *       (members embedded, batch-loaded to avoid an N+1).</li>
 *   <li>{@link #get(UUID)} -- a single capability with its members.</li>
 *   <li>{@link #create(UUID, UUID, UUID, CreateDiscoveryCapabilityRequest)} --
 *       persist one capability + its members ATOMICALLY (one {@code @Transactional}).</li>
 *   <li>{@link #bulkCreate(UUID, UUID, UUID, BulkCreateDiscoveryCapabilitiesRequest)}
 *       -- persist a batch of capabilities + their members in one transaction.</li>
 *   <li>{@link #review(UUID, ReviewDiscoveryCapabilityRequest)} -- the
 *       patch-review: transition {@code review_status}, recording the prior
 *       value into {@code previous_review_status} (boxed / null-guarded). KEPT
 *       despite the read-only D2 UI -- forward-needed by the D4-gate spec.
 *       Approving / rejecting does NOT cascade to members in D2.</li>
 * </ul>
 *
 * <p>{@code member_type} + {@code review_status} are service-layer validated
 * against their allowed sets (status-as-TEXT, no DB enum). The mapper owns the
 * null-guarded PATCH semantics (boxed reference types per
 * {@code project_primitive_double_dto_overwrite.md}).</p>
 *
 * <p>Spec: D2 -- Capability Synthesis + Batch Spines (2026-06-14, Spec 2 of 6)
 * -- Task Group 1.</p>
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequiredArgsConstructor
@Slf4j
public class DiscoveryCapabilityService {

    /**
     * The polymorphic {@code member_type} value set (D1 capability membership).
     * Service-layer validated; no DB enum. NOTE: {@code discovery_finding} is
     * valid HERE but is a DIFFERENT mechanism from {@code DiscoveryFindingLink} --
     * it stays OUT of {@code DiscoveryFindingService.ALLOWED_LINK_TARGET_TYPES}.
     */
    public static final Set<String> ALLOWED_MEMBER_TYPES = Set.of(
        "discovery_finding",
        "discovery_candidate",
        "architecture_element",
        "discovery_relationship");

    private final DiscoveryCapabilityRepository capabilityRepository;
    private final DiscoveryCapabilityMemberRepository memberRepository;

    // ------------------------------------------------------------------
    // Reads
    // ------------------------------------------------------------------

    /**
     * Read all capabilities for a discovery run (oldest-first), each with its
     * members embedded. {@code projectId} / {@code architectureId} are redundantly
     * enforced for scope safety (the run already pins them).
     *
     * @param projectId      the owning project UUID
     * @param architectureId the owning architecture UUID
     * @param runId          the synthesising run UUID
     * @return the run's capabilities with members (possibly empty)
     */
    @Transactional(readOnly = true)
    public List<DiscoveryCapabilityDto> listByRun(UUID projectId, UUID architectureId, UUID runId) {
        List<DiscoveryCapabilityEntity> capabilities =
            capabilityRepository.findByRunIdOrderByCreatedAtAsc(runId).stream()
                .filter(c -> projectId == null || projectId.equals(c.getProjectId()))
                .filter(c -> architectureId == null || architectureId.equals(c.getArchitectureId()))
                .toList();
        return withMembers(capabilities);
    }

    /**
     * Read all capabilities for a project + architecture (oldest-first), each
     * with its members embedded.
     *
     * @param projectId      the owning project UUID
     * @param architectureId the owning architecture UUID
     * @return the project+architecture capabilities with members (possibly empty)
     */
    @Transactional(readOnly = true)
    public List<DiscoveryCapabilityDto> listByProjectAndArchitecture(
            UUID projectId, UUID architectureId) {
        List<DiscoveryCapabilityEntity> capabilities =
            capabilityRepository.findByProjectIdAndArchitectureIdOrderByCreatedAtAsc(
                projectId, architectureId);
        return withMembers(capabilities);
    }

    /**
     * Read a single capability with its members.
     *
     * @param capabilityId the capability UUID
     * @return the capability with members
     * @throws ResourceNotFoundException if the capability does not exist
     */
    @Transactional(readOnly = true)
    public DiscoveryCapabilityDto get(UUID capabilityId) {
        DiscoveryCapabilityEntity entity = capabilityRepository.findById(capabilityId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery capability not found: " + capabilityId));
        List<DiscoveryCapabilityMemberDto> members =
            memberRepository.findByCapabilityIdOrderByCreatedAtAsc(capabilityId).stream()
                .map(DiscoveryCapabilityMapper::toMemberDto)
                .toList();
        return DiscoveryCapabilityMapper.toDto(entity, members);
    }

    // ------------------------------------------------------------------
    // Writes
    // ------------------------------------------------------------------

    /**
     * Persist ONE capability + its members atomically. The capability is bound to
     * the path {@code projectId} / {@code architectureId} / {@code runId}; each
     * member is validated for a legal {@code member_type} and bound to the new
     * capability id.
     *
     * @param projectId      the owning project UUID (from the URL path)
     * @param architectureId the owning architecture UUID (from the URL path)
     * @param runId          the synthesising run UUID (from the URL path; nullable)
     * @param request        the capability + members to persist
     * @return the persisted capability with members
     * @throws IllegalArgumentException if the name is blank or a member_type is invalid
     */
    @Transactional
    public DiscoveryCapabilityDto create(
            UUID projectId, UUID architectureId, UUID runId,
            CreateDiscoveryCapabilityRequest request) {
        DiscoveryCapabilityEntity savedCapability = persistOne(projectId, architectureId, runId, request);
        List<DiscoveryCapabilityMemberDto> memberDtos =
            memberRepository.findByCapabilityIdOrderByCreatedAtAsc(savedCapability.getId()).stream()
                .map(DiscoveryCapabilityMapper::toMemberDto)
                .toList();
        log.debug("[diag-ams] discovery_capability created id={} runId={} memberCount={}",
            savedCapability.getId(), runId, memberDtos.size());
        return DiscoveryCapabilityMapper.toDto(savedCapability, memberDtos);
    }

    /**
     * Persist a BATCH of capabilities + their members in one transaction.
     *
     * @param projectId      the owning project UUID (from the URL path)
     * @param architectureId the owning architecture UUID (from the URL path)
     * @param runId          the synthesising run UUID (from the URL path; nullable)
     * @param request        the capabilities (each with its members)
     * @return the persisted capabilities with members (creation order)
     * @throws IllegalArgumentException if any capability name is blank or a member_type is invalid
     */
    @Transactional
    public List<DiscoveryCapabilityDto> bulkCreate(
            UUID projectId, UUID architectureId, UUID runId,
            BulkCreateDiscoveryCapabilitiesRequest request) {
        if (request == null || request.capabilities() == null || request.capabilities().isEmpty()) {
            return List.of();
        }
        List<DiscoveryCapabilityDto> results = new ArrayList<>();
        for (CreateDiscoveryCapabilityRequest capabilityRequest : request.capabilities()) {
            DiscoveryCapabilityEntity savedCapability =
                persistOne(projectId, architectureId, runId, capabilityRequest);
            List<DiscoveryCapabilityMemberDto> memberDtos =
                memberRepository.findByCapabilityIdOrderByCreatedAtAsc(savedCapability.getId()).stream()
                    .map(DiscoveryCapabilityMapper::toMemberDto)
                    .toList();
            results.add(DiscoveryCapabilityMapper.toDto(savedCapability, memberDtos));
        }
        log.debug("[diag-ams] discovery_capability bulk_created runId={} count={}",
            runId, results.size());
        return results;
    }

    /**
     * Patch-review a capability: transition {@code review_status}, recording the
     * prior value into {@code previous_review_status}. {@code reviewer_notes}, if
     * supplied, is folded into {@code detail_json.reviewerNotes} (no dedicated
     * column in D2). Null-guarded: an omitted {@code review_status} is a no-op.
     * Approving / rejecting does NOT cascade to members in D2.
     *
     * <p>KEPT despite the read-only D2 UI -- forward-needed by the D4-gate spec,
     * avoids a later AMS round-trip.</p>
     *
     * @param capabilityId the capability UUID
     * @param request      the review request (target review_status + optional notes)
     * @return the updated capability with members
     * @throws ResourceNotFoundException if the capability does not exist
     * @throws IllegalArgumentException  if review_status is not a reviewer-valid disposition
     */
    @Transactional
    public DiscoveryCapabilityDto review(
            UUID capabilityId, ReviewDiscoveryCapabilityRequest request) {
        DiscoveryCapabilityEntity entity = capabilityRepository.findById(capabilityId)
            .orElseThrow(() -> new ResourceNotFoundException(
                "Discovery capability not found: " + capabilityId));

        if (request != null && request.reviewStatus() != null) {
            String target = request.reviewStatus();
            if (!DiscoveryCapabilityReviewStatus.REVIEWER_VALID.contains(target)) {
                throw new IllegalArgumentException(
                    "Invalid discovery capability review_status: " + target
                        + ". Allowed: " + DiscoveryCapabilityReviewStatus.REVIEWER_VALID);
            }
            // Record the prior disposition only when it actually changes (the
            // audit trail). A same-status review is otherwise a no-op.
            if (!target.equals(entity.getReviewStatus())) {
                entity.setPreviousReviewStatus(entity.getReviewStatus());
                entity.setReviewStatus(target);
            }
        }

        if (request != null && request.reviewerNotes() != null) {
            entity.setDetailJson(withReviewerNotes(entity.getDetailJson(), request.reviewerNotes()));
        }

        DiscoveryCapabilityEntity saved = capabilityRepository.save(entity);
        List<DiscoveryCapabilityMemberDto> members =
            memberRepository.findByCapabilityIdOrderByCreatedAtAsc(capabilityId).stream()
                .map(DiscoveryCapabilityMapper::toMemberDto)
                .toList();
        log.debug("[diag-ams] discovery_capability reviewed id={} reviewStatus={} previous={}",
            capabilityId, saved.getReviewStatus(), saved.getPreviousReviewStatus());
        return DiscoveryCapabilityMapper.toDto(saved, members);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * Persist a single capability + its members and return the saved capability
     * entity. Shared by {@link #create} and {@link #bulkCreate}.
     */
    private DiscoveryCapabilityEntity persistOne(
            UUID projectId, UUID architectureId, UUID runId,
            CreateDiscoveryCapabilityRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("capability request is required");
        }
        if (request.name() == null || request.name().isBlank()) {
            throw new IllegalArgumentException("capability name is required");
        }
        if (request.members() != null) {
            for (DiscoveryCapabilityMemberDto member : request.members()) {
                validateMemberType(member.memberType());
            }
        }

        DiscoveryCapabilityEntity capability =
            DiscoveryCapabilityMapper.toNewEntity(request, projectId, architectureId, runId);
        DiscoveryCapabilityEntity savedCapability = capabilityRepository.save(capability);

        if (request.members() != null && !request.members().isEmpty()) {
            List<DiscoveryCapabilityMemberEntity> memberEntities = request.members().stream()
                .map(m -> DiscoveryCapabilityMapper.toNewMemberEntity(m, savedCapability.getId()))
                .toList();
            memberRepository.saveAll(memberEntities);
        }
        return savedCapability;
    }

    /**
     * Embed each capability's members (batch-loaded over all capability ids to
     * avoid an N+1).
     */
    private List<DiscoveryCapabilityDto> withMembers(List<DiscoveryCapabilityEntity> capabilities) {
        if (capabilities.isEmpty()) {
            return List.of();
        }
        List<UUID> capabilityIds = capabilities.stream()
            .map(DiscoveryCapabilityEntity::getId)
            .toList();
        Map<UUID, List<DiscoveryCapabilityMemberDto>> membersByCapability =
            memberRepository.findByCapabilityIdIn(capabilityIds).stream()
                .map(DiscoveryCapabilityMapper::toMemberDto)
                .collect(Collectors.groupingBy(DiscoveryCapabilityMemberDto::capabilityId));
        return capabilities.stream()
            .map(c -> DiscoveryCapabilityMapper.toDto(
                c, membersByCapability.getOrDefault(c.getId(), List.of())))
            .toList();
    }

    private void validateMemberType(String memberType) {
        if (memberType == null || !ALLOWED_MEMBER_TYPES.contains(memberType)) {
            throw new IllegalArgumentException(
                "Invalid discovery capability member_type: " + memberType
                    + ". Allowed: " + ALLOWED_MEMBER_TYPES);
        }
    }

    /**
     * Fold the reviewer note into a copy of the {@code detail_json} map (D2 has
     * no dedicated reviewer-notes column on the capability). Never mutates the
     * supplied map in place.
     */
    private Map<String, Object> withReviewerNotes(Map<String, Object> existing, String notes) {
        Map<String, Object> next = existing != null
            ? new java.util.LinkedHashMap<>(existing)
            : new java.util.LinkedHashMap<>();
        next.put("reviewerNotes", notes);
        return next;
    }
}
