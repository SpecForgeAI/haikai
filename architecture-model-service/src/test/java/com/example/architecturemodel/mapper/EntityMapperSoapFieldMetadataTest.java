package com.example.architecturemodel.mapper;

import com.example.architecturemodel.model.dto.entity.LogicalDataAttributeDto;
import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.entity.LogicalDataAttributeEntity;
import com.example.architecturemodel.model.entity.LogicalDataEntityEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the SOAP/WSDL message-field-depth additions to the logical
 * data attribute/entity mappings through EntityMapper (Spec: 2026-05-30
 * SOAP/WSDL Message-Field Depth for Discovery -- Task Group 1).
 *
 * <p>Covers the on-attribute JSONB {@code field_metadata} blob (cardinality +
 * value-domain restrictions + XSD source-type) and the on-entity
 * {@code source_provenance} field. Mirrors the EntityMapperIsCollectionTest
 * style: a plain {@link EntityMapper} unit, no Spring context.</p>
 */
class EntityMapperSoapFieldMetadataTest {

    private EntityMapper entityMapper;

    @BeforeEach
    void setUp() {
        entityMapper = new EntityMapper();
    }

    /**
     * Builds a representative field-metadata blob: cardinality (min_occurs /
     * max_occurs / is_collection), the full set of value-domain restrictions
     * (enumeration / pattern / minLength / maxLength / minInclusive /
     * maxInclusive / totalDigits / fractionDigits), and the captured-as-is XSD
     * source-type string.
     */
    private static Map<String, Object> sampleFieldMetadata() {
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("min_occurs", 0);
        meta.put("max_occurs", "unbounded");
        meta.put("is_collection", true);
        meta.put("xsd_type", "tns:OrderLineType");
        meta.put("enumeration", List.of("GBP", "USD", "EUR"));
        meta.put("pattern", "[A-Z]{3}");
        meta.put("minLength", 3);
        meta.put("maxLength", 3);
        meta.put("minInclusive", 0);
        meta.put("maxInclusive", 100000);
        meta.put("totalDigits", 10);
        meta.put("fractionDigits", 2);
        return meta;
    }

    @Test
    @DisplayName("attribute field_metadata JSONB blob round-trips DTO -> entity -> DTO")
    void attributeFieldMetadata_roundTrips() {
        Map<String, Object> meta = sampleFieldMetadata();

        LogicalDataAttributeDto dto = new LogicalDataAttributeDto(
            "lda-1",
            "currencyCode",
            "ISO currency",
            "lde-order",
            "string",
            false,
            true,
            "soap",
            meta
        );

        // DTO -> entity carries the blob through.
        LogicalDataAttributeEntity entity = entityMapper.toEntity(dto, "model-1");
        assertThat(entity.getFieldMetadata()).isNotNull();
        assertThat(entity.getFieldMetadata())
            .containsEntry("min_occurs", 0)
            .containsEntry("max_occurs", "unbounded")
            .containsEntry("is_collection", true)
            .containsEntry("xsd_type", "tns:OrderLineType")
            .containsEntry("pattern", "[A-Z]{3}")
            .containsEntry("minLength", 3)
            .containsEntry("maxLength", 3)
            .containsEntry("minInclusive", 0)
            .containsEntry("maxInclusive", 100000)
            .containsEntry("totalDigits", 10)
            .containsEntry("fractionDigits", 2);
        assertThat(entity.getFieldMetadata().get("enumeration"))
            .isEqualTo(List.of("GBP", "USD", "EUR"));

        // entity -> DTO round-trips the same blob.
        LogicalDataAttributeDto back = entityMapper.toDto(entity);
        assertThat(back.fieldMetadata()).isEqualTo(meta);
    }

