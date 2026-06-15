package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused unit tests verifying that the 16 Infrastructure tables introduced
 * by spec 1 are wired into {@link ArchitectureElementInventoryService}'s
 * package-private static fields so the elements-inventory endpoint exposes
 * Infrastructure as a domain entry and the inventory probe degrades
 * gracefully on the 4 name-less Infra tables.
 *
 * <p>These tests assert against the package-private static fields directly
 * — no Spring context, no JDBC, no fixtures. They lock in the
 * {@code TABLES_BY_DOMAIN.get("Infrastructure")} ordering invariant
 * documented in the service Javadoc ("mirrors IN_SCOPE_TABLES_IN_ORDER
 * verbatim, partitioned by domain").</p>
 *
 * Spec: Infrastructure Domain Backend API (spec 2 of 7).
 * Task Group 2: Extend ArchitectureElementInventoryService.
 */
class ArchitectureElementInventoryServiceInfrastructureTest {

    private static final List<String> EXPECTED_INFRA_TABLES_IN_DISPLAY_ORDER = List.of(
        "environments",
        "cloud_accounts",
        "locations",
        "networks",
        "subnets",
        "compute_clusters",
        "compute_resources",
        "deployment_units",
        "load_balancers",
        "listeners",
        "data_store_instances",
        "infrastructure_resources",
        "infrastructure_points",
        "resource_subnet_hostings",
        "deployment_unit_compute_resources",
        "load_balancer_resource_routes",
        // Infrastructure cross-domain relationships
        // (Spec: 2026-05-05-infrastructure-cross-domain-integration)
        "application_compute_deployments",
        "data_entity_data_store_hostings",
        "application_infrastructure_resource_uses",
        "application_load_balancer_exposures",
        // Infrastructure Terraform & Discovery Readiness
        // (Spec: 2026-05-05-infrastructure-terraform-discovery-readiness)
        "iac_sources",
        "iac_resource_bindings"
    );

    private static final List<String> INFRA_ENTITY_TABLES_WITH_NAME_COLUMN = List.of(
        "environments",
        "cloud_accounts",
        "locations",
        "networks",
        "subnets",
        "compute_clusters",
        "compute_resources",
        "deployment_units",
        "load_balancers",
        "listeners",
        "data_store_instances",
        "infrastructure_resources"
    );

    @Test
    @DisplayName("DOMAIN_ORDER contains 'Infrastructure' between 'Behavioural' and 'Diagrams'")
    void domainOrderContainsInfrastructureBetweenBehaviouralAndDiagrams() {
        List<String> order = ArchitectureElementInventoryService.DOMAIN_ORDER;

        assertThat(order).contains("Infrastructure");

        int behaviouralIdx = order.indexOf("Behavioural");
        int infrastructureIdx = order.indexOf("Infrastructure");
        int diagramsIdx = order.indexOf("Diagrams");

        assertThat(behaviouralIdx).isGreaterThanOrEqualTo(0);
        assertThat(infrastructureIdx).isGreaterThanOrEqualTo(0);
        assertThat(diagramsIdx).isGreaterThanOrEqualTo(0);

        assertThat(infrastructureIdx)
            .as("'Infrastructure' must appear after 'Behavioural'")
            .isGreaterThan(behaviouralIdx);
        assertThat(infrastructureIdx)
            .as("'Infrastructure' must appear before 'Diagrams'")
            .isLessThan(diagramsIdx);

        // Final order: [Applications, Data, Business, UI, Behavioural,
        // Infrastructure, Diagrams].
        assertThat(order).containsExactly(
            "Applications",
            "Data",
            "Business",
            "UI",
            "Behavioural",
            "Infrastructure",
            "Diagrams"
        );
    }

    @Test
    @DisplayName("TABLES_BY_DOMAIN.get('Infrastructure') returns all 22 Infra tables in display order")
    void tablesByDomainContainsAllInfraTablesInDisplayOrder() {
        Map<String, List<Map.Entry<String, String>>> tablesByDomain =
            ArchitectureElementInventoryService.TABLES_BY_DOMAIN;

        List<Map.Entry<String, String>> infraEntries = tablesByDomain.get("Infrastructure");
        assertThat(infraEntries)
            .as("Infrastructure entry must exist in TABLES_BY_DOMAIN")
            .isNotNull();

        // 12 entity tables -> infrastructure_points -> 3 relationship tables
        // -> 4 cross-domain relationship tables -> 2 IaC tables = 22 total.
        assertThat(infraEntries).hasSize(22);

        List<String> tableNames = infraEntries.stream()
            .map(Map.Entry::getKey)
            .toList();
        assertThat(tableNames).containsExactlyElementsOf(EXPECTED_INFRA_TABLES_IN_DISPLAY_ORDER);
    }

    @Test
    @DisplayName("DISPLAY_NAME_FALLBACK_TABLES contains the 4 name-less Infra tables")
    void displayNameFallbackTablesContainsFourNameLessInfraTables() {
        var fallback = ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES;

        // The polymorphic supertype + 3 relationship tables have no `name`
        // column; without these entries the inventory probe would emit
        // SELECT id, name FROM infrastructure_points etc and fail with
        // BadSqlGrammarException.
        assertThat(fallback).contains(
            "infrastructure_points",
            "resource_subnet_hostings",
            "deployment_unit_compute_resources",
            "load_balancer_resource_routes"
        );
    }

    @Test
    @DisplayName("DISPLAY_NAME_FALLBACK_TABLES does NOT contain the 12 Infra entity tables (they all have a name column)")
    void displayNameFallbackTablesExcludesEntityTablesWithNameColumn() {
        var fallback = ArchitectureElementInventoryService.DISPLAY_NAME_FALLBACK_TABLES;

        for (String entityTable : INFRA_ENTITY_TABLES_WITH_NAME_COLUMN) {
            assertThat(fallback)
                .as("'%s' has a name column and must NOT be in DISPLAY_NAME_FALLBACK_TABLES", entityTable)
                .doesNotContain(entityTable);
        }
    }
}
