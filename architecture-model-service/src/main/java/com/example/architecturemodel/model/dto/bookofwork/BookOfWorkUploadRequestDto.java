package com.example.architecturemodel.model.dto.bookofwork;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Request DTO for uploading a Book of Work markdown file.
 *
 * Spec 2026-01-10: Upload Book of Work from Markdown
 * Task Group 2.2: Create BookOfWorkUploadRequestDto
 *
 * Contains the markdown content string to be parsed and imported.
 * Enforces a maximum size limit of 500KB to prevent abuse.
 */
public record BookOfWorkUploadRequestDto(
    /**
     * The markdown content of the Book of Work file.
     * Must not be blank and must not exceed 500KB (512,000 bytes).
     */
    @JsonProperty("content")
    @NotBlank(message = "Content must not be blank")
    @Size(max = 512000, message = "Content must not exceed 500KB")
    String content
) {
}
