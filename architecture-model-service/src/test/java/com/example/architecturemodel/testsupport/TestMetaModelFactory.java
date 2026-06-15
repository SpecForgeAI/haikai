package com.example.architecturemodel.testsupport;

import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;

import java.util.List;

/**
 * Shared factory for building empty MetaModel DTOs in tests.
 *
 * <p>Centralises the constructor calls so that when {@link MetaModelEntitiesDto}
 * or {@link MetaModelRelationshipsDto} gains new lists (frequent in this codebase),
 * only this class needs to be updated rather than every test fixture.
 *
 * <p>Introduced 2026-05-19 during the AMS test-compile rot fix.
 */
public final class TestMetaModelFactory {

    private TestMetaModelFactory() {
        // utility
    }

    /**
     * Returns a fresh {@link MetaModelEntitiesDto} with every list empty.
     * Tracks the current 51-field constructor; mirrors the ordering in
     * {@code MetaModelEntitiesDto} so that tests can simply call this when they
     * do not care about any specific entity list.
     */
    public static MetaModelEntitiesDto emptyEntities() {
        return new MetaModelEntitiesDto(
            List.of(), // 1  businessUsers
            List.of(), // 2  businessProcesses
            List.of(), // 3  processActivities
            List.of(), // 4  businessPoints
            List.of(), // 5  applications
            List.of(), // 6  appComponents
            List.of(), // 7  services
            List.of(), // 8  interfaces
            List.of(), // 9  endpoints
            List.of(), // 10 classes
            List.of(), // 11 methods
            List.of(), // 12 applicationPoints
            List.of(), // 13 logicalDataEntities
            List.of(), // 14 logicalDataAttributes
            List.of(), // 15 physicalDataEntities
            List.of(), // 16 physicalDataAttributes
            List.of(), // 17 dataEntityPoints
            List.of(), // 18 interactions
            List.of(), // 19 appBusinessPoints
            List.of(), // 20 events
            List.of(), // 21 states
            List.of(), // 22 stateTransitions
            List.of(), // 23 activities
            List.of(), // 24 activityFlows
            List.of(), // 25 activityPartitions
            List.of(), // 26 uiScreens
            List.of(), // 27 uiContracts
            List.of(), // 28 uiComponents
            List.of(), // 29 uiActions
            List.of(), // 30 uiCharacteristics
            List.of(), // 31 businessLogics
            List.of(), // 32 packageSets
            List.of(), // 33 packages
            List.of(), // 34 packageSetDefaultRules
            List.of(), // 35 userJourneys
            List.of(), // 36 activitySteps,
            // Infrastructure domain (13 lists)
            List.of(), // 37 environments
            List.of(), // 38 cloudAccounts
            List.of(), // 39 locations
            List.of(), // 40 networks
            List.of(), // 41 subnets
            List.of(), // 42 computeClusters
            List.of(), // 43 computeResources
            List.of(), // 44 deploymentUnits
            List.of(), // 45 loadBalancers
            List.of(), // 46 listeners
            List.of(), // 47 dataStoreInstances
            List.of(), // 48 infrastructureResources
            List.of(), // 49 infrastructurePoints
            List.of(), // 50 iacSources
            List.of()  // 51 libraries
        );
    }

    /**
     * Returns a fresh {@link MetaModelRelationshipsDto} with every list empty.
     * Tracks the current 19-field constructor.
     */
    public static MetaModelRelationshipsDto emptyRelationships() {
        return new MetaModelRelationshipsDto(
            List.of(), // 1  businessUserBusinessPoints
            List.of(), // 2  applicationPointBusinessPoints
            List.of(), // 3  logicalDataEntityRelationships
            List.of(), // 4  logicalDataEntityPhysicalDataEntities
            List.of(), // 5  logicalDataAttributePhysicalDataAttributes
            List.of(), // 6  dataMovements
            List.of(), // 7  interfaceLogicalEntities
            List.of(), // 8  uiWorkflowTransitions
            List.of(), // 9  applicationPointBusinessLogics
            List.of(), // 10 userJourneyLinks
            List.of(), // 11 resourceSubnetHostings
            List.of(), // 12 deploymentUnitComputeResources
            List.of(), // 13 loadBalancerResourceRoutes
            List.of(), // 14 applicationComputeDeployments
            List.of(), // 15 dataEntityDataStoreHostings
            List.of(), // 16 applicationInfrastructureResourceUses
            List.of(), // 17 applicationLoadBalancerExposures
            List.of(), // 18 iacResourceBindings
            List.of()  // 19 codeUnitDependencies
        );
    }
}
