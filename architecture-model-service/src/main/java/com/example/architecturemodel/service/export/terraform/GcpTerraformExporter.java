package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.entity.CloudAccountDto;
import com.example.architecturemodel.model.dto.entity.ComputeClusterDto;
import com.example.architecturemodel.model.dto.entity.ComputeResourceDto;
import com.example.architecturemodel.model.dto.entity.DataStoreInstanceDto;
import com.example.architecturemodel.model.dto.entity.DeploymentUnitDto;
import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.entity.InfrastructurePointDto;
import com.example.architecturemodel.model.dto.entity.InfrastructureResourceDto;
import com.example.architecturemodel.model.dto.entity.ListenerDto;
import com.example.architecturemodel.model.dto.entity.LoadBalancerDto;
import com.example.architecturemodel.model.dto.entity.LocationDto;
import com.example.architecturemodel.model.dto.entity.NetworkDto;
import com.example.architecturemodel.model.dto.entity.ServiceDto;
import com.example.architecturemodel.model.dto.entity.SubnetDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationComputeDeploymentDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationInfrastructureResourceUseDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationLoadBalancerExposureDto;
import com.example.architecturemodel.model.dto.relationship.DataEntityDataStoreHostingDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import com.example.architecturemodel.model.dto.relationship.LoadBalancerResourceRouteDto;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * GCP implementation of {@link TerraformExporter}.
 *
 * <p>Each emitter is a hand-rolled string-fragment builder honouring the
 * locked contract:
 * <ul>
 *   <li>standard block headers ({@code # Infrastructure concept: ...},
 *       {@code # Architecture entity: ...}, {@code # Environment: ...})</li>
 *   <li>resource-type override hierarchy
 *       ({@code terraform_resource_hint} > {@code iac_resource_bindings.iac_resource_type}
 *       > default GCP mapping)</li>
 *   <li>resource address reuse via
 *       {@link TerraformContext#resourceAddress(String, String, IaCResourceBindingDto)}</li>
 *   <li>{@code terraform_module_hint} comment-only (no module split V1)</li>
 *   <li>{@code terraform_notes} appended verbatim under the headers</li>
 *   <li>{@code terraform_ready == false} produces a TODO scaffold</li>
 *   <li>soft-warns surface in BOTH inline {@code # TODO} comments AND
 *       {@link EmittedResource#warnings()}</li>
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp
 */
@Service
public class GcpTerraformExporter implements TerraformExporter {

    private static final String PROVIDER_ID = "GCP";

    private static final String FILE_MAIN = "main.tf";
    private static final String FILE_VARIABLES = "variables.tf";
    private static final String FILE_OUTPUTS = "outputs.tf";
    private static final String FILE_README = "README.md";

    @Override
    public String providerId() {
        return PROVIDER_ID;
    }

    // ========================================================================
    // Group 2 -- simpler emitters (no cross-domain resolution)
    // ========================================================================

    @Override
    public List<EmittedResource> exportEnvironment(EnvironmentDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = entity.name();
        String envSlug = TerraformContext.slugify(envName);
        String concept = "Environment";

        List<String> headers = standardHeaders(concept, envName, envName, entity.id());
        List<String> warnings = new ArrayList<>();

        // README block describing what carries the label.
        String readmeSection = String.join("\n",
            "## Environment",
            "",
            "All resources emitted in this export carry the label `environment = var.environment`.",
            "Default: `\"" + envSlug + "\"` (derived from the selected Environment entity).",
            ""
        );

        EmittedResource readme = new EmittedResource(
            FILE_README,
            readmeSection,
            headers,
            List.of()
        );

        // variable "environment" block.
        String varBlock = ""
            + "variable \"environment\" {\n"
            + "  description = \"Environment name (e.g. dev, prod)\"\n"
            + "  type        = string\n"
            + "  default     = \"" + envSlug + "\"\n"
            + "}\n";

        EmittedResource var = new EmittedResource(
            FILE_VARIABLES,
            varBlock,
            headers,
            List.of()
        );

        // Locals block in main.tf documenting standard labels.
        String localsBlock = ""
            + "locals {\n"
            + "  common_labels = {\n"
            + "    environment = var.environment\n"
            + "  }\n"
            + "}\n";

        List<String> mainComments = new ArrayList<>(headers);
        appendNotesAndModuleHint(mainComments, entity.terraformNotes(), entity.terraformModuleHint());

        if (Boolean.FALSE.equals(entity.terraformReady())) {
            String todo = todoLine("terraform_ready=false", concept, envName, entity.id());
            mainComments.add(todo);
            warnings.add(todo);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            localsBlock,
            mainComments,
            warnings
        );

        return List.of(main, var, readme);
    }

    @Override
    public List<EmittedResource> exportCloudAccount(CloudAccountDto entity, TerraformContext ctx) {
        String envName = ctx.selectedEnvironment().name();
        String concept = "Cloud Account";
        String entityName = entity != null ? entity.name() : "(missing)";
        String entityId = entity != null ? entity.id() : null;

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        if (entity == null) {
            String todo = "# TODO: missing cloud_account; falling back to var.project_id placeholder. Source: " + concept + " '(none selected)'.";
            comments.add(todo);
            warnings.add(todo);
        } else {
            appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());
            if (Boolean.FALSE.equals(entity.terraformReady())) {
                String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
                comments.add(todo);
                warnings.add(todo);
            }
        }

        // Soft-warn if multiple cloud accounts exist in the model.
        if (ctx.entities() != null && ctx.entities().cloudAccounts() != null
            && ctx.entities().cloudAccounts().size() > 1) {
            String w = "# TODO: multiple cloud_accounts present; provider block uses var.project_id only. Source: " + concept + " '" + entityName + "'.";
            comments.add(w);
            warnings.add(w);
        }

        // provider "google" block in main.tf.
        StringBuilder provider = new StringBuilder();
        provider.append("provider \"google\" {\n");
        provider.append("  project = var.project_id\n");
        if (ctx.selectedLocation() != null) {
            provider.append("  region  = var.region\n");
            if (ctx.selectedLocation().providerZoneCode() != null && !ctx.selectedLocation().providerZoneCode().isBlank()) {
                provider.append("  zone    = var.zone\n");
            }
        }
        provider.append("}\n");

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            provider.toString(),
            comments,
            warnings
        );

        // var "project_id" block.
        String defaultProject = entity != null && entity.externalAccountId() != null && !entity.externalAccountId().isBlank()
            ? entity.externalAccountId()
            : "REPLACE_ME";
        String varBlock = ""
            + "variable \"project_id\" {\n"
            + "  description = \"GCP project id\"\n"
            + "  type        = string\n"
            + "  default     = \"" + defaultProject + "\"\n"
            + "}\n";

        EmittedResource var = new EmittedResource(
            FILE_VARIABLES,
            varBlock,
            headers,
            List.of()
        );

        return List.of(main, var);
    }

    @Override
    public List<EmittedResource> exportLocation(LocationDto entity, TerraformContext ctx) {
        String envName = ctx.selectedEnvironment().name();
        String concept = "Location";
        String entityName = entity != null ? entity.name() : "(missing)";
        String entityId = entity != null ? entity.id() : null;

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        String regionDefault = "europe-west1";
        String zoneDefault = "europe-west1-b";
        boolean emitZone = false;

        if (entity == null) {
            String todo = "# TODO: missing location; defaulting var.region to placeholder. Source: " + concept + " '(none selected)'.";
            comments.add(todo);
            warnings.add(todo);
        } else {
            if (entity.providerRegionCode() != null && !entity.providerRegionCode().isBlank()) {
                regionDefault = entity.providerRegionCode();
            }
            if (entity.providerZoneCode() != null && !entity.providerZoneCode().isBlank()) {
                zoneDefault = entity.providerZoneCode();
                emitZone = true;
            }
            appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());
            if (Boolean.FALSE.equals(entity.terraformReady())) {
                String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
                comments.add(todo);
                warnings.add(todo);
            }
        }

        StringBuilder vars = new StringBuilder();
        vars.append("variable \"region\" {\n")
            .append("  description = \"GCP region\"\n")
            .append("  type        = string\n")
            .append("  default     = \"").append(regionDefault).append("\"\n")
            .append("}\n");
        if (emitZone) {
            vars.append("\n")
                .append("variable \"zone\" {\n")
                .append("  description = \"GCP zone\"\n")
                .append("  type        = string\n")
                .append("  default     = \"").append(zoneDefault).append("\"\n")
                .append("}\n");
        }

        EmittedResource var = new EmittedResource(
            FILE_VARIABLES,
            vars.toString(),
            comments,
            warnings
        );

        return List.of(var);
    }

    @Override
    public List<EmittedResource> exportNetwork(NetworkDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Network";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "NETWORK", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        String resourceType = resolveResourceType("google_compute_network", entity.terraformResourceHint(), binding);

        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());

        boolean unsupported = entity.networkType() != null
            && !entity.networkType().isBlank()
            && !isGcpCompatibleNetwork(entity.networkType());
        if (unsupported) {
            String todo = todoLine("network_type='" + entity.networkType() + "' not GCP-compatible", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());
        if (readyFalse) {
            String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        StringBuilder block = new StringBuilder();
        block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
        block.append("  name                    = \"").append(slugifyForName(entityName)).append("\"\n");
        if (entity.routingMode() != null && !entity.routingMode().isBlank()) {
            block.append("  routing_mode            = \"").append(entity.routingMode()).append("\"\n");
        }
        block.append("  auto_create_subnetworks = false\n");
        if (readyFalse || unsupported) {
            block.append("  # TODO: complete required fields above before apply.\n");
        }
        block.append("}\n");

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    @Override
    public List<EmittedResource> exportSubnet(SubnetDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Subnet";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "SUBNET", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        String resourceType = resolveResourceType("google_compute_subnetwork", entity.terraformResourceHint(), binding);

        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());

        boolean missingCidr = entity.cidr() == null || entity.cidr().isBlank();
        if (missingCidr) {
            String todo = todoLine("missing CIDR", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }
        boolean missingRegion = entity.providerRegionCode() == null || entity.providerRegionCode().isBlank();
        if (missingRegion && (ctx.selectedLocation() == null || ctx.selectedLocation().providerRegionCode() == null)) {
            String todo = todoLine("missing region", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());
        if (readyFalse) {
            String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        // Resolve parent network reference.
        String parentNetworkRef = resolveParentNetworkRef(entity, ctx);

        StringBuilder block = new StringBuilder();
        block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
        block.append("  name          = \"").append(slugifyForName(entityName)).append("\"\n");
        if (!missingCidr) {
            block.append("  ip_cidr_range = \"").append(entity.cidr()).append("\"\n");
        } else {
            block.append("  # ip_cidr_range = \"REPLACE_ME\"\n");
        }
        block.append("  region        = ").append(missingRegion ? "var.region" : "\"" + entity.providerRegionCode() + "\"").append("\n");
        block.append("  network       = ").append(parentNetworkRef).append("\n");
        if (readyFalse || missingCidr || missingRegion) {
            block.append("  # TODO: complete required fields above before apply.\n");
        }
        block.append("}\n");

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    // ========================================================================
    // Group 3 -- compute-domain emitters (cross-domain resolution)
    // ========================================================================

    @Override
    public List<EmittedResource> exportComputeCluster(ComputeClusterDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Compute Cluster";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "COMPUTE_CLUSTER", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());

        String platformType = entity.platformType() == null ? "" : entity.platformType().toUpperCase();
        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());

        StringBuilder block = new StringBuilder();

        if (platformType.equals("KUBERNETES") || platformType.equals("GKE")) {
            String resourceType = resolveResourceType("google_container_cluster", entity.terraformResourceHint(), binding);
            block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
            block.append("  name     = \"").append(slugifyForName(entityName)).append("\"\n");
            block.append("  location = var.region\n");
            if (entity.version() != null && !entity.version().isBlank()) {
                block.append("  min_master_version = \"").append(entity.version()).append("\"\n");
            }
            block.append("  remove_default_node_pool = true\n");
            block.append("  initial_node_count       = 1\n");
            if (readyFalse) {
                block.append("  # TODO: terraform_ready=false; review fields before apply.\n");
            }
            block.append("}\n");
            block.append("\n");
            block.append("# TODO: configure google_container_node_pool for cluster '").append(entityName).append("'. Source: ").append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
            block.append("resource \"google_container_node_pool\" \"").append(address).append("_default_pool\" {\n");
            block.append("  name       = \"default-pool\"\n");
            block.append("  cluster    = ").append(resourceType).append(".").append(address).append(".name\n");
            block.append("  location   = var.region\n");
            block.append("  node_count = 1\n");
            block.append("  # TODO: complete node_config block before apply.\n");
            block.append("}\n");
            String todo = todoLine("node-pool fields require completion", concept, entityName, entityId);
            warnings.add(todo);
            if (readyFalse) {
                String t = todoLine("terraform_ready=false", concept, entityName, entityId);
                warnings.add(t);
            }
        } else if (platformType.equals("CLOUD_RUN")) {
            // No standalone resource; documentation-only block.
            block.append("# Cloud Run cluster: ").append(entityName).append(" -- implicit, see Compute Resource blocks for service definitions.\n");
        } else {
            String todo = todoLine("unsupported platform_type='" + entity.platformType() + "'", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
            String resourceType = resolveResourceType("google_container_cluster", entity.terraformResourceHint(), binding);
            block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
            block.append("  # TODO: unsupported platform_type='").append(entity.platformType()).append("'; complete or replace before apply.\n");
            block.append("  name = \"").append(slugifyForName(entityName)).append("\"\n");
            block.append("}\n");
        }

        if (readyFalse && !platformType.equals("CLOUD_RUN")) {
            String t = todoLine("terraform_ready=false", concept, entityName, entityId);
            comments.add(t);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    @Override
    public List<EmittedResource> exportComputeResource(ComputeResourceDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Compute Resource";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "COMPUTE_RESOURCE", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());

        String computeType = entity.computeType() == null ? "" : entity.computeType().toUpperCase();
        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());

        // Cross-domain: application_compute_deployments grouped by compute_resource_id.
        List<ApplicationComputeDeploymentDto> deployments = ctx.deploymentsByComputeResourceId().getOrDefault(entityId, List.of());
        if (deployments.size() > 1) {
            String todo = todoLine(
                "ambiguous DU->CR mapping; expected 1, found " + deployments.size() + "; using first by name",
                concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        // Comment trail per Deployment Unit.
        DeploymentUnitDto resolvedDu = null;
        for (ApplicationComputeDeploymentDto d : deployments) {
            DeploymentUnitDto du = findDeploymentUnit(ctx, d.deploymentUnitId());
            if (du != null) {
                String trail = "# Deployed by: " + du.name() + " (id: " + du.id() + ") -- image/artifact/version: "
                    + nullToDash(du.imageName()) + ":" + nullToDash(du.imageTag()) + " / "
                    + nullToDash(du.artifactUri()) + " / " + nullToDash(du.version());
                comments.add(trail);
                if (resolvedDu == null) {
                    resolvedDu = du;
                }
            }
        }

        StringBuilder block = new StringBuilder();

        if (computeType.equals("VM") || computeType.equals("GCE")) {
            String resourceType = resolveResourceType("google_compute_instance", entity.terraformResourceHint(), binding);
            block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
            block.append("  name         = \"").append(slugifyForName(entityName)).append("\"\n");
            block.append("  machine_type = \"").append(entity.instanceSize() != null && !entity.instanceSize().isBlank() ? entity.instanceSize() : "e2-medium").append("\"\n");
            block.append("  zone         = var.zone\n");
            block.append("  boot_disk {\n");
            block.append("    initialize_params {\n");
            String image = resolveBootDiskImage(resolvedDu);
            block.append("      image = \"").append(image).append("\"\n");
            block.append("    }\n");
            block.append("  }\n");
            block.append("  network_interface {\n");
            block.append("    network = \"default\"\n");
            block.append("    # TODO: bind to project subnet; see Subnet entities.\n");
            block.append("  }\n");
            if (readyFalse) {
                block.append("  # TODO: terraform_ready=false; review fields before apply.\n");
            }
            block.append("}\n");
            if (image.equals("REPLACE_ME")) {
                String todo = todoLine("missing boot disk image (no application_compute_deployments match)", concept, entityName, entityId);
                warnings.add(todo);
            }
        } else if (computeType.equals("CLOUD_RUN_SERVICE") || computeType.equals("CLOUD_RUN")) {
            String resourceType = resolveResourceType("google_cloud_run_v2_service", entity.terraformResourceHint(), binding);
            block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
            block.append("  name     = \"").append(slugifyForName(entityName)).append("\"\n");
            block.append("  location = var.region\n");
            block.append("  template {\n");
            block.append("    containers {\n");
            String image = resolveCloudRunImage(resolvedDu);
            block.append("      image = \"").append(image).append("\"\n");
            block.append("    }\n");
            block.append("  }\n");
            if (readyFalse) {
                block.append("  # TODO: terraform_ready=false; review fields before apply.\n");
            }
            block.append("}\n");
            if (image.equals("REPLACE_ME")) {
                String todo = todoLine("missing container image (no application_compute_deployments match)", concept, entityName, entityId);
                warnings.add(todo);
            }
        } else if (computeType.equals("KUBERNETES_WORKLOAD")) {
            String todo = todoLine("KUBERNETES_WORKLOAD compute_type out of V1 scope", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
            block.append("# TODO: KUBERNETES_WORKLOAD compute resources not emitted in V1. Source: ")
                .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
        } else {
            String todo = todoLine("unsupported compute_type='" + entity.computeType() + "'", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
            block.append("# TODO: unsupported compute_type='").append(entity.computeType()).append("'. Source: ")
                .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
        }

        if (readyFalse) {
            String t = todoLine("terraform_ready=false", concept, entityName, entityId);
            // already in block as an inline comment; surface in warnings list as well.
            warnings.add(t);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    @Override
    public List<EmittedResource> exportDeploymentUnit(DeploymentUnitDto entity, TerraformContext ctx) {
        // No standalone Terraform resource. Image / artifact / version flows
        // into target Compute Resource via application_compute_deployments.
        // Method intentionally returns an empty list.
        return List.of();
    }

    // ========================================================================
    // Group 4 -- remaining emitters
    // ========================================================================

    @Override
    public List<EmittedResource> exportLoadBalancer(LoadBalancerDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Load Balancer";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "LOAD_BALANCER", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());
        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());

        boolean useHttps = isHttpsLoadBalancer(entity);
        String proxyType = useHttps ? "google_compute_target_https_proxy" : "google_compute_target_http_proxy";

        // Resolve route targets to detect Cloud Run backends.
        boolean hasCloudRunTarget = false;
        if (ctx.relationships() != null && ctx.relationships().loadBalancerResourceRoutes() != null) {
            for (LoadBalancerResourceRouteDto route : ctx.relationships().loadBalancerResourceRoutes()) {
                if (route == null || route.loadBalancerId() == null) continue;
                if (!entityId.equals(route.loadBalancerId())) continue;
                ComputeResourceDto cr = findComputeResourceByPointId(ctx, route.targetInfrastructurePointId());
                if (cr != null && cr.computeType() != null && cr.computeType().toUpperCase().startsWith("CLOUD_RUN")) {
                    hasCloudRunTarget = true;
                    break;
                }
            }
        }

        StringBuilder block = new StringBuilder();

        // backend_service
        block.append("resource \"google_compute_backend_service\" \"").append(address).append("_backend\" {\n");
        block.append("  name                  = \"").append(slugifyForName(entityName)).append("-backend\"\n");
        block.append("  load_balancing_scheme = \"EXTERNAL\"\n");
        block.append("  protocol              = \"").append(useHttps ? "HTTPS" : "HTTP").append("\"\n");
        if (hasCloudRunTarget) {
            block.append("  backend {\n");
            block.append("    group = google_compute_region_network_endpoint_group.").append(address).append("_neg.id\n");
            block.append("  }\n");
        } else {
            block.append("  # TODO: bind backend to a managed instance group or NEG.\n");
        }
        block.append("}\n\n");

        // url_map
        block.append("resource \"google_compute_url_map\" \"").append(address).append("_urlmap\" {\n");
        block.append("  name            = \"").append(slugifyForName(entityName)).append("-urlmap\"\n");
        block.append("  default_service = google_compute_backend_service.").append(address).append("_backend.id\n");

        // Drive host/path rules from application_load_balancer_exposures.
        List<ApplicationLoadBalancerExposureDto> exposures = ctx.exposuresByLoadBalancerId().getOrDefault(entityId, List.of());
        for (ApplicationLoadBalancerExposureDto exp : exposures) {
            if (exp.hostName() != null && !exp.hostName().isBlank()) {
                block.append("  host_rule {\n");
                block.append("    hosts        = [\"").append(exp.hostName()).append("\"]\n");
                block.append("    path_matcher = \"").append(slugifyForName(exp.hostName())).append("-matcher\"\n");
                block.append("  }\n");
                block.append("  path_matcher {\n");
                block.append("    name            = \"").append(slugifyForName(exp.hostName())).append("-matcher\"\n");
                block.append("    default_service = google_compute_backend_service.").append(address).append("_backend.id\n");
                if (exp.pathPattern() != null && !exp.pathPattern().isBlank()) {
                    block.append("    path_rule {\n");
                    block.append("      paths   = [\"").append(exp.pathPattern()).append("\"]\n");
                    block.append("      service = google_compute_backend_service.").append(address).append("_backend.id\n");
                    block.append("    }\n");
                }
                block.append("  }\n");
            }
        }
        block.append("}\n\n");

        // target_http(s)_proxy
        block.append("resource \"").append(proxyType).append("\" \"").append(address).append("_proxy\" {\n");
        block.append("  name    = \"").append(slugifyForName(entityName)).append("-proxy\"\n");
        block.append("  url_map = google_compute_url_map.").append(address).append("_urlmap.id\n");
        if (useHttps) {
            block.append("  # TODO: bind ssl_certificates list. Source: ").append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
            block.append("  ssl_certificates = []\n");
        }
        block.append("}\n\n");

        // global_forwarding_rule
        block.append("resource \"google_compute_global_forwarding_rule\" \"").append(address).append("_fwd\" {\n");
        block.append("  name       = \"").append(slugifyForName(entityName)).append("-fwd\"\n");
        block.append("  target     = ").append(proxyType).append(".").append(address).append("_proxy.id\n");
        block.append("  port_range = \"").append(useHttps ? "443" : "80").append("\"\n");
        block.append("}\n");

        if (hasCloudRunTarget) {
            block.append("\n");
            block.append("resource \"google_compute_region_network_endpoint_group\" \"").append(address).append("_neg\" {\n");
            block.append("  name                  = \"").append(slugifyForName(entityName)).append("-neg\"\n");
            block.append("  region                = var.region\n");
            block.append("  network_endpoint_type = \"SERVERLESS\"\n");
            block.append("  # TODO: configure cloud_run.service to point at the target Cloud Run service.\n");
            block.append("}\n");
        }

        if (readyFalse) {
            String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }
        if (!hasCloudRunTarget) {
            String todo = todoLine("backend resolution incomplete (no Cloud Run target detected; review load_balancer_resource_routes)", concept, entityName, entityId);
            warnings.add(todo);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    @Override
    public List<EmittedResource> exportListener(ListenerDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Listener";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());
        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());

        // Resolve parent LB.
        LoadBalancerDto parent = findLoadBalancer(ctx, entity.loadBalancerId());

        StringBuilder block = new StringBuilder();
        if (parent == null) {
            String todo = todoLine("parent load_balancer_id unresolved", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
            block.append("# TODO: configure URL-map rule -- parent Load Balancer unresolved. Source: ")
                .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
        } else {
            // Listener contributes inside the parent LB's URL map. Emit a
            // documentation-only comment block describing the contribution.
            block.append("# Listener contribution to Load Balancer '").append(parent.name()).append("' (id: ").append(parent.id()).append("):\n");
            if (entity.protocol() != null) {
                block.append("#   protocol = ").append(entity.protocol()).append("\n");
            }
            if (entity.port() != null) {
                block.append("#   port = ").append(entity.port()).append("\n");
            }
            if (entity.hostName() != null && !entity.hostName().isBlank()) {
                block.append("#   host_name = ").append(entity.hostName()).append("\n");
            }
            if (entity.pathPattern() != null && !entity.pathPattern().isBlank()) {
                block.append("#   path_pattern = ").append(entity.pathPattern()).append("\n");
            }
            if (entity.exposure() != null) {
                block.append("#   exposure = ").append(entity.exposure()).append("\n");
            }
            if (entity.certificateReference() != null && !entity.certificateReference().isBlank()) {
                block.append("#   certificate_reference = ").append(entity.certificateReference()).append("\n");
            }
        }

        if (readyFalse) {
            String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    @Override
    public List<EmittedResource> exportDataStoreInstance(DataStoreInstanceDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Data Store Instance";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "DATA_STORE_INSTANCE", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());
        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());

        // Comment trail from data_entity_data_store_hostings.
        List<DataEntityDataStoreHostingDto> hostings = ctx.hostingsByDataStoreId().getOrDefault(entityId, List.of());
        for (DataEntityDataStoreHostingDto h : hostings) {
            String trail = "# Hosts data entity (id: " + nullToDash(h.dataEntityPointId()) + ")"
                + (h.databaseName() != null ? " in database '" + h.databaseName() + "'" : "");
            comments.add(trail);
        }

        String engine = entity.engine() == null ? "" : entity.engine().toUpperCase();
        StringBuilder block = new StringBuilder();

        if (engine.equals("POSTGRES") || engine.equals("POSTGRESQL") || engine.equals("MYSQL") || engine.equals("SQLSERVER")) {
            String resourceType = resolveResourceType("google_sql_database_instance", entity.terraformResourceHint(), binding);
            block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
            block.append("  name             = \"").append(slugifyForName(entityName)).append("\"\n");
            block.append("  database_version = \"").append(mapSqlVersion(engine, entity.engineVersion())).append("\"\n");
            block.append("  region           = var.region\n");
            block.append("  settings {\n");
            block.append("    tier = \"db-f1-micro\"\n");
            block.append("  }\n");
            if (readyFalse) {
                block.append("  # TODO: terraform_ready=false; review fields before apply.\n");
            }
            block.append("}\n");
            // Optional google_sql_database from hostings.
            for (DataEntityDataStoreHostingDto h : hostings) {
                if (h.databaseName() != null && !h.databaseName().isBlank()) {
                    block.append("\n");
                    block.append("resource \"google_sql_database\" \"").append(address).append("_").append(TerraformContext.slugify(h.databaseName())).append("\" {\n");
                    block.append("  name     = \"").append(h.databaseName()).append("\"\n");
                    block.append("  instance = ").append(resourceType).append(".").append(address).append(".name\n");
                    block.append("}\n");
                    break; // emit one as illustrative
                }
            }
        } else if (engine.equals("REDIS")) {
            String resourceType = resolveResourceType("google_redis_instance", entity.terraformResourceHint(), binding);
            block.append("resource \"").append(resourceType).append("\" \"").append(address).append("\" {\n");
            block.append("  name           = \"").append(slugifyForName(entityName)).append("\"\n");
            block.append("  tier           = \"BASIC\"\n");
            block.append("  memory_size_gb = 1\n");
            block.append("  region         = var.region\n");
            if (readyFalse) {
                block.append("  # TODO: terraform_ready=false; review fields before apply.\n");
            }
            block.append("}\n");
        } else {
            String todo = todoLine("unsupported engine='" + entity.engine() + "'", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
            block.append("# TODO: unsupported engine='").append(entity.engine()).append("'. Source: ")
                .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
        }

        if (readyFalse) {
            String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
            warnings.add(todo);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    @Override
    public List<EmittedResource> exportInfrastructureResource(InfrastructureResourceDto entity, TerraformContext ctx) {
        if (entity == null) {
            return List.of();
        }
        String envName = ctx.selectedEnvironment().name();
        String concept = "Infrastructure Resource";
        String entityName = entity.name();
        String entityId = entity.id();

        List<String> headers = standardHeaders(concept, entityName, envName, entityId);
        List<String> warnings = new ArrayList<>();
        List<String> comments = new ArrayList<>(headers);

        IaCResourceBindingDto binding = ctx.bindingsByInfrastructurePointId().values().stream()
            .filter(b -> matchesPointEntity(b, ctx, "INFRASTRUCTURE_RESOURCE", entityId))
            .findFirst()
            .orElse(null);

        String address = TerraformContext.resourceAddress(entityName, envName, binding);
        appendNotesAndModuleHint(comments, entity.terraformNotes(), entity.terraformModuleHint());
        boolean readyFalse = Boolean.FALSE.equals(entity.terraformReady());

        // Comment trail from application_infrastructure_resource_uses.
        List<ApplicationInfrastructureResourceUseDto> uses = ctx.usesByInfrastructureResourceId().getOrDefault(entityId, List.of());
        for (ApplicationInfrastructureResourceUseDto u : uses) {
            String trail = "# Used by application (point id: " + nullToDash(u.applicationPointId()) + ")"
                + (u.dependencyType() != null ? " as " + u.dependencyType() : "");
            comments.add(trail);
        }

        String resourceType = entity.resourceType() == null ? "" : entity.resourceType().toUpperCase();
        StringBuilder block = new StringBuilder();

        switch (resourceType) {
            case "OBJECT_BUCKET" -> {
                String tf = resolveResourceType("google_storage_bucket", entity.terraformResourceHint(), binding);
                block.append("resource \"").append(tf).append("\" \"").append(address).append("\" {\n");
                block.append("  name     = \"").append(slugifyForName(entityName)).append("\"\n");
                block.append("  location = var.region\n");
                block.append("  uniform_bucket_level_access = true\n");
                block.append("}\n");
            }
            case "MESSAGE_TOPIC" -> {
                String tf = resolveResourceType("google_pubsub_topic", entity.terraformResourceHint(), binding);
                block.append("resource \"").append(tf).append("\" \"").append(address).append("\" {\n");
                block.append("  name = \"").append(slugifyForName(entityName)).append("\"\n");
                block.append("}\n");
            }
            case "MESSAGE_QUEUE" -> {
                String tf = resolveResourceType("google_pubsub_subscription", entity.terraformResourceHint(), binding);
                block.append("resource \"").append(tf).append("\" \"").append(address).append("\" {\n");
                block.append("  name  = \"").append(slugifyForName(entityName)).append("\"\n");
                block.append("  # TODO: bind 'topic' to a google_pubsub_topic. Source: ")
                    .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
                block.append("  topic = \"REPLACE_ME\"\n");
                block.append("}\n");
            }
            case "CACHE" -> {
                if (cacheDedupeAgainstDataStore(entity, ctx)) {
                    block.append("# Dedupe: see google_redis_instance.").append(address)
                        .append(" on Data Store Instance with the same source_reference; no duplicate emitted.\n");
                    String note = "# Dedupe note for Infrastructure Resource '" + entityName + "' (id: " + entityId + "): mirrored on Data Store Instance.";
                    comments.add(note);
                } else {
                    String tf = resolveResourceType("google_redis_instance", entity.terraformResourceHint(), binding);
                    block.append("resource \"").append(tf).append("\" \"").append(address).append("\" {\n");
                    block.append("  name           = \"").append(slugifyForName(entityName)).append("\"\n");
                    block.append("  tier           = \"BASIC\"\n");
                    block.append("  memory_size_gb = 1\n");
                    block.append("  region         = var.region\n");
                    block.append("}\n");
                }
            }
            case "SECRET_STORE" -> {
                String tf = resolveResourceType("google_secret_manager_secret", entity.terraformResourceHint(), binding);
                block.append("resource \"").append(tf).append("\" \"").append(address).append("\" {\n");
                block.append("  secret_id = \"").append(slugifyForName(entityName)).append("\"\n");
                block.append("  replication {\n");
                block.append("    auto {}\n");
                block.append("  }\n");
                block.append("  # NOTE: secret values are NEVER emitted by this export. Manage via google_secret_manager_secret_version separately.\n");
                block.append("}\n");
            }
            case "SCHEDULER" -> {
                String tf = resolveResourceType("google_cloud_scheduler_job", entity.terraformResourceHint(), binding);
                block.append("resource \"").append(tf).append("\" \"").append(address).append("\" {\n");
                block.append("  name     = \"").append(slugifyForName(entityName)).append("\"\n");
                block.append("  schedule = \"0 * * * *\"\n");
                block.append("  # TODO: configure target (http_target / pubsub_target). Source: ")
                    .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
                block.append("}\n");
            }
            default -> {
                String todo = todoLine("unsupported resource_type='" + entity.resourceType() + "'", concept, entityName, entityId);
                comments.add(todo);
                warnings.add(todo);
                block.append("# TODO: unsupported resource_type='").append(entity.resourceType()).append("'. Source: ")
                    .append(concept).append(" '").append(entityName).append("' (id: ").append(entityId).append(").\n");
            }
        }

        if (readyFalse) {
            String todo = todoLine("terraform_ready=false", concept, entityName, entityId);
            comments.add(todo);
            warnings.add(todo);
        }

        EmittedResource main = new EmittedResource(
            FILE_MAIN,
            block.toString(),
            comments,
            warnings
        );

        return List.of(main);
    }

    // ========================================================================
    // Internal helpers
    // ========================================================================

    private static List<String> standardHeaders(String concept, String entityName, String envName, String entityId) {
        List<String> headers = new ArrayList<>();
        headers.add("# Infrastructure concept: " + concept);
        headers.add("# Architecture entity: " + (entityName == null ? "(unnamed)" : entityName));
        headers.add("# Environment: " + (envName == null ? "(unnamed)" : envName));
        if (entityId != null && !entityId.isBlank()) {
            headers.add("# Source model id: " + entityId);
        }
        return headers;
    }

    private static void appendNotesAndModuleHint(List<String> comments, String terraformNotes, String terraformModuleHint) {
        if (terraformNotes != null && !terraformNotes.isBlank()) {
            for (String line : terraformNotes.split("\\R")) {
                comments.add("# " + line);
            }
        }
        if (terraformModuleHint != null && !terraformModuleHint.isBlank()) {
            comments.add("# Module hint: " + terraformModuleHint);
        }
    }

    private static String todoLine(String reason, String concept, String entityName, String entityId) {
        return "# TODO: " + reason + ". Source: " + concept + " '" + entityName + "' (id: " + entityId + ").";
    }

    /**
     * Resource-type override hierarchy:
     * {@code terraform_resource_hint} > {@code iac_resource_bindings.iac_resource_type}
     * > default GCP mapping.
     */
    private static String resolveResourceType(String defaultType, String terraformResourceHint, IaCResourceBindingDto binding) {
        if (terraformResourceHint != null && !terraformResourceHint.isBlank()) {
            return terraformResourceHint;
        }
        if (binding != null && binding.iacResourceType() != null && !binding.iacResourceType().isBlank()) {
            return binding.iacResourceType();
        }
        return defaultType;
    }

    private static boolean isGcpCompatibleNetwork(String networkType) {
        if (networkType == null) return true;
        String t = networkType.toUpperCase();
        return t.equals("VPC") || t.equals("GCP_VPC") || t.equals("VIRTUAL_NETWORK") || t.equals("CLOUD_VPC");
    }

    private static String slugifyForName(String name) {
        if (name == null || name.isBlank()) return "unnamed";
        return name.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
    }

    private static String nullToDash(String s) {
        return (s == null || s.isBlank()) ? "-" : s;
    }

    private static boolean matchesPointEntity(IaCResourceBindingDto binding, TerraformContext ctx, String pointKind, String entityId) {
        if (binding == null || binding.infrastructurePointId() == null || entityId == null) return false;
        if (ctx.entities() == null || ctx.entities().infrastructurePoints() == null) return false;
        for (InfrastructurePointDto p : ctx.entities().infrastructurePoints()) {
            if (p == null) continue;
            if (!binding.infrastructurePointId().equals(p.id())) continue;
            if (p.pointKind() != null && !p.pointKind().equalsIgnoreCase(pointKind)) return false;
            return entityId.equals(getPointEntityId(p, pointKind));
        }
        return false;
    }

    private static String getPointEntityId(InfrastructurePointDto p, String pointKind) {
        return switch (pointKind.toUpperCase()) {
            case "ENVIRONMENT" -> p.environmentId();
            case "CLOUD_ACCOUNT" -> p.cloudAccountId();
            case "LOCATION" -> p.locationId();
            case "NETWORK" -> p.networkId();
            case "SUBNET" -> p.subnetId();
            case "COMPUTE_CLUSTER" -> p.computeClusterId();
            case "COMPUTE_RESOURCE" -> p.computeResourceId();
            case "DEPLOYMENT_UNIT" -> p.deploymentUnitId();
            case "LOAD_BALANCER" -> p.loadBalancerId();
            case "LISTENER" -> p.listenerId();
            case "DATA_STORE_INSTANCE" -> p.dataStoreInstanceId();
            case "INFRASTRUCTURE_RESOURCE" -> p.infrastructureResourceId();
            default -> null;
        };
    }

    private static String resolveParentNetworkRef(SubnetDto entity, TerraformContext ctx) {
        if (entity.networkId() == null || entity.networkId().isBlank()) {
            return "var.network_id_REPLACE_ME";
        }
        if (ctx.entities() == null || ctx.entities().networks() == null) {
            return "var.network_id_REPLACE_ME";
        }
        for (NetworkDto n : ctx.entities().networks()) {
            if (n == null) continue;
            if (entity.networkId().equals(n.id())) {
                IaCResourceBindingDto netBinding = ctx.bindingsByInfrastructurePointId().values().stream()
                    .filter(b -> matchesPointEntity(b, ctx, "NETWORK", n.id()))
                    .findFirst()
                    .orElse(null);
                String netAddr = TerraformContext.resourceAddress(n.name(), ctx.selectedEnvironment().name(), netBinding);
                String netType = resolveResourceType("google_compute_network", n.terraformResourceHint(), netBinding);
                return netType + "." + netAddr + ".id";
            }
        }
        return "var.network_id_REPLACE_ME";
    }

    private static DeploymentUnitDto findDeploymentUnit(TerraformContext ctx, String deploymentUnitId) {
        if (deploymentUnitId == null || ctx.entities() == null || ctx.entities().deploymentUnits() == null) return null;
        for (DeploymentUnitDto du : ctx.entities().deploymentUnits()) {
            if (du != null && deploymentUnitId.equals(du.id())) return du;
        }
        return null;
    }

    private static ComputeResourceDto findComputeResourceByPointId(TerraformContext ctx, String pointId) {
        if (pointId == null || ctx.entities() == null) return null;
        if (ctx.entities().infrastructurePoints() == null || ctx.entities().computeResources() == null) return null;
        for (InfrastructurePointDto p : ctx.entities().infrastructurePoints()) {
            if (p == null || !pointId.equals(p.id())) continue;
            if (p.computeResourceId() == null) return null;
            for (ComputeResourceDto cr : ctx.entities().computeResources()) {
                if (cr != null && p.computeResourceId().equals(cr.id())) return cr;
            }
            return null;
        }
        return null;
    }

    private static LoadBalancerDto findLoadBalancer(TerraformContext ctx, String loadBalancerId) {
        if (loadBalancerId == null || ctx.entities() == null || ctx.entities().loadBalancers() == null) return null;
        for (LoadBalancerDto lb : ctx.entities().loadBalancers()) {
            if (lb != null && loadBalancerId.equals(lb.id())) return lb;
        }
        return null;
    }

    private static String resolveBootDiskImage(DeploymentUnitDto du) {
        if (du == null) return "REPLACE_ME";
        // Prefer artifactUri (often a full image reference for VMs).
        if (du.artifactUri() != null && !du.artifactUri().isBlank()) return du.artifactUri();
        if (du.imageName() != null && !du.imageName().isBlank()) {
            return du.imageTag() != null && !du.imageTag().isBlank()
                ? du.imageName() + ":" + du.imageTag()
                : du.imageName();
        }
        return "REPLACE_ME";
    }

    private static String resolveCloudRunImage(DeploymentUnitDto du) {
        if (du == null) return "REPLACE_ME";
        if (du.imageName() != null && !du.imageName().isBlank()) {
            return du.imageTag() != null && !du.imageTag().isBlank()
                ? du.imageName() + ":" + du.imageTag()
                : du.imageName();
        }
        if (du.artifactUri() != null && !du.artifactUri().isBlank()) return du.artifactUri();
        return "REPLACE_ME";
    }

    private static boolean isHttpsLoadBalancer(LoadBalancerDto lb) {
        if (lb == null) return false;
        if (lb.exposure() != null && lb.exposure().equalsIgnoreCase("HTTPS")) return true;
        // Listener-driven: defer; assume HTTP if no certificate in LB DTO.
        return false;
    }

    private static String mapSqlVersion(String engine, String engineVersion) {
        String e = engine.toUpperCase();
        if (e.equals("POSTGRES") || e.equals("POSTGRESQL")) {
            return "POSTGRES_" + (engineVersion != null && !engineVersion.isBlank() ? engineVersion.replaceAll("[^0-9_]", "_") : "15");
        }
        if (e.equals("MYSQL")) {
            return "MYSQL_" + (engineVersion != null && !engineVersion.isBlank() ? engineVersion.replaceAll("[^0-9_]", "_") : "8_0");
        }
        if (e.equals("SQLSERVER")) {
            return "SQLSERVER_" + (engineVersion != null && !engineVersion.isBlank() ? engineVersion.replaceAll("[^0-9_]", "_") : "2019_STANDARD");
        }
        return "POSTGRES_15";
    }

    /**
     * Returns true if a Data Store Instance with engine=REDIS exists with the
     * same source_reference as the supplied Cache Infrastructure Resource.
     * In that case the Cache emitter should emit a dedupe note instead of a
     * duplicate {@code google_redis_instance} block.
     */
    private static boolean cacheDedupeAgainstDataStore(InfrastructureResourceDto cacheResource, TerraformContext ctx) {
        if (cacheResource == null) return false;
        String ref = cacheResource.sourceReference();
        if (ref == null || ref.isBlank()) return false;
        if (ctx.entities() == null || ctx.entities().dataStoreInstances() == null) return false;
        for (DataStoreInstanceDto ds : ctx.entities().dataStoreInstances()) {
            if (ds == null) continue;
            if (ds.engine() != null && ds.engine().equalsIgnoreCase("REDIS")
                && ref.equals(ds.sourceReference())) {
                return true;
            }
        }
        return false;
    }
}
