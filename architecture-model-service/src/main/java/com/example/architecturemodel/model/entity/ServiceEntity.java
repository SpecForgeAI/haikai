package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "services")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ServiceEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "application_id", nullable = false)
    private String applicationId;

    @Column(name = "application_component_id")
    private String applicationComponentId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "service_type")
    private String serviceType;

    @Column(name = "core_tech")
    private String coreTech;

    @Column(name = "repo_location")
    private String repoLocation;

    @Column(name = "repo_subfolder")
    private String repoSubfolder;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    @Column(name = "package_set_id")
    private String packageSetId;

    @Column(name = "is_internal")
    private Boolean isInternal;

    // ------------------------------------------------------------------
    // Tech Hints LLM Resolution (spec 2026-04-20)
    //
    // These five columns persist the save-time, LLM-assisted resolution of
    // the free-text `core_tech` hint against the closed set of registered
    // language + framework packs. All nullable; NULL means "unresolved" and
    // causes the discovery-run tier gate to reject a run against this row.
    // ------------------------------------------------------------------

    /**
     * Full resolver response JSON (language, frameworks, confirmationSentence,
     * repoCrossCheck). NULL when the row has never been resolved.
     */
    @Type(JsonType.class)
    @Column(name = "core_tech_resolved", columnDefinition = "jsonb")
    private Map<String, Object> coreTechResolved;

    /**
     * Denormalised language pack ID from the resolve response (e.g. 'java-21').
     * NULL when the resolver could not match a registered language pack.
     */
    @Column(name = "core_tech_language_pack", length = 100)
    private String coreTechLanguagePack;

    /**
     * Denormalised framework pack IDs from the resolve response (e.g.
     * ['spring-boot-3']). Stored as JSONB string array for consistency with
     * other list columns in this service; empty array allowed; NULL means
     * unresolved.
     */
    @Type(JsonType.class)
    @Column(name = "core_tech_framework_packs", columnDefinition = "jsonb")
    private List<String> coreTechFrameworkPacks;

    /**
     * Resolution confidence tier. One of 'high', 'low', 'none', 'tech-only',
     * 'manual-override'. Enforced by DB CHECK constraint. NULL means unresolved.
     */
    @Column(name = "core_tech_resolution_confidence", length = 20)
    private String coreTechResolutionConfidence;

    /**
     * Instant the resolve was persisted. Used by the frontend to compute
     * staleness (greyed chips) when core_tech / repo_location / repo_subfolder
     * has been edited since this timestamp.
     */
    @Column(name = "core_tech_resolved_at")
    private Instant coreTechResolvedAt;
}
