package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.io.Serializable;
import java.util.Objects;
import java.util.UUID;

/**
 * JPA Entity for Architecture Tag (normalised tag storage for fast filter).
 *
 * Maps to the `architecture_tag` table introduced by migration 087. Each row
 * is one (architecture_id, tag_value) pair. The composite primary key matches
 * the table-level UNIQUE constraint and supports efficient filter-by-tag
 * queries (used in spec #3 UI).
 *
 * Spec: Multi-Architecture Plumbing (Spec #1)
 */
@Entity
@Table(name = "architecture_tag")
@IdClass(ArchitectureTagEntity.ArchitectureTagId.class)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ArchitectureTagEntity {

    @Id
    @Column(name = "architecture_id", nullable = false)
    private UUID architectureId;

    @Id
    @Column(name = "tag_value", nullable = false)
    private String tagValue;

    /**
     * Composite primary key class for the (architecture_id, tag_value) pair.
     * Required by JPA when using @IdClass.
     */
    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ArchitectureTagId implements Serializable {
        private UUID architectureId;
        private String tagValue;

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ArchitectureTagId that)) return false;
            return Objects.equals(architectureId, that.architectureId)
                && Objects.equals(tagValue, that.tagValue);
        }

        @Override
        public int hashCode() {
            return Objects.hash(architectureId, tagValue);
        }
    }
}
