package com.example.architecturemodel.model.dto;

import java.util.UUID;

/**
 * DTO returned by the interface->architecture binding lookup endpoint.
 *
 * Returned by {@code GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding}.
 * Used by the gateway's {@code derivedBindingResolver} (spec #5 Group 2) to
 * resolve the architecture an interface belongs to so a {@code derived-from-context}
 * conversation can bind itself once the LLM identifies the target interface.
 *
 * Spec: Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 1.
 *
 * @param architectureId   UUID of the architecture the interface belongs to
 * @param architectureName Human-readable name of the architecture (used in
 *                         system-prompt injection and user-facing messages)
 * @param archived         Whether the architecture is archived; the resolver
 *                         translates {@code archived=true} into a 422
 *                         {@code archived_architecture} refusal so conversations
 *                         cannot bind to archived architectures
 */
public record InterfaceArchitectureBindingResponse(
    UUID architectureId,
    String architectureName,
    boolean archived
) {
}
