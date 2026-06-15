package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

/**
 * PackageSet entity - represents a group of packages for service design.
 *
 * Extended with standard_key and standard_source fields for Package Set Standards Import:
 * - standard_key: Unique key for imported sets (e.g., "JavaCrud"), NULL for user-created
 * - standard_source: Source of import ("COMPANY" | "PROJECT"), NULL for user-created
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Entity
@Table(name = "package_sets")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PackageSetEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    /**
     * Unique key for imported package sets (e.g., "JavaCrud").
     * NULL for user-created package sets.
     *
     * Used with standard_source for deterministic upsert during import.
     */
    @Column(name = "standard_key")
    private String standardKey;

    /**
     * Source of the import: "COMPANY" or "PROJECT".
     * NULL for user-created package sets.
     *
     * Project-level imports take precedence over company-level on key conflicts.
     */
    @Column(name = "standard_source", length = 16)
    private String standardSource;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
