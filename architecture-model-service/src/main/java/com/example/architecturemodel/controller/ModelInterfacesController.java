package com.example.architecturemodel.controller;

import com.example.architecturemodel.model.dto.interface_discovery.InterfaceOasContextDto;
import com.example.architecturemodel.model.dto.interface_discovery.InterfaceSummaryDto;
import com.example.architecturemodel.service.InterfaceDiscoveryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * REST Controller for interface discovery endpoints.
 * Provides APIs for listing interfaces for a model file and retrieving
 * OAS-ready context for a specific interface.
 */
@RestController
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@RequestMapping("/api/model/interfaces")
@RequiredArgsConstructor
@Slf4j
public class ModelInterfacesController {

    private final InterfaceDiscoveryService interfaceDiscoveryService;

    /**
     * GET /api/model/interfaces?filename={name}
     * List all interfaces for a stored model file.
     *
     * @param filename Required filename query parameter
     * @return List of InterfaceSummaryDto
     * @throws IllegalArgumentException if filename is blank (results in 400)
     * @throws com.example.architecturemodel.exception.ResourceNotFoundException if filename not found (results in 404)
     */
    @GetMapping
    public ResponseEntity<List<InterfaceSummaryDto>> listInterfaces(
            @RequestParam String filename) {
        log.debug("GET /api/model/interfaces?filename={}", filename);

        if (filename == null || filename.isBlank()) {
            throw new IllegalArgumentException("Filename is required");
        }

        List<InterfaceSummaryDto> interfaces = interfaceDiscoveryService.listInterfaces(filename);
        return ResponseEntity.ok(interfaces);
    }

    /**
     * GET /api/model/interfaces/{id}
     * Get OAS-ready context bundle for an interface by globally-unique ID.
     *
     * @param id Required interface ID path variable
     * @return InterfaceOasContextDto containing full context
     * @throws IllegalArgumentException if id is blank (results in 400)
     * @throws com.example.architecturemodel.exception.ResourceNotFoundException if interface ID not found (results in 404)
     */
    @GetMapping("/{id}")
    public ResponseEntity<InterfaceOasContextDto> getInterfaceOasContext(
            @PathVariable String id) {
        log.debug("GET /api/model/interfaces/{}", id);

        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("Interface ID is required");
        }

        InterfaceOasContextDto context = interfaceDiscoveryService.getInterfaceOasContext(id);
        return ResponseEntity.ok(context);
    }
}
