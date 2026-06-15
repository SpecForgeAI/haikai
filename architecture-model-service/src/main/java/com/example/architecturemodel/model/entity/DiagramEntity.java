package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.Map;

@Entity
@Table(name = "diagrams")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class DiagramEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "diagram_type")
    private String diagramType;

    @Type(JsonType.class)
    @Column(name = "settings", columnDefinition = "jsonb")
    private Map<String, Object> settings;

    @Column(name = "view_quarter")
    private String viewQuarter;

    /**
     * Stores type-specific content for non-General diagrams as JSONB.
     *
     * Envelope structure:
     * {
     *   "type": "Sequence" | "ER" | "Activity" | "State",
     *   "version": 1,
     *   "content": { ...type-specific content... }
     * }
     *
     * NULL for General diagrams which have no typed content.
     * Added by migration 007-typed-content-json.sql
     *
     * Uses Map<String, Object> for flexible JSON handling compatible with both
     * PostgreSQL (via Liquibase migration) and H2 (for tests).
     */
    @Type(JsonType.class)
    @Column(name = "typed_content_json", columnDefinition = "jsonb")
    private Map<String, Object> typedContentJson;
}
