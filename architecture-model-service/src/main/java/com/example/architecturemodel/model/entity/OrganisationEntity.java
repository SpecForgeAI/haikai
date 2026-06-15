package com.example.architecturemodel.model.entity;

import com.example.architecturemodel.model.converter.StringListJsonConverter;
import jakarta.persistence.*;
import lombok.*;

import java.util.ArrayList;
import java.util.List;

/**
 * JPA Entity for Organisation.
 *
 * Maps to the organisations table. Represents an organisation that can
 * own multiple projects. Organisation names are unique (case-insensitive).
 *
 * Spec 2026-01-18: Organisations Iteration 1 - Add Organisation Model + Project FK + APIs
 * Spec 2026-01-18: Organisation ID Type Change (UUID to TEXT) - Changed id from UUID to String
 * Spec 2026-01-31: Organisation Model + DB + API DTOs - Added standards fields and case-insensitive uniqueness
 */
@Entity
@Table(name = "organisations")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OrganisationEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description", nullable = true)
    private String description;

    // Document categorization fields - stored as JSON TEXT in database
    @Convert(converter = StringListJsonConverter.class)
    @Column(name = "docs_applied_to_all_sources")
    @Builder.Default
    private List<String> docsAppliedToAllSources = new ArrayList<>();

    @Convert(converter = StringListJsonConverter.class)
    @Column(name = "docs_applied_to_tech_stack")
    @Builder.Default
    private List<String> docsAppliedToTechStack = new ArrayList<>();

    @Convert(converter = StringListJsonConverter.class)
    @Column(name = "docs_applied_to_coding_styles")
    @Builder.Default
    private List<String> docsAppliedToCodingStyles = new ArrayList<>();

    @Convert(converter = StringListJsonConverter.class)
    @Column(name = "docs_applied_to_conventions")
    @Builder.Default
    private List<String> docsAppliedToConventions = new ArrayList<>();

    @Convert(converter = StringListJsonConverter.class)
    @Column(name = "docs_applied_to_error_handling")
    @Builder.Default
    private List<String> docsAppliedToErrorHandling = new ArrayList<>();

    @Convert(converter = StringListJsonConverter.class)
    @Column(name = "docs_applied_to_validation")
    @Builder.Default
    private List<String> docsAppliedToValidation = new ArrayList<>();

    // Standards generation state flag
    @Column(name = "tech_standards_generated")
    @Builder.Default
    private Boolean techStandardsGenerated = false;
}
