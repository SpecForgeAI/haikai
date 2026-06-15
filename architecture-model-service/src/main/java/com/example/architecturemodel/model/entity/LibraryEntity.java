package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Check;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * JPA entity representing a Library.
 *
 * Parallel to {@link ServiceEntity} -- mirrors the standard envelope plus
 * repo + tech fields, the 5 tech-hints columns (with the same lowercase
 * core_tech_resolution_confidence value-list), and the package_set_id FK.
 * Adds the 6 Infrastructure spec-7 provenance columns at the end.
 *
 * Library identity is (name, ecosystem); there is intentionally NO DB UNIQUE
 * on that pair -- dedup is the resolver layer's responsibility (Spec 3).
 *
 * The {@link Check} annotation mirrors the SQL CHECK constraint
 * libraries_core_tech_resolution_confidence_check from changeset
 * 122-libraries.sql so the constraint is enforceable in the H2-based test
 * environment (which uses ddl-auto=create-drop with Liquibase disabled).
 * Lowercase 5-value list lifted verbatim from services.
 *
 * Spec: 2026-05-05-library-backend-foundation
 */
@Entity
@Table(name = "libraries")
@Check(constraints =
    "core_tech_resolution_confidence IS NULL " +
    "OR core_tech_resolution_confidence IN ('high','low','none','tech-only','manual-override')")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LibraryEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    /**
     * Library ecosystem. Doc-only allowed values: MAVEN, NPM, PYPI, NUGET,
     * GO, OTHER. NO DB CHECK -- the column is plain TEXT.
     */
    @Column(name = "ecosystem")
    private String ecosystem;

    @Column(name = "repo_location")
    private String repoLocation;

    @Column(name = "repo_subfolder")
    private String repoSubfolder;

    @Column(name = "core_tech")
    private String coreTech;

    // ------------------------------------------------------------------
    // Tech Hints LLM Resolution (mirrors ServiceEntity verbatim)
    // ------------------------------------------------------------------

    /**
     * Full resolver response JSON (language, frameworks, confirmationSentence,
     * repoCrossCheck). NULL when the row has never been resolved.
     */
    @Type(JsonType.class)
    @Column(name = "core_tech_resolved", columnDefinition = "jsonb")
    private Map<String, Object> coreTechResolved;

    @Column(name = "core_tech_language_pack", length = 100)
    private String coreTechLanguagePack;

    /**
     * Denormalised framework pack IDs. JSONB string array; empty array allowed;
     * NULL means unresolved.
     */
    @Type(JsonType.class)
    @Column(name = "core_tech_framework_packs", columnDefinition = "jsonb")
    private List<String> coreTechFrameworkPacks;

    /**
     * Resolution confidence tier. One of 'high', 'low', 'none', 'tech-only',
     * 'manual-override'. Enforced by DB CHECK constraint (mirrors services).
     */
    @Column(name = "core_tech_resolution_confidence", length = 20)
    private String coreTechResolutionConfidence;

    @Column(name = "core_tech_resolved_at")
    private Instant coreTechResolvedAt;

    // ------------------------------------------------------------------
    // Provenance columns (mirror Infrastructure spec-7 verbatim).
    // Column is last_verified_at, NOT last_scanned_at.
    // ------------------------------------------------------------------

    @Column(name = "source_origin")
    private String sourceOrigin;

    @Column(name = "source_system")
    private String sourceSystem;

    @Column(name = "source_reference")
    private String sourceReference;

    @Column(name = "generation_status")
    private String generationStatus;

    @Column(name = "generation_notes")
    private String generationNotes;

    @Column(name = "last_verified_at")
    private String lastVerifiedAt;

    // ------------------------------------------------------------------
    // Package Set FK (mirrors services.package_set_id).
    // ------------------------------------------------------------------

    @Column(name = "package_set_id")
    private String packageSetId;
}
