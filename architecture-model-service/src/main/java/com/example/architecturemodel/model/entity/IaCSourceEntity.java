package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

/**
 * JPA entity representing an IaC Source.
 *
 * Records IaC source-of-record metadata (Terraform repo / path / workspace /
 * commit SHA / provider). An entity-shaped concept (has name, description,
 * tags, valid_from / valid_to). Bound to Infrastructure entities through
 * IaCResourceBindingEntity rows that reference an infrastructure_point_id.
 *
 * Provenance / readiness fields are NOT added to this entity itself --
 * IaCSourceEntity is an IaC source, not an Infra entity.
 *
 * Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
 */
@Entity
@Table(name = "iac_sources")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IaCSourceEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description", nullable = false)
    private String description;

    @Column(name = "tags", nullable = false)
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    @Column(name = "environment_id")
    private String environmentId;

    @Column(name = "source_type")
    private String sourceType;

    @Column(name = "repository_url")
    private String repositoryUrl;

    @Column(name = "repository_provider")
    private String repositoryProvider;

    @Column(name = "branch")
    private String branch;

    @Column(name = "commit_sha")
    private String commitSha;

    @Column(name = "path")
    private String path;

    @Column(name = "workspace")
    private String workspace;

    @Column(name = "module_name")
    private String moduleName;

    @Column(name = "module_path")
    private String modulePath;

    @Column(name = "provider")
    private String provider;

    @Column(name = "owner")
    private String owner;

    @Column(name = "last_scanned_at")
    private String lastScannedAt;

    @Column(name = "last_imported_at")
    private String lastImportedAt;
}
