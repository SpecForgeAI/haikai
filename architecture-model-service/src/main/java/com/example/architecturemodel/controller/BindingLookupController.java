package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.InterfaceArchitectureBindingResponse;
import com.example.architecturemodel.service.InterfaceArchitectureBindingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Lightweight controller exposing entity->architecture binding lookups used by
 * the gateway's {@code derivedBindingResolver} (spec #5 Group 2).
 *
 * Why a dedicated controller (and not an extension of {@link ModelInterfacesController})?
 *   - {@link ModelInterfacesController} is mounted under the global
 *     {@code /api/model/interfaces} path (no project scoping in the URL); the
 *     binding lookup is intentionally project-scoped under
 *     {@code /api/projects/{projectId}/interfaces/...} to mirror spec #1's
 *     project-scoped routing convention and let the service refuse cross-project
 *     access.
 *   - Future entity types ({@code service}, {@code application}, etc.) for
 *     {@code derived-from-context} V2 will land alongside this controller as
 *     siblings, keeping all binding-lookup endpoints in one place.
 *
 * Spec: Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 1.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/projects/{projectId}")
@RequiredArgsConstructor
@Slf4j
public class BindingLookupController {

    private final InterfaceArchitectureBindingService interfaceArchitectureBindingService;

    /**
     * GET /api/projects/{projectId}/interfaces/{interfaceId}/architecture-binding
     *
     * Returns {@code {architectureId, architectureName, archived}} for the given
     * interface. The lookup is intentionally project-scoped because the caller
     * (gateway derived-binding resolver) does not yet know the architecture --
     * that is what the lookup resolves.
     *
     * Errors:
     *   404 -- interface not found OR the interface belongs to a different
     *          project than the one in the URL (cross-project access is
     *          collapsed into a 404 to avoid leaking foreign interface ids).
     *
     * @param projectId   the project UUID
     * @param interfaceId the interface id
     * @return 200 with the binding payload
     */
    @GetMapping("/interfaces/{interfaceId}/architecture-binding")
    public ResponseEntity<InterfaceArchitectureBindingResponse> getInterfaceArchitectureBinding(
            @PathVariable UUID projectId,
            @PathVariable String interfaceId) {
        log.debug("GET /api/projects/{}/interfaces/{}/architecture-binding",
            projectId, interfaceId);
        InterfaceArchitectureBindingResponse response =
            interfaceArchitectureBindingService.getArchitectureBinding(projectId, interfaceId);
        return ResponseEntity.ok(response);
    }
}