    @Test
    @DisplayName("entity source_provenance round-trips DTO -> entity -> DTO")
    void entitySourceProvenance_roundTrips() {
        LogicalDataEntityDto dto = new LogicalDataEntityDto(
            "lde-order",
            "PlaceOrderRequest",
            "Order placement request message",
            "soap",
            null,
            null,
            "http://example.com/orders :: com.example.orders.ws.PlaceOrderRequest"
        );

        LogicalDataEntityEntity entity = entityMapper.toEntity(dto, "model-1");
        assertThat(entity.getSourceProvenance())
            .isEqualTo("http://example.com/orders :: com.example.orders.ws.PlaceOrderRequest");

        LogicalDataEntityDto back = entityMapper.toDto(entity);
        assertThat(back.sourceProvenance())
            .isEqualTo("http://example.com/orders :: com.example.orders.ws.PlaceOrderRequest");
    }

    @Test
    @DisplayName("PATCH omitting attribute field_metadata (null) does NOT fabricate a value")
    void attributeFieldMetadata_patchOmitted_staysNull() {
        // A DTO that carries no field_metadata (e.g. a PATCH touching only the
        // description) must leave the JSONB column null -- boxed Map<String,Object>
        // preserves null, per project_primitive_double_dto_overwrite.md.
        LogicalDataAttributeDto dto = new LogicalDataAttributeDto(
            "lda-2",
            "quantity",
            "updated description",
            "lde-order",
            "int",
            false,
            false,
            null,
            null // field_metadata omitted
        );

        LogicalDataAttributeEntity entity = entityMapper.toEntity(dto, "model-1");
        assertThat(entity.getFieldMetadata()).isNull();
        assertThat(entityMapper.toDto(entity).fieldMetadata()).isNull();
    }

    @Test
    @DisplayName("PATCH omitting entity source_provenance (null) does NOT fabricate a value")
    void entitySourceProvenance_patchOmitted_staysNull() {
        LogicalDataEntityDto dto = new LogicalDataEntityDto(
            "lde-2",
            "GetOrderResponse",
            "updated description",
            "soap",
            null,
            null,
            null // source_provenance omitted
        );

        LogicalDataEntityEntity entity = entityMapper.toEntity(dto, "model-1");
        assertThat(entity.getSourceProvenance()).isNull();
        assertThat(entityMapper.toDto(entity).sourceProvenance()).isNull();
    }

    @Test
    @DisplayName("is_nullable stays a real Boolean column, independent of field_metadata")
    void isNullable_unaffectedByFieldMetadata() {
        // is_nullable must be mapped from `nillable` as a real Boolean and NOT
        // be overloaded by / conflated with the cardinality in field_metadata.
        // min_occurs=0 (optional) coexists with is_nullable=false (present-but-
        // not-null) -- they are distinct facts.
        Map<String, Object> meta = new LinkedHashMap<>();
        meta.put("min_occurs", 0);
        meta.put("max_occurs", "1");
        meta.put("is_collection", false);
        meta.put("xsd_type", "xsd:string");

        LogicalDataAttributeDto nonNullableOptional = new LogicalDataAttributeDto(
            "lda-3",
            "middleName",
            null,
            "lde-person",
            "string",
            false,
            false, // is_nullable = false
            null,
            meta
        );

        LogicalDataAttributeEntity entity = entityMapper.toEntity(nonNullableOptional, "model-1");
        assertThat(entity.getIsNullable()).isFalse();
        assertThat(entity.getFieldMetadata()).containsEntry("min_occurs", 0);

        // And the inverse pairing: nillable=true with a required (min_occurs=1) field.
        Map<String, Object> meta2 = new LinkedHashMap<>();
        meta2.put("min_occurs", 1);
        LogicalDataAttributeDto nullableRequired = new LogicalDataAttributeDto(
            "lda-4",
            "spouseId",
            null,
            "lde-person",
            "string",
            false,
            true, // is_nullable = true
            null,
            meta2
        );
        LogicalDataAttributeEntity entity2 = entityMapper.toEntity(nullableRequired, "model-1");
        assertThat(entity2.getIsNullable()).isTrue();
        assertThat(entity2.getFieldMetadata()).containsEntry("min_occurs", 1);

        // is_nullable still defaults to true when the DTO omits it (existing behaviour).
        LogicalDataAttributeDto omittedNullable = new LogicalDataAttributeDto(
            "lda-5", "note", null, "lde-person", "string", false, null, null, null);
        assertThat(entityMapper.toEntity(omittedNullable, "model-1").getIsNullable()).isTrue();
    }
}
