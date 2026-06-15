package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

/**
 * PackageSetStandardsImportStatus entity - tracks import history and counts for audit and display.
 *
 * Records details of each import operation including file paths, revisions, and counts
 * of inserted/updated records.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Entity
@Table(name = "package_set_standards_import_status")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PackageSetStandardsImportStatusEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "imported_at", nullable = false)
    private OffsetDateTime importedAt;

    /**
     * Path to the company standards file that was imported.
     * NULL if no company file was found or processed.
     */
    @Column(name = "company_file_path")
    private String companyFilePath;

    /**
     * Path to the project standards file that was imported.
     * NULL if no project file was found or processed.
     */
    @Column(name = "project_file_path")
    private String projectFilePath;

    /**
     * Revision/version of the company standards file.
     * Extracted from the "revision" field in the JSON.
     */
    @Column(name = "company_revision")
    private String companyRevision;

    /**
     * Revision/version of the project standards file.
     * Extracted from the "revision" field in the JSON.
     */
    @Column(name = "project_revision")
    private String projectRevision;

    /**
     * Number of package sets that were newly inserted.
     */
    @Column(name = "inserted_sets")
    private Integer insertedSets;

    /**
     * Number of package sets that were updated (already existed).
     */
    @Column(name = "updated_sets")
    private Integer updatedSets;

    /**
     * Number of packages that were newly inserted.
     */
    @Column(name = "inserted_packages")
    private Integer insertedPackages;

    /**
     * Number of packages that were updated (already existed).
     */
    @Column(name = "updated_packages")
    private Integer updatedPackages;

    /**
     * Number of default rules that were newly inserted.
     */
    @Column(name = "inserted_rules")
    private Integer insertedRules;

    /**
     * Number of default rules that were updated (already existed).
     */
    @Column(name = "updated_rules")
    private Integer updatedRules;
}
