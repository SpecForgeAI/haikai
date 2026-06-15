package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonAlias;

/**
 * DTO for one entry of the implementation-service workspace repo map.
 *
 * <p>Wire format: snake_case via the global Jackson SNAKE_CASE strategy
 * ({@code folder}, {@code git_url}, {@code workspace_dir}, {@code mode}) --
 * NO {@code @CamelCaseWire}; the consumers are the gateway's and frontend's
 * snake_case-typed API modules. {@code @JsonAlias} accepts camelCase keys on
 * input for tolerance, matching the {@link ProjectDto} pattern.</p>
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair -- Task Group 1
 */
public record ProjectImplementationRepoDto(
    String folder,
    @JsonAlias("gitUrl")
    String gitUrl,
    @JsonAlias("workspaceDir")
    String workspaceDir,
    String mode
) {
}
