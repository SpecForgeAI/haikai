package com.example.architecturemodel.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Focused unit tests verifying that the 16 Infrastructure tables introduced
 * by spec 1 are wired into {@link ArchitectureCloneService#IN_SCOPE_TABLES_IN_ORDER}
 * in dependency-safe order so architecture clone (and the inheriting
 * {@code ArchitectureSelectiveCopyService}) carries Infrastructure rows
 * across.
 *
 * <p>These tests assert against the package-private static list directly —
 * no Spring context, no JDBC, no fixtures. They exist to lock in the
 * ordering invariants documented in the spec / tasks.md so a future
 * refactor cannot silently regress the FK-dependency ordering.</p>
 *
 * Spec: Infrastructure Domain Backend API (spec 2 of 7).
 * Task Group 1: Extend ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER.
 */
class ArchitectureCloneServiceInScopeTablesTest {

    private static final List<String> ORDER = ArchitectureCloneService.IN_SCOPE_TABLES_IN_ORDER;

    private static final List<String> INFRA_BASE_BLOCK = List.of(
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
        "infrastructure_points"
    );

    private static final List<String> INFRA_RELATIONSHIP_BLOCK = List.of(
        "resource_subnet_hostings",
        "deployment_unit_compute_resources",
        "load_balancer_resource_routes"
    );

    @Test
    @DisplayName("All 13 Infrastructure base tables (12 entities + infrastructure_points) are in IN_SCOPE_TABLES_IN_ORDER")
    void baseInfrastructureTablesPresent() {
        assertThat(ORDER).containsAll(INFRA_BASE_BLOCK);
    }

    @Test
    @DisplayName("All 3 Infrastructure relationship tables are in IN_SCOPE_TABLES_IN_ORDER")
    void relationshipInfrastructureTablesPresent() {
        assertThat(ORDER).containsAll(INFRA_RELATIONSHIP_BLOCK);
    }

    @Test
    @DisplayName("environments precedes every other Infra entity, infrastructure_points is last in the Infra base block")
    void infrastructureBaseOrderingIsDependencySafe() {
        // environments must precede every other Infra entity (every other
        // Infra entity carries environment_id NOT NULL).
        int environmentsIdx = ORDER.indexOf("environments");
        assertThat(environmentsIdx).isGreaterThanOrEqualTo(0);
        for (String otherEntity : INFRA_BASE_BLOCK) {
            if ("environments".equals(otherEntity)) continue;
            assertThat(ORDER.indexOf(otherEntity))
                .as("'%s' must appear after 'environments'", otherEntity)
                .isGreaterThan(environmentsIdx);
        }

        // infrastructure_points is last in the Infra base block (its 12
        // typed FKs reference each entity above).
        int infrastructurePointsIdx = ORDER.indexOf("infrastructure_points");
        assertThat(infrastructurePointsIdx).isGreaterThanOrEqualTo(0);
        for (String entity : INFRA_BASE_BLOCK) {
            if ("infrastructure_points".equals(entity)) continue;
            assertThat(ORDER.indexOf(entity))
                .as("'%s' must precede 'infrastructure_points'", entity)
                .isLessThan(infrastructurePointsIdx);
        }

        // The relative order environments -> cloud_accounts -> locations ->
        // networks -> subnets must be preserved (FK-dependency-driven).
        assertThat(ORDER.indexOf("environments"))
            .isLessThan(ORDER.indexOf("cloud_accounts"));
        assertThat(ORDER.indexOf("cloud_accounts"))
            .isLessThan(ORDER.indexOf("locations"));
        assertThat(ORDER.indexOf("locations"))
            .isLessThan(ORDER.indexOf("networks"));
        assertThat(ORDER.indexOf("networks"))
            .isLessThan(ORDER.indexOf("subnets"));
    }

    @Test
    @DisplayName("Infrastructure relationship tables appear after infrastructure_points and after data_movements")
    void relationshipTablesAppearInDependentRowsSection() {
        int infrastructurePointsIdx = ORDER.indexOf("infrastructure_points");
        int dataMovementsIdx = ORDER.indexOf("data_movements");
        assertThat(infrastructurePointsIdx).isGreaterThanOrEqualTo(0);
        assertThat(dataMovementsIdx).isGreaterThanOrEqualTo(0);

        for (String relationshipTable : INFRA_RELATIONSHIP_BLOCK) {
            int idx = ORDER.indexOf(relationshipTable);
            assertThat(idx)
                .as("'%s' must appear after 'infrastructure_points'", relationshipTable)
                .isGreaterThan(infrastructurePointsIdx);
            assertThat(idx)
                .as("'%s' must appear after 'data_movements' (DEPENDENT-rows section)", relationshipTable)
                .isGreaterThan(dataMovementsIdx);
        }
    }
}
