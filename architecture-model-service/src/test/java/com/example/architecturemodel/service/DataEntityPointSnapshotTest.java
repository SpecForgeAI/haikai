package com.example.architecturemodel.service;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.DataEntityPointDto;
import com.example.architecturemodel.model.dto.entity.LogicalDataEntityDto;
import com.example.architecturemodel.model.dto.entity.PhysicalDataEntityDto;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for snapshot export/import of Data Entity Points.
 *
 * Verifies that dataEntityPoints are correctly serialized in export JSON
 * and restored during import.
 *
 * Spec: Data Entity Point Superclass
 */
class DataEntityPointSnapshotTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void testExportIncludesDataEntityPointsArrayInJson() throws Exception {
        // Given: MetaModelEntitiesDto with dataEntityPoints
        DataEntityPointDto point1 = new DataEntityPointDto(
            "dep_log_customer",
            "LOGICAL_ENTITY",
            "logical-customer",
            null,
            "Customer entity point",
            "domain:customer",
            "2024-01-01",
            null
        );

        DataEntityPointDto point2 = new DataEntityPointDto(
            "dep_phy_orders",
            "PHYSICAL_ENTITY",
            null,
            "physical-orders",
            "Orders table point",
            "persistence:sql",
            null,
            null
        );

        MetaModelEntitiesDto entities = createEntitiesWithDataEntityPoints(List.of(point1, point2));
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto model = new ArchitectureModelDto(metaModel, List.of());

        // When: Serialize to JSON
        String json = objectMapper.writeValueAsString(model);

