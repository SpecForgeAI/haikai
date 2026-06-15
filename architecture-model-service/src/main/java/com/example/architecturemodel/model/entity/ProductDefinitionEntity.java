package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.util.UUID;

/**
 * JPA Entity for ProductDefinition.
 *
 * Maps to the product_definitions table. Represents a minimal product
 * definition (product name) with a 1:1 relationship to Project.
 *
 * Spec: Increment 1 -- Add Product Tab + Minimal ProductDefinition (UI + DB only)
 */
@Entity
@Table(name = "product_definitions")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ProductDefinitionEntity {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "project_id", unique = true, nullable = false)
    private UUID projectId;

    @Column(name = "product_name", nullable = false)
    private String productName;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;
}
