package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.CloudAccountDto;
import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.LocationDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationComputeDeploymentDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationInfrastructureResourceUseDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationLoadBalancerExposureDto;
import com.example.architecturemodel.model.dto.relationship.DataEntityDataStoreHostingDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * Value object carrying loaded model + selection state + pre-built lookup maps
 * passed to every {@link TerraformExporter} emitter method.
 *
 * <p>The lookup maps are built once at context construction so emitters never
 * re-walk the relationship lists.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp
 */
public final class TerraformContext {

    private final MetaModelEntitiesDto entities;
    private final MetaModelRelationshipsDto relationships;
    private final EnvironmentDto selectedEnvironment;
    private final CloudAccountDto selectedCloudAccount;
    private final LocationDto selectedLocation;
    private final String providerId;

    /**
     * IaC resource bindings keyed by {@code infrastructure_point_id}.
     * Drives stable resource naming + type override for any infra entity.
     */
    private final Map<String, IaCResourceBindingDto> bindingsByInfrastructurePointId;

    /**
     * Application Compute Deployments grouped by {@code compute_resource_id}.
     * Drives container / VM image fields on Compute Resource emitters.
     */
    private final Map<String, List<ApplicationComputeDeploymentDto>> deploymentsByComputeResourceId;

    /**
     * Application Load Balancer Exposures grouped by {@code load_balancer_id}.
     * Drives URL-map host/path + listener port/protocol.
     */
    private final Map<String, List<ApplicationLoadBalancerExposureDto>> exposuresByLoadBalancerId;

    /**
     * Data Entity Data Store Hostings grouped by {@code data_store_instance_id}.
     * Documentation-only; drives "Hosts data entity X" comment trail.
     */
    private final Map<String, List<DataEntityDataStoreHostingDto>> hostingsByDataStoreId;

    /**
     * Application Infrastructure Resource Uses grouped by
     * {@code infrastructure_resource_id}. Documentation-only; drives "Used by
     * application Y" comment trail.
     */
    private final Map<String, List<ApplicationInfrastructureResourceUseDto>> usesByInfrastructureResourceId;

    public TerraformContext(
        MetaModelEntitiesDto entities,
        MetaModelRelationshipsDto relationships,
        EnvironmentDto selectedEnvironment,
        CloudAccountDto selectedCloudAccount,
        LocationDto selectedLocation,
        String providerId
    ) {
        this.entities = entities;
        this.relationships = relationships;
        this.selectedEnvironment = Objects.requireNonNull(selectedEnvironment, "selectedEnvironment is required");
        this.selectedCloudAccount = selectedCloudAccount;
        this.selectedLocation = selectedLocation;
        this.providerId = Objects.requireNonNull(providerId, "providerId is required");

        this.bindingsByInfrastructurePointId = buildBindingsMap(relationships);
        this.deploymentsByComputeResourceId = buildDeploymentsMap(relationships);
        this.exposuresByLoadBalancerId = buildExposuresMap(relationships);
        this.hostingsByDataStoreId = buildHostingsMap(relationships);
        this.usesByInfrastructureResourceId = buildUsesMap(relationships);
    }

    public MetaModelEntitiesDto entities() {
        return entities;
    }

    public MetaModelRelationshipsDto relationships() {
        return relationships;
    }

    public EnvironmentDto selectedEnvironment() {
        return selectedEnvironment;
    }

    public CloudAccountDto selectedCloudAccount() {
        return selectedCloudAccount;
    }

    public LocationDto selectedLocation() {
        return selectedLocation;
    }

    public String providerId() {
        return providerId;
    }

    public Map<String, IaCResourceBindingDto> bindingsByInfrastructurePointId() {
        return bindingsByInfrastructurePointId;
    }

    public Map<String, List<ApplicationComputeDeploymentDto>> deploymentsByComputeResourceId() {
        return deploymentsByComputeResourceId;
    }

    public Map<String, List<ApplicationLoadBalancerExposureDto>> exposuresByLoadBalancerId() {
        return exposuresByLoadBalancerId;
    }

    public Map<String, List<DataEntityDataStoreHostingDto>> hostingsByDataStoreId() {
        return hostingsByDataStoreId;
    }

