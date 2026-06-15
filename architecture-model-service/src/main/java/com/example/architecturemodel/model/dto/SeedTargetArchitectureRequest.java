package com.example.architecturemodel.model.dto;

import java.util.UUID;

/**
 * Body for {@code POST /api/projects/{projectId}/target-architectures/seed}.
 *
 * <p>Three modes; the controller dispatches to
 * {@code TargetArchitectureSeedService} which fans out per mode:</p>
 *
 * <ul>
 *   <li>{@code clone-current} -- deep-clones every element from
 *       {@code currentArchitectureId} via the existing
 *       {@code ArchitectureCloneService} and stamps every cloned element with
 *       {@code provenance='cloned-from'}. Also auto-creates
 *       {@code architecture_element_mappings} rows with
 *       {@code mapping_type='equivalent'}, {@code confidence=1.0},
 *       {@code createdByTask='target-arch-seed-clone'} so the cross-architecture
 *       back-reference is captured natively. {@code currentArchitectureId} is
 *       REQUIRED in this mode; if omitted, the service resolves the project's
 *       canonical current architecture (oldest non-archived
 *       {@code kind='current'} row).</li>
 *   <li>{@code blank} -- creates an empty architecture row only (no elements,
 *       no mappings). Provenance is irrelevant for empty drafts.</li>
 *   <li>{@code from-template} -- v1 returns 501 with structured envelope
 *       {@code code: "template_mode_not_implemented"} so the UI can render the
 *       option as disabled with an explanatory tooltip. {@code templateId} is
 *       accepted on the contract but never consulted in v1.</li>
 * </ul>
 *
 * <p>{@code draftName} is optional; when omitted the service auto-names per
 * the rule documented on
 * {@code TargetArchitectureSeedService#autoNameDraft(UUID,String)}:
 * {@code "Draft YYYY-MM-DD #n"} (project-scoped {@code #n} increments) or
 * {@code "Draft from LLM suggest"} when called by the LLM task.</p>
 *
 * <p>Spec: Target Architecture Authoring Flow (2026-05-20) -- Task Group 2.</p>
 *
 * @param mode                   {@code "clone-current" | "blank" | "from-template"}
 * @param templateId             only consulted for {@code from-template};
 *                               accepted on the contract to keep the v1 frontend
 *                               surface stable when the registry lands
 * @param currentArchitectureId  only consulted for {@code clone-current}; if
 *                               null the service resolves the project's current
 *                               architecture
 * @param draftName              optional override; otherwise auto-named by the
 *                               service
 */
public record SeedTargetArchitectureRequest(
    String mode,
    String templateId,
    UUID currentArchitectureId,
    String draftName
) {
    public static final String MODE_CLONE_CURRENT = "clone-current";
    public static final String MODE_BLANK = "blank";
    public static final String MODE_FROM_TEMPLATE = "from-template";

    /** Mapping createdByTask for clone-current auto-mappings. */
    public static final String CLONE_CREATED_BY_TASK = "target-arch-seed-clone";

    /** Provenance vocabulary value stamped on cloned elements. */
    public static final String PROVENANCE_CLONED_FROM = "cloned-from";

    /** Default draft-name prefix when no explicit name is provided. */
    public static final String DEFAULT_DRAFT_NAME_PREFIX = "Draft";

    /** Auto-name used when the LLM suggest task is the caller. */
    public static final String LLM_SUGGEST_DRAFT_NAME = "Draft from LLM suggest";
}
