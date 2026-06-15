package com.example.architecturemodel.model.entity.discovery;

import io.hypersistence.utils.hibernate.type.json.JsonType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.Type;

import java.util.Map;

/**
 * JPA entity for {@code endpoint_data_effects} -- the endpoint-&gt;data-entity
 * data-effect relationship (controller&rarr;service&rarr;repository&rarr;entity).
 *
 * <p>Each row is ONE first-class, reviewable edge describing that an inbound
 * HTTP endpoint reads and/or writes a single data entity. An endpoint that
 * reads {@code Owner} and writes {@code Visit} produces TWO rows (one edge per
 * (endpoint, data-entity) pair).</p>
 *
 * <h2>Modelling precedent</h2>
 *
 * <p>Modelled on {@code InterfaceLogicalEntityEntity} (which carries
 * {@code direction} + {@code dataEntityPointId}) -- same {@code id} /
 * {@code model_file_id} / point-id-reference / {@code description} /
 * {@code tags} / {@code valid_from} / {@code valid_to} shape. This is a NEW
 * dedicated relationship; it deliberately does NOT overload the endpoint's
 * {@code request_/response_data_entity_point_id} payload columns nor the
 * {@code interface_logical_entities} table (those are wire-payload /
 * interface-level and semantically distinct from a read/write data effect).</p>
 *
 * <h2>Data-entity reference</h2>
 *
 * <p>{@link #dataEntityPointId} references the data entity via the
 * {@code dep_log_<entityId>} / {@code dep_phy_<entityId>} data-entity-point
 * convention (same format as DataMovements / InterfaceLogicalEntity), NOT a raw
 * entity FK.</p>
 *
 * <h2>Boxed types for PATCH safety</h2>
 *
 * <p>{@link #confidence} is {@link Double} (NOT primitive {@code double}). A
 * PATCH-style write carrying no value must be able to distinguish "field
 * omitted" from "field set to 0.0". See project memory note
 * {@code project_primitive_double_dto_overwrite.md}.</p>
 *
 * <h2>Structured path metadata</h2>
 *
 * <p>{@link #pathMetadataJson} stores the STRUCTURED, ordered list of hops
 * (each hop = FQN + method signature, e.g.
 * {@code com.foo.OwnerService#save(Owner)}), the finer operation hint
 * (insert/update/delete/select), and the {@code transactional} flag. Stored as
 * a JSONB column (via Hypersistence {@link JsonType}, mirroring
 * {@code EndpointEntity.protocolMetadataJson} / {@code DiscoveryFindingEntity.detailJson})
 * so a future call-tree UI can render the path without a schema migration.</p>
 *
 * <p>Spec: Endpoint&rarr;Data-Effect Call Graph for Discovery
 * (2026-05-29) -- Task Group 1.</p>
 */
@Entity
@Table(
    name = "endpoint_data_effects",
    indexes = {
        @Index(name = "idx_endpoint_data_effects_model_file", columnList = "model_file_id"),
        @Index(name = "idx_endpoint_data_effects_endpoint", columnList = "endpoint_id")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EndpointDataEffectEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    /** FK-as-id to {@code endpoints.id} -- the inbound HTTP endpoint side. */
    @Column(name = "endpoint_id", nullable = false)
    private String endpointId;

    /**
     * Data Entity Point ID -- the data-entity side. Format
     * {@code dep_log_<entityId>} for logical entities,
     * {@code dep_phy_<entityId>} for physical entities (the same convention
     * used by DataMovements / InterfaceLogicalEntity), NOT a raw entity FK.
     */
    @Column(name = "data_entity_point_id", nullable = false)
    private String dataEntityPointId;

    /** Headline access mode enum: {@code read} / {@code write} / {@code read-write}. */
    @Column(name = "access_mode")
    private String accessMode;

    /**
     * Structured, ordered hop list + operation hint + {@code transactional}
     * flag. JSONB blob; boxed reference type ({@link Map}) so a PATCH carrying
     * no value preserves the existing column content.
     */
    @Type(JsonType.class)
    @Column(name = "path_metadata_json", columnDefinition = "jsonb")
    private Map<String, Object> pathMetadataJson;

    /** Boxed {@link Double} so PATCH preserves {@code null} (NOT primitive). */
    @Column(name = "confidence")
    private Double confidence;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;
}