    public Map<String, List<ApplicationInfrastructureResourceUseDto>> usesByInfrastructureResourceId() {
        return usesByInfrastructureResourceId;
    }

    /**
     * Slug helper. Lowercases the input and replaces every run of non
     * lower-alphanumeric characters with a single underscore.
     *
     * <p>Locked contract from the spec.
     */
    public static String slugify(String name) {
        if (name == null) {
            return "";
        }
        return name.toLowerCase().replaceAll("[^a-z0-9]+", "_");
    }

    /**
     * Resolve the Terraform resource address for an entity.
     *
     * <p>If an existing {@link IaCResourceBindingDto} is supplied with a
     * non-blank {@code iac_address}, that is reused verbatim. Otherwise the
     * address is synthesised as {@code <env_slug>_<entity_slug>}.
     */
    public static String resourceAddress(String entityName, String envName, IaCResourceBindingDto existingBinding) {
        if (existingBinding != null) {
            String addr = existingBinding.iacAddress();
            if (addr != null && !addr.isBlank()) {
                return addr;
            }
        }
        return slugify(envName) + "_" + slugify(entityName);
    }

    // ----- private helpers -----

    private static Map<String, IaCResourceBindingDto> buildBindingsMap(MetaModelRelationshipsDto rels) {
        if (rels == null || rels.iacResourceBindings() == null) {
            return Collections.emptyMap();
        }
        // Last-binding-wins (rare; defensive). Preserve insertion order via stream collector.
        Map<String, IaCResourceBindingDto> out = new java.util.LinkedHashMap<>();
        for (IaCResourceBindingDto b : rels.iacResourceBindings()) {
            if (b == null || b.infrastructurePointId() == null) continue;
            out.put(b.infrastructurePointId(), b);
        }
        return Collections.unmodifiableMap(out);
    }

    private static Map<String, List<ApplicationComputeDeploymentDto>> buildDeploymentsMap(MetaModelRelationshipsDto rels) {
        if (rels == null || rels.applicationComputeDeployments() == null) {
            return Collections.emptyMap();
        }
        return groupBy(rels.applicationComputeDeployments(), ApplicationComputeDeploymentDto::computeResourceId);
    }

    private static Map<String, List<ApplicationLoadBalancerExposureDto>> buildExposuresMap(MetaModelRelationshipsDto rels) {
        if (rels == null || rels.applicationLoadBalancerExposures() == null) {
            return Collections.emptyMap();
        }
        return groupBy(rels.applicationLoadBalancerExposures(), ApplicationLoadBalancerExposureDto::loadBalancerId);
    }

    private static Map<String, List<DataEntityDataStoreHostingDto>> buildHostingsMap(MetaModelRelationshipsDto rels) {
        if (rels == null || rels.dataEntityDataStoreHostings() == null) {
            return Collections.emptyMap();
        }
        return groupBy(rels.dataEntityDataStoreHostings(), DataEntityDataStoreHostingDto::dataStoreInstanceId);
    }

    private static Map<String, List<ApplicationInfrastructureResourceUseDto>> buildUsesMap(MetaModelRelationshipsDto rels) {
        if (rels == null || rels.applicationInfrastructureResourceUses() == null) {
            return Collections.emptyMap();
        }
        return groupBy(rels.applicationInfrastructureResourceUses(), ApplicationInfrastructureResourceUseDto::infrastructureResourceId);
    }

    private static <T> Map<String, List<T>> groupBy(List<T> items, java.util.function.Function<T, String> keyFn) {
        Map<String, List<T>> out = new java.util.LinkedHashMap<>();
        for (T item : items) {
            if (item == null) continue;
            String k = keyFn.apply(item);
            if (k == null) continue;
            out.computeIfAbsent(k, x -> new ArrayList<>()).add(item);
        }
        Map<String, List<T>> immutable = new java.util.LinkedHashMap<>();
        for (Map.Entry<String, List<T>> e : out.entrySet()) {
            immutable.put(e.getKey(), Collections.unmodifiableList(e.getValue()));
        }
        return Collections.unmodifiableMap(immutable);
    }
}
