package com.example.architecturemodel.model.entity;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Type;

import java.util.Map;

@Entity
@Table(name = "business_logics")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class BusinessLogicEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "type_text")
    private String typeText;

    @Column(name = "description_md")
    private String descriptionMd;

    @Column(name = "tags")
    private String tags;

    /**
     * Structured 7-part behaviour block captured per rule-bearing method by the
     * discovery behaviour-capture stage (IO; validation/preconditions;
     * transformation/computation; data effects; side effects; edge cases;
     * provenance + confidence). JSONB blob; boxed reference type ({@link Map})
     * so a PATCH carrying no value preserves the existing column content.
     *
     * <p>The block embeds its OWN internal {@code schema_version} and
     * {@code source_hash} (re-run cache key) -- they are NOT separate columns,
     * so the block shape evolves without a schema migration (mirroring
     * {@code EndpointDataEffectEntity.pathMetadataJson} from Spec 1). The
     * embedded confidence (part 7) is a {@link Double} inside this map shape --
     * never a top-level primitive column.</p>
     *
     * <p>Stored via the Hypersistence {@link JsonType}, the identical
     * JSONB-via-Hibernate idiom used by
     * {@code EndpointDataEffectEntity.pathMetadataJson}. A null/absent block
     * round-trips cleanly (existing rows carry none).</p>
     *
     * <p>Spec: Business-logic behaviour capture for discovery
     * (2026-05-29) -- Task Group 1.</p>
     */
    @Type(JsonType.class)
    @Column(name = "behavior", columnDefinition = "jsonb")
    private Map<String, Object> behavior;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
