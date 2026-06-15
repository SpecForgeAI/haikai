package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "logical_data_entities")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class LogicalDataEntityEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "model_file_id", nullable = false)
    private String modelFileId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "description")
    private String description;

    @Column(name = "tags")
    private String tags;

    @Column(name = "valid_from")
    private String validFrom;

    @Column(name = "valid_to")
    private String validTo;

    /**
     * Small provenance string on a minted SOAP message entity: the source
     * namespace and/or originating DTO class name (e.g.
     * {@code "http://example.com/orders :: com.example.orders.ws.Foo"}).
     * Plain nullable {@code TEXT} column; a PATCH omitting it preserves the
     * existing value (a plain {@link String} reference, never overwritten with a
     * primitive default). snake_case wire; no {@code @CamelCaseWire}.
     *
     * <p>Spec: SOAP/WSDL Message-Field Depth for Discovery (2026-05-30) --
     * Task Group 1.</p>
     */
    @Column(name = "source_provenance")
    private String sourceProvenance;
}