        // Then: JSON contains data_entity_points array
        assertThat(json).contains("\"data_entity_points\"");
        assertThat(json).contains("\"dep_log_customer\"");
        assertThat(json).contains("\"dep_phy_orders\"");
        assertThat(json).contains("\"LOGICAL_ENTITY\"");
        assertThat(json).contains("\"PHYSICAL_ENTITY\"");
        assertThat(json).contains("\"logical_entity_id\"");
        assertThat(json).contains("\"physical_entity_id\"");
    }

    @Test
    void testImportRestoresDataEntityPointsFromSnapshot() throws Exception {
        // Given: JSON snapshot with data_entity_points
        String json = """
            {
              "metaModel": {
                "entities": {
                  "business_users": [],
                  "business_processes": [],
                  "process_activities": [],
                  "business_points": [],
                  "applications": [],
                  "app_components": [],
                  "services": [],
                  "interfaces": [],
                  "endpoints": [],
                  "classes": [],
                  "methods": [],
                  "application_points": [],
                  "logical_data_entities": [],
                  "logical_data_attributes": [],
                  "physical_data_entities": [],
                  "physical_data_attributes": [],
                  "data_entity_points": [
                    {
                      "id": "dep_log_imported",
                      "point_kind": "LOGICAL_ENTITY",
                      "logical_entity_id": "logical-imported",
                      "physical_entity_id": null,
                      "description": "Imported point",
                      "tags": "import:test",
                      "valid_from": null,
                      "valid_to": null
                    }
                  ],
                  "interactions": [],
                  "app_business_points": [],
                  "events": [],
                  "states": [],
                  "state_transitions": [],
                  "activities": [],
                  "activity_flows": [],
                  "activity_partitions": [],
                  "ui_screens": [],
                  "ui_contracts": [],
                  "ui_components": [],
                  "ui_actions": [],
                  "business_logics": [],
                  "package_sets": [],
                  "packages": [],
                  "package_set_default_rules": []
                },
                "relationships": {
                  "business_user_business_points": [],
                  "application_point_business_points": [],
                  "logical_data_entity_relationships": [],
                  "logical_data_entity_physical_data_entities": [],
                  "logical_data_attribute_physical_data_attributes": [],
                  "data_movements": [],
                  "interface_logical_entities": [],
                  "ui_workflow_transitions": [],
                  "application_point_business_logics": []
                }
              },
              "diagrams": []
            }
            """;

        // When: Deserialize from JSON
        ArchitectureModelDto model = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: dataEntityPoints are restored
        assertThat(model.metaModel().entities().dataEntityPoints()).hasSize(1);
        DataEntityPointDto point = model.metaModel().entities().dataEntityPoints().get(0);
        assertThat(point.id()).isEqualTo("dep_log_imported");
        assertThat(point.pointKind()).isEqualTo("LOGICAL_ENTITY");
        assertThat(point.logicalEntityId()).isEqualTo("logical-imported");
        assertThat(point.physicalEntityId()).isNull();
        assertThat(point.description()).isEqualTo("Imported point");
        assertThat(point.tags()).isEqualTo("import:test");
    }

    @Test
    void testEmptyDataEntityPointsArrayImportsSuccessfully() throws Exception {
        // Given: JSON snapshot with empty data_entity_points
        String json = """
            {
              "metaModel": {
                "entities": {
                  "business_users": [],
                  "business_processes": [],
                  "process_activities": [],
                  "business_points": [],
                  "applications": [],
                  "app_components": [],
                  "services": [],
                  "interfaces": [],
                  "endpoints": [],
                  "classes": [],
                  "methods": [],
                  "application_points": [],
                  "logical_data_entities": [],
                  "logical_data_attributes": [],
                  "physical_data_entities": [],
                  "physical_data_attributes": [],
                  "data_entity_points": [],
                  "interactions": [],
                  "app_business_points": [],
                  "events": [],
                  "states": [],
                  "state_transitions": [],
                  "activities": [],
                  "activity_flows": [],
                  "activity_partitions": [],
                  "ui_screens": [],
                  "ui_contracts": [],
                  "ui_components": [],
                  "ui_actions": [],
                  "business_logics": [],
                  "package_sets": [],
                  "packages": [],
                  "package_set_default_rules": []
                },
                "relationships": {
                  "business_user_business_points": [],
                  "application_point_business_points": [],
                  "logical_data_entity_relationships": [],
                  "logical_data_entity_physical_data_entities": [],
                  "logical_data_attribute_physical_data_attributes": [],
                  "data_movements": [],
                  "interface_logical_entities": [],
                  "ui_workflow_transitions": [],
                  "application_point_business_logics": []
                }
              },
              "diagrams": []
            }
            """;

        // When: Deserialize from JSON
        ArchitectureModelDto model = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: dataEntityPoints is empty list (not null)
        assertThat(model.metaModel().entities().dataEntityPoints()).isNotNull();
        assertThat(model.metaModel().entities().dataEntityPoints()).isEmpty();
    }

    @Test
    void testRoundTripSerializationConsistency() throws Exception {
        // Given: Original model with data entity points
        DataEntityPointDto point = new DataEntityPointDto(
            "dep_phy_roundtrip",
            "PHYSICAL_ENTITY",
            null,
            "phy-roundtrip",
            "Roundtrip test",
            "test:roundtrip",
            "2024-01-01",
            "2024-12-31"
        );

        MetaModelEntitiesDto entities = createEntitiesWithDataEntityPoints(List.of(point));
        MetaModelRelationshipsDto relationships = createEmptyRelationships();
        MetaModelDto metaModel = new MetaModelDto(entities, relationships);
        ArchitectureModelDto original = new ArchitectureModelDto(metaModel, List.of());

        // When: Serialize and deserialize
        String json = objectMapper.writeValueAsString(original);
        ArchitectureModelDto restored = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: Data entity points are identical
        assertThat(restored.metaModel().entities().dataEntityPoints()).hasSize(1);
        DataEntityPointDto restoredPoint = restored.metaModel().entities().dataEntityPoints().get(0);

        assertThat(restoredPoint.id()).isEqualTo(point.id());
        assertThat(restoredPoint.pointKind()).isEqualTo(point.pointKind());
        assertThat(restoredPoint.logicalEntityId()).isEqualTo(point.logicalEntityId());
        assertThat(restoredPoint.physicalEntityId()).isEqualTo(point.physicalEntityId());
        assertThat(restoredPoint.description()).isEqualTo(point.description());
        assertThat(restoredPoint.tags()).isEqualTo(point.tags());
        assertThat(restoredPoint.validFrom()).isEqualTo(point.validFrom());
        assertThat(restoredPoint.validTo()).isEqualTo(point.validTo());
    }

    @Test
    void testImportWithLogicalAndPhysicalEntitiesIncludesPoints() throws Exception {
        // Given: JSON with logical and physical entities
        String json = """
            {
              "metaModel": {
                "entities": {
                  "business_users": [],
                  "business_processes": [],
                  "process_activities": [],
                  "business_points": [],
                  "applications": [],
                  "app_components": [],
                  "services": [],
                  "interfaces": [],
                  "endpoints": [],
                  "classes": [],
                  "methods": [],
                  "application_points": [],
                  "logical_data_entities": [
                    {"id": "log-ent-1", "name": "Customer", "description": null, "tags": null, "valid_from": null, "valid_to": null}
                  ],
                  "logical_data_attributes": [],
                  "physical_data_entities": [
                    {"id": "phy-ent-1", "name": "customers_tbl", "description": null, "physical_type": "TABLE", "database": "postgres", "tags": null, "valid_from": null, "valid_to": null}
                  ],
                  "physical_data_attributes": [],
                  "data_entity_points": [
                    {"id": "dep_log_log-ent-1", "point_kind": "LOGICAL_ENTITY", "logical_entity_id": "log-ent-1", "physical_entity_id": null, "description": null, "tags": null, "valid_from": null, "valid_to": null},
                    {"id": "dep_phy_phy-ent-1", "point_kind": "PHYSICAL_ENTITY", "logical_entity_id": null, "physical_entity_id": "phy-ent-1", "description": null, "tags": null, "valid_from": null, "valid_to": null}
                  ],
                  "interactions": [],
                  "app_business_points": [],
                  "events": [],
                  "states": [],
                  "state_transitions": [],
                  "activities": [],
                  "activity_flows": [],
                  "activity_partitions": [],
                  "ui_screens": [],
                  "ui_contracts": [],
                  "ui_components": [],
                  "ui_actions": [],
                  "business_logics": [],
                  "package_sets": [],
                  "packages": [],
                  "package_set_default_rules": []
                },
                "relationships": {
                  "business_user_business_points": [],
                  "application_point_business_points": [],
                  "logical_data_entity_relationships": [],
                  "logical_data_entity_physical_data_entities": [],
                  "logical_data_attribute_physical_data_attributes": [],
                  "data_movements": [],
                  "interface_logical_entities": [],
                  "ui_workflow_transitions": [],
                  "application_point_business_logics": []
                }
              },
              "diagrams": []
            }
            """;

        // When: Deserialize
        ArchitectureModelDto model = objectMapper.readValue(json, ArchitectureModelDto.class);

        // Then: All data is present
        assertThat(model.metaModel().entities().logicalDataEntities()).hasSize(1);
        assertThat(model.metaModel().entities().physicalDataEntities()).hasSize(1);
        assertThat(model.metaModel().entities().dataEntityPoints()).hasSize(2);

        // Verify points reference correct entities
        assertThat(model.metaModel().entities().dataEntityPoints())
            .anyMatch(p -> "dep_log_log-ent-1".equals(p.id()) && "log-ent-1".equals(p.logicalEntityId()))
            .anyMatch(p -> "dep_phy_phy-ent-1".equals(p.id()) && "phy-ent-1".equals(p.physicalEntityId()));
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    private MetaModelEntitiesDto createEntitiesWithDataEntityPoints(List<DataEntityPointDto> dataEntityPoints) {
        return new MetaModelEntitiesDto(
            List.of(), // businessUsers
            List.of(), // businessProcesses
            List.of(), // processActivities
            List.of(), // businessPoints
            List.of(), // applications
            List.of(), // appComponents
            List.of(), // services
            List.of(), // interfaces
            List.of(), // endpoints
            List.of(), // classes
            List.of(), // methods
            List.of(), // applicationPoints
            List.of(), // logicalDataEntities
            List.of(), // logicalDataAttributes
            List.of(), // physicalDataEntities
            List.of(), // physicalDataAttributes
            dataEntityPoints, // dataEntityPoints
            List.of(), // interactions
            List.of(), // appBusinessPoints
            List.of(), // events
            List.of(), // states
            List.of(), // stateTransitions
            List.of(), // activities
            List.of(), // activityFlows
            List.of(), // activityPartitions
            List.of(), // uiScreens
            List.of(), // uiContracts
            List.of(), // uiComponents
            List.of(), // uiActions
            List.of(), // businessLogics
            List.of(), // packageSets
            List.of(), // packages
            List.of(), // packageSetDefaultRules
            List.of(), // userJourneys
            List.of(),  // activitySteps
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()
        );
    }

    private MetaModelRelationshipsDto createEmptyRelationships() {
        return com.example.architecturemodel.testsupport.TestMetaModelFactory.emptyRelationships();
    }
}
