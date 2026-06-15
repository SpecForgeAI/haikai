package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

/**
 * Package entity - represents a package within a PackageSet.
 *
 * Extended with standard_source and standard_key fields for Package Set Standards Import:
 * - standard_source: Source of import ("COMPANY" | "PROJECT"), NULL for user-created
 * - standard_key: Optional compound key (e.g., "JavaCrud:controller")
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Entity
@Table(name = "packages")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PackageEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "package_set_id", nullable = false)
    private String packageSetId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "purpose")
    private String purpose;

    @Column(name = "sort_order")
    private Integer sortOrder;

    /**
     * Source of the import: "COMPANY" or "PROJECT".
     * NULL for user-created packages.
     */
    @Column(name = "standard_source", length = 16)
    private String standardSource;

    /**
     * Optional compound key for imported packages (e.g., "JavaCrud:controller").
     * Used for deterministic identification during import.
     */
    @Column(name = "standard_key")
    private String standardKey;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
