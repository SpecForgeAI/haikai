package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
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
import com.example.architecturemodel.model.dto.entity.SubnetDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationComputeDeploymentDto;
import com.example.architecturemodel.model.dto.relationship.ApplicationLoadBalancerExposureDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Per-emitter unit tests for {@link GcpTerraformExporter}.
 *
 * <p>Covers happy paths, TODO fallbacks, override-hierarchy, and cross-domain
 * resolution rules for all 12 Infra entity emitters.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Groups 2-4.
 */
class GcpTerraformExporterEmitterTest {

    private static final String ENV_ID = "env-1";
    private static final String ENV_NAME = "Prod";

    private final GcpTerraformExporter exporter = new GcpTerraformExporter();

    // ---------- Helpers ----------

    private static EnvironmentDto env() {
        return TerraformTestFixtures.buildRecord(EnvironmentDto.class, Map.of(
            "id", ENV_ID,
            "name", ENV_NAME
        ));
    }

    private static TerraformContext ctx() {
        return ctx(TerraformTestFixtures.emptyEntities(), TerraformTestFixtures.emptyRelationships());
    }

    private static TerraformContext ctx(MetaModelEntitiesDto entities, MetaModelRelationshipsDto rels) {
        return new TerraformContext(entities, rels, env(), null, null, "GCP");
    }

    private static String concatHcl(List<EmittedResource> emitted) {
        StringBuilder b = new StringBuilder();
        for (EmittedResource r : emitted) {
            b.append("# >>> ").append(r.targetFile()).append("\n");
            for (String c : r.comments()) {
                b.append(c).append("\n");
            }
            b.append(r.hclFragment()).append("\n");
        }
        return b.toString();
    }

    private static String concatComments(List<EmittedResource> emitted) {
        StringBuilder b = new StringBuilder();
        for (EmittedResource r : emitted) {
            for (String c : r.comments()) {
                b.append(c).append("\n");
            }
        }
        return b.toString();
    }

    private static String concatWarnings(List<EmittedResource> emitted) {
        StringBuilder b = new StringBuilder();
        for (EmittedResource r : emitted) {
            for (String w : r.warnings()) {
                b.append(w).append("\n");
            }
        }
        return b.toString();
    }

    // ---------- Provider id ----------

    @Test
    void providerId_isGcp() {
        assertEquals("GCP", exporter.providerId());
    }

    // ---------- Environment ----------

    @Test
    void exportEnvironment_emitsLocalsBlock_variableBlock_andReadmeSection() {
        List<EmittedResource> out = exporter.exportEnvironment(env(), ctx());

        assertEquals(3, out.size(), "Environment should emit main.tf, variables.tf, and README.md fragments");
        // Each fragment carries the standard block headers in its comments.
        for (EmittedResource r : out) {
            assertTrue(r.comments().stream().anyMatch(c -> c.equals("# Infrastructure concept: Environment")),
                "Standard header missing for " + r.targetFile());
            assertTrue(r.comments().stream().anyMatch(c -> c.equals("# Architecture entity: " + ENV_NAME)),
                "Architecture-entity header missing for " + r.targetFile());
            assertTrue(r.comments().stream().anyMatch(c -> c.equals("# Environment: " + ENV_NAME)),
                "Environment header missing for " + r.targetFile());
        }

        String mainHcl = out.stream().filter(r -> r.targetFile().equals("main.tf")).findFirst().orElseThrow().hclFragment();
        assertTrue(mainHcl.contains("locals"), "main.tf should contain locals block: " + mainHcl);
        assertTrue(mainHcl.contains("environment = var.environment"), mainHcl);

        String varHcl = out.stream().filter(r -> r.targetFile().equals("variables.tf")).findFirst().orElseThrow().hclFragment();
        assertTrue(varHcl.contains("variable \"environment\""), varHcl);
        assertTrue(varHcl.contains("default"), varHcl);
    }

    // ---------- CloudAccount ----------

    @Test
    void exportCloudAccount_happyPath_emitsProviderBlockAndProjectVariable() {
        CloudAccountDto ca = TerraformTestFixtures.buildRecord(CloudAccountDto.class, Map.of(
            "id", "ca-1",
            "name", "GcpProject",
            "external_account_id", "my-project"
        ));

        List<EmittedResource> out = exporter.exportCloudAccount(ca, ctx());

        assertEquals(2, out.size());
        String main = out.get(0).hclFragment();
        assertTrue(main.contains("provider \"google\""), main);
        assertTrue(main.contains("project = var.project_id"), main);
        String vars = out.get(1).hclFragment();
        assertTrue(vars.contains("variable \"project_id\""), vars);
        assertTrue(vars.contains("default     = \"my-project\""), vars);
    }

    @Test
    void exportCloudAccount_missingEntity_emitsTodoAndPlaceholder() {
        List<EmittedResource> out = exporter.exportCloudAccount(null, ctx());

        String warnings = concatWarnings(out);
        assertTrue(warnings.contains("missing cloud_account"), warnings);
        // Provider block is still emitted with placeholder.
        String main = out.get(0).hclFragment();
        assertTrue(main.contains("provider \"google\""), main);
        String vars = out.get(1).hclFragment();
        assertTrue(vars.contains("REPLACE_ME"), vars);
    }

    // ---------- Location ----------

    @Test
    void exportLocation_happyPath_emitsRegionAndZoneVariables() {
        LocationDto loc = TerraformTestFixtures.buildRecord(LocationDto.class, Map.of(
            "id", "loc-1",
            "name", "EuropeWest1",
            "provider_region_code", "europe-west1",
            "provider_zone_code", "europe-west1-b"
        ));

        List<EmittedResource> out = exporter.exportLocation(loc, ctx());

        assertEquals(1, out.size());
        String vars = out.get(0).hclFragment();
        assertTrue(vars.contains("variable \"region\""), vars);
        assertTrue(vars.contains("default     = \"europe-west1\""), vars);
        assertTrue(vars.contains("variable \"zone\""), vars);
        assertTrue(vars.contains("default     = \"europe-west1-b\""), vars);
    }

    @Test
    void exportLocation_missingEntity_emitsRegionDefaultWithTodo() {
        List<EmittedResource> out = exporter.exportLocation(null, ctx());
        assertEquals(1, out.size());
        assertTrue(concatWarnings(out).contains("missing location"));
        assertTrue(out.get(0).hclFragment().contains("variable \"region\""));
    }

    // ---------- Network ----------

    @Test
    void exportNetwork_happyPath_emitsGoogleComputeNetwork_withStandardHeaders() {
        NetworkDto net = TerraformTestFixtures.buildRecord(NetworkDto.class, Map.of(
            "id", "net-1",
            "name", "App VPC",
            "network_type", "VPC",
            "routing_mode", "REGIONAL"
        ));

        List<EmittedResource> out = exporter.exportNetwork(net, ctx());

        assertEquals(1, out.size());
        EmittedResource r = out.get(0);
        assertEquals("main.tf", r.targetFile());
        // Standard block headers
        assertTrue(r.comments().contains("# Infrastructure concept: Network"));
        assertTrue(r.comments().contains("# Architecture entity: App VPC"));
        assertTrue(r.comments().contains("# Environment: " + ENV_NAME));
        // HCL: default GCP type + synthesised env-slug-based address
        assertTrue(r.hclFragment().contains("resource \"google_compute_network\" \"prod_app_vpc\""), r.hclFragment());
        assertTrue(r.hclFragment().contains("routing_mode            = \"REGIONAL\""), r.hclFragment());
        assertTrue(r.warnings().isEmpty(), "Happy path should produce no warnings: " + r.warnings());
    }

    @Test
    void exportNetwork_unsupportedNetworkType_emitsTodoAndWarning() {
        NetworkDto net = TerraformTestFixtures.buildRecord(NetworkDto.class, Map.of(
            "id", "net-2",
            "name", "Azure VNET",
            "network_type", "VNET"
        ));

        List<EmittedResource> out = exporter.exportNetwork(net, ctx());

        String warnings = concatWarnings(out);
        assertTrue(warnings.contains("network_type='VNET' not GCP-compatible"), warnings);
        // TODO comment also surfaces in the comments above the block.
        assertTrue(concatComments(out).contains("network_type='VNET' not GCP-compatible"));
    }

    @Test
    void exportNetwork_iacResourceBinding_overridesAddressAndType() {
        // Build an InfrastructurePoint pointing at the network entity.
        InfrastructurePointDto point = TerraformTestFixtures.buildRecord(InfrastructurePointDto.class, Map.of(
            "id", "ip-net-1",
            "point_kind", "NETWORK",
            "network_id", "net-3"
        ));
        IaCResourceBindingDto binding = TerraformTestFixtures.buildRecord(IaCResourceBindingDto.class, Map.of(
            "id", "b1",
            "infrastructure_point_id", "ip-net-1",
            "iac_address", "module.network.google_compute_network.app",
            "iac_resource_type", "google_compute_network_v2"
        ));

        MetaModelEntitiesDto entities = TerraformTestFixtures.entitiesWith(Map.of(
            "infrastructure_points", List.of(point)
        ));
        MetaModelRelationshipsDto rels = TerraformTestFixtures.relationshipsWith(Map.of(
            "iac_resource_bindings", List.of(binding)
        ));
        TerraformContext context = ctx(entities, rels);

        NetworkDto net = TerraformTestFixtures.buildRecord(NetworkDto.class, Map.of(
            "id", "net-3",
            "name", "App VPC",
            "network_type", "VPC"
        ));

        List<EmittedResource> out = exporter.exportNetwork(net, context);
        String hcl = out.get(0).hclFragment();
        // iac_address reused verbatim as resource address (after the type).
        assertTrue(hcl.contains("\"google_compute_network_v2\" \"module.network.google_compute_network.app\""), hcl);
    }

    @Test
    void exportNetwork_terraformResourceHint_overridesDefaultType() {
        NetworkDto net = TerraformTestFixtures.buildRecord(NetworkDto.class, Map.of(
            "id", "net-4",
            "name", "App VPC",
            "network_type", "VPC",
            "terraform_resource_hint", "google_compute_network_beta"
        ));

        List<EmittedResource> out = exporter.exportNetwork(net, ctx());
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_compute_network_beta\""), hcl);
    }

    // ---------- Subnet ----------

    @Test
    void exportSubnet_happyPath_emitsGoogleComputeSubnetwork() {
        SubnetDto sn = TerraformTestFixtures.buildRecord(SubnetDto.class, Map.of(
            "id", "sn-1",
            "name", "App Subnet",
            "cidr", "10.0.0.0/24",
            "provider_region_code", "europe-west1"
        ));

        List<EmittedResource> out = exporter.exportSubnet(sn, ctx());
        assertEquals(1, out.size());
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_compute_subnetwork\" \"prod_app_subnet\""), hcl);
        assertTrue(hcl.contains("ip_cidr_range = \"10.0.0.0/24\""), hcl);
        assertTrue(hcl.contains("region        = \"europe-west1\""), hcl);
    }

    @Test
    void exportSubnet_missingCidr_emitsTodoAndWarning() {
        SubnetDto sn = TerraformTestFixtures.buildRecord(SubnetDto.class, Map.of(
            "id", "sn-2",
            "name", "App Subnet",
            "provider_region_code", "europe-west1"
            // cidr omitted
        ));

        List<EmittedResource> out = exporter.exportSubnet(sn, ctx());
        assertTrue(concatWarnings(out).contains("missing CIDR"));
        // The block is still emitted with a placeholder comment.
        assertTrue(out.get(0).hclFragment().contains("# ip_cidr_range = \"REPLACE_ME\""));
    }

    // ---------- ComputeCluster ----------

    @Test
    void exportComputeCluster_kubernetes_emitsContainerClusterAndNodePoolTodo() {
        ComputeClusterDto cc = TerraformTestFixtures.buildRecord(ComputeClusterDto.class, Map.of(
            "id", "cc-1",
            "name", "App GKE",
            "platform_type", "KUBERNETES",
            "version", "1.28"
        ));

        List<EmittedResource> out = exporter.exportComputeCluster(cc, ctx());
        assertEquals(1, out.size());
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_container_cluster\" \"prod_app_gke\""), hcl);
        assertTrue(hcl.contains("min_master_version = \"1.28\""), hcl);
        // Node-pool TODO scaffold.
        assertTrue(hcl.contains("resource \"google_container_node_pool\""), hcl);
        assertTrue(concatWarnings(out).contains("node-pool fields require completion"));
    }

    @Test
    void exportComputeCluster_cloudRun_emitsCommentOnlyBlock() {
        ComputeClusterDto cc = TerraformTestFixtures.buildRecord(ComputeClusterDto.class, Map.of(
            "id", "cc-2",
            "name", "App CR Cluster",
            "platform_type", "CLOUD_RUN"
        ));

        List<EmittedResource> out = exporter.exportComputeCluster(cc, ctx());
        String hcl = out.get(0).hclFragment();
        assertFalse(hcl.contains("resource \""), "Cloud Run cluster should not emit a standalone resource: " + hcl);
        assertTrue(hcl.contains("# Cloud Run cluster: App CR Cluster"), hcl);
    }

    @Test
    void exportComputeCluster_unsupportedPlatformType_emitsTodoScaffoldAndWarning() {
        ComputeClusterDto cc = TerraformTestFixtures.buildRecord(ComputeClusterDto.class, Map.of(
            "id", "cc-3",
            "name", "App ECS",
            "platform_type", "ECS"
        ));

        List<EmittedResource> out = exporter.exportComputeCluster(cc, ctx());
        assertTrue(concatWarnings(out).contains("unsupported platform_type='ECS'"));
        assertTrue(out.get(0).hclFragment().contains("# TODO: unsupported platform_type='ECS'"));
    }

    // ---------- ComputeResource ----------

    @Test
    void exportComputeResource_vm_resolvesImageFromApplicationComputeDeployments() {
        DeploymentUnitDto du = TerraformTestFixtures.buildRecord(DeploymentUnitDto.class, Map.of(
            "id", "du-1",
            "name", "app_image",
            "image_name", "us-docker.pkg.dev/p/app",
            "image_tag", "1.2.3"
        ));
        ApplicationComputeDeploymentDto deployment = TerraformTestFixtures.buildRecord(
            ApplicationComputeDeploymentDto.class, Map.of(
                "id", "acd-1",
                "compute_resource_id", "cr-1",
                "deployment_unit_id", "du-1"
            ));

        MetaModelEntitiesDto entities = TerraformTestFixtures.entitiesWith(Map.of(
            "deployment_units", List.of(du)
        ));
        MetaModelRelationshipsDto rels = TerraformTestFixtures.relationshipsWith(Map.of(
            "application_compute_deployments", List.of(deployment)
        ));
        TerraformContext context = ctx(entities, rels);

        ComputeResourceDto cr = TerraformTestFixtures.buildRecord(ComputeResourceDto.class, Map.of(
            "id", "cr-1",
            "name", "App VM",
            "compute_type", "VM",
            "instance_size", "e2-medium"
        ));

        List<EmittedResource> out = exporter.exportComputeResource(cr, context);
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_compute_instance\" \"prod_app_vm\""), hcl);
        // VM emitter prefers artifact_uri then imageName:imageTag.
        assertTrue(hcl.contains("image = \"us-docker.pkg.dev/p/app:1.2.3\""), hcl);
        // Comment trail records the deployment unit.
        assertTrue(concatComments(out).contains("# Deployed by: app_image"));
    }

    @Test
    void exportComputeResource_cloudRunService_resolvesContainerImage() {
        DeploymentUnitDto du = TerraformTestFixtures.buildRecord(DeploymentUnitDto.class, Map.of(
            "id", "du-2",
            "name", "app_image",
            "image_name", "europe-docker.pkg.dev/p/app",
            "image_tag", "v9"
        ));
        ApplicationComputeDeploymentDto deployment = TerraformTestFixtures.buildRecord(
            ApplicationComputeDeploymentDto.class, Map.of(
                "id", "acd-2",
                "compute_resource_id", "cr-2",
                "deployment_unit_id", "du-2"
            ));

        MetaModelEntitiesDto entities = TerraformTestFixtures.entitiesWith(Map.of(
            "deployment_units", List.of(du)
        ));
        MetaModelRelationshipsDto rels = TerraformTestFixtures.relationshipsWith(Map.of(
            "application_compute_deployments", List.of(deployment)
        ));
        TerraformContext context = ctx(entities, rels);

        ComputeResourceDto cr = TerraformTestFixtures.buildRecord(ComputeResourceDto.class, Map.of(
            "id", "cr-2",
            "name", "App Run",
            "compute_type", "CLOUD_RUN_SERVICE"
        ));

        List<EmittedResource> out = exporter.exportComputeResource(cr, context);
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_cloud_run_v2_service\" \"prod_app_run\""), hcl);
        assertTrue(hcl.contains("image = \"europe-docker.pkg.dev/p/app:v9\""), hcl);
    }

    @Test
    void exportComputeResource_multipleDeployments_emitsAmbiguityWarning() {
        ApplicationComputeDeploymentDto d1 = TerraformTestFixtures.buildRecord(
            ApplicationComputeDeploymentDto.class, Map.of(
                "id", "acd-a", "compute_resource_id", "cr-x", "deployment_unit_id", "du-a"
            ));
        ApplicationComputeDeploymentDto d2 = TerraformTestFixtures.buildRecord(
            ApplicationComputeDeploymentDto.class, Map.of(
                "id", "acd-b", "compute_resource_id", "cr-x", "deployment_unit_id", "du-b"
            ));
        MetaModelRelationshipsDto rels = TerraformTestFixtures.relationshipsWith(Map.of(
            "application_compute_deployments", List.of(d1, d2)
        ));
        TerraformContext context = ctx(TerraformTestFixtures.emptyEntities(), rels);

        ComputeResourceDto cr = TerraformTestFixtures.buildRecord(ComputeResourceDto.class, Map.of(
            "id", "cr-x",
            "name", "App VM",
            "compute_type", "VM"
        ));

        List<EmittedResource> out = exporter.exportComputeResource(cr, context);
        assertTrue(concatWarnings(out).contains("ambiguous DU->CR mapping"));
    }

    // ---------- DeploymentUnit ----------

    @Test
    void exportDeploymentUnit_returnsEmptyList_isCrossDomainOnly() {
        DeploymentUnitDto du = TerraformTestFixtures.buildRecord(DeploymentUnitDto.class, Map.of(
            "id", "du-empty",
            "name", "noop"
        ));
        List<EmittedResource> out = exporter.exportDeploymentUnit(du, ctx());
        assertTrue(out.isEmpty(), "Deployment Unit emitter must return empty list (cross-domain only)");
    }

    // ---------- LoadBalancer ----------

    @Test
    void exportLoadBalancer_happyPath_emitsCompositeFourResources() {
        LoadBalancerDto lb = TerraformTestFixtures.buildRecord(LoadBalancerDto.class, Map.of(
            "id", "lb-1",
            "name", "App LB",
            "load_balancer_type", "HTTP",
            "exposure", "HTTP"
        ));

        List<EmittedResource> out = exporter.exportLoadBalancer(lb, ctx());
        assertEquals(1, out.size());
        String hcl = out.get(0).hclFragment();
        // 4 GCP resources for plain HTTP composite.
        assertTrue(hcl.contains("resource \"google_compute_backend_service\""), hcl);
        assertTrue(hcl.contains("resource \"google_compute_url_map\""), hcl);
        assertTrue(hcl.contains("resource \"google_compute_target_http_proxy\""), hcl);
        assertTrue(hcl.contains("resource \"google_compute_global_forwarding_rule\""), hcl);
        // Standard block headers present.
        assertTrue(out.get(0).comments().contains("# Infrastructure concept: Load Balancer"));
    }

    @Test
    void exportLoadBalancer_emitsBackendIncompleteWarning() {
        // Without any LoadBalancerResourceRoutes there is no Cloud Run target,
        // so the emitter raises a soft-warn for incomplete backend resolution.
        LoadBalancerDto lb = TerraformTestFixtures.buildRecord(LoadBalancerDto.class, Map.of(
            "id", "lb-2",
            "name", "App LB"
        ));
        List<EmittedResource> out = exporter.exportLoadBalancer(lb, ctx());
        assertTrue(concatWarnings(out).contains("backend resolution incomplete"));
        // Inline TODO is also present in the HCL fragment.
        assertTrue(out.get(0).hclFragment().contains("# TODO: bind backend"));
    }

    // ---------- Listener ----------

    @Test
    void exportListener_withParentLoadBalancer_emitsContributionComment() {
        LoadBalancerDto parent = TerraformTestFixtures.buildRecord(LoadBalancerDto.class, Map.of(
            "id", "lb-parent",
            "name", "App LB"
        ));
        MetaModelEntitiesDto entities = TerraformTestFixtures.entitiesWith(Map.of(
            "load_balancers", List.of(parent)
        ));
        TerraformContext context = ctx(entities, TerraformTestFixtures.emptyRelationships());

        ListenerDto listener = TerraformTestFixtures.buildRecord(ListenerDto.class, Map.of(
            "id", "lst-1",
            "name", "App Listener",
            "load_balancer_id", "lb-parent",
            "protocol", "HTTPS",
            "port", 443,
            "host_name", "app.example.com",
            "path_pattern", "/api/*"
        ));

        List<EmittedResource> out = exporter.exportListener(listener, context);
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("# Listener contribution to Load Balancer 'App LB'"), hcl);
        assertTrue(hcl.contains("protocol = HTTPS"), hcl);
        assertTrue(hcl.contains("port = 443"), hcl);
        assertTrue(hcl.contains("host_name = app.example.com"), hcl);
        assertTrue(hcl.contains("path_pattern = /api/*"), hcl);
    }

    @Test
    void exportListener_missingParent_emitsTodoAndWarning() {
        ListenerDto listener = TerraformTestFixtures.buildRecord(ListenerDto.class, Map.of(
            "id", "lst-2",
            "name", "App Listener",
            "load_balancer_id", "lb-missing"
        ));
        List<EmittedResource> out = exporter.exportListener(listener, ctx());
        assertTrue(concatWarnings(out).contains("parent load_balancer_id unresolved"));
    }

    // ---------- DataStoreInstance ----------

    @Test
    void exportDataStoreInstance_postgres_emitsGoogleSqlDatabaseInstance() {
        DataStoreInstanceDto ds = TerraformTestFixtures.buildRecord(DataStoreInstanceDto.class, Map.of(
            "id", "ds-1",
            "name", "App DB",
            "engine", "POSTGRES",
            "engine_version", "15"
        ));
        List<EmittedResource> out = exporter.exportDataStoreInstance(ds, ctx());
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_sql_database_instance\" \"prod_app_db\""), hcl);
        assertTrue(hcl.contains("database_version = \"POSTGRES_15\""), hcl);
    }

    @Test
    void exportDataStoreInstance_redis_emitsGoogleRedisInstance() {
        DataStoreInstanceDto ds = TerraformTestFixtures.buildRecord(DataStoreInstanceDto.class, Map.of(
            "id", "ds-2",
            "name", "App Cache",
            "engine", "REDIS"
        ));
        List<EmittedResource> out = exporter.exportDataStoreInstance(ds, ctx());
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_redis_instance\" \"prod_app_cache\""), hcl);
        assertTrue(hcl.contains("memory_size_gb = 1"), hcl);
    }

    @Test
    void exportDataStoreInstance_unsupportedEngine_emitsTodoAndWarning() {
        DataStoreInstanceDto ds = TerraformTestFixtures.buildRecord(DataStoreInstanceDto.class, Map.of(
            "id", "ds-3",
            "name", "App BQ",
            "engine", "BIGQUERY"
        ));
        List<EmittedResource> out = exporter.exportDataStoreInstance(ds, ctx());
        assertTrue(concatWarnings(out).contains("unsupported engine='BIGQUERY'"));
        assertTrue(out.get(0).hclFragment().contains("# TODO: unsupported engine='BIGQUERY'"));
    }

    // ---------- InfrastructureResource ----------

    @Test
    void exportInfrastructureResource_objectBucket_emitsGoogleStorageBucket() {
        InfrastructureResourceDto ir = buildResource("ir-1", "App Assets", "OBJECT_BUCKET");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        assertTrue(out.get(0).hclFragment().contains("resource \"google_storage_bucket\" \"prod_app_assets\""));
    }

    @Test
    void exportInfrastructureResource_messageTopic_emitsGooglePubsubTopic() {
        InfrastructureResourceDto ir = buildResource("ir-2", "App Topic", "MESSAGE_TOPIC");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        assertTrue(out.get(0).hclFragment().contains("resource \"google_pubsub_topic\" \"prod_app_topic\""));
    }

    @Test
    void exportInfrastructureResource_messageQueue_emitsGooglePubsubSubscription() {
        InfrastructureResourceDto ir = buildResource("ir-3", "App Queue", "MESSAGE_QUEUE");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        assertTrue(out.get(0).hclFragment().contains("resource \"google_pubsub_subscription\" \"prod_app_queue\""));
    }

    @Test
    void exportInfrastructureResource_cache_emitsGoogleRedisInstance_whenNoDataStoreDedupe() {
        InfrastructureResourceDto ir = buildResource("ir-4", "App Cache IR", "CACHE");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        assertTrue(out.get(0).hclFragment().contains("resource \"google_redis_instance\" \"prod_app_cache_ir\""));
    }

    @Test
    void exportInfrastructureResource_secretStore_emitsGoogleSecretManagerSecret_andNeverIncludesValues() {
        InfrastructureResourceDto ir = buildResource("ir-5", "App Secrets", "SECRET_STORE");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        String hcl = out.get(0).hclFragment();
        assertTrue(hcl.contains("resource \"google_secret_manager_secret\" \"prod_app_secrets\""), hcl);
        assertTrue(hcl.contains("# NOTE: secret values are NEVER emitted"), hcl);
        assertFalse(hcl.contains("secret_data"), "SECRET_STORE must not include secret_data: " + hcl);
        // The Terraform secret_id is fine; ensure no "value =" or version-data.
        assertFalse(hcl.toLowerCase().contains("secret_data"));
    }

    @Test
    void exportInfrastructureResource_scheduler_emitsGoogleCloudSchedulerJob() {
        InfrastructureResourceDto ir = buildResource("ir-6", "App Cron", "SCHEDULER");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        assertTrue(out.get(0).hclFragment().contains("resource \"google_cloud_scheduler_job\" \"prod_app_cron\""));
    }

    @Test
    void exportInfrastructureResource_unsupportedType_emitsTodoAndWarning() {
        InfrastructureResourceDto ir = buildResource("ir-7", "App Custom", "CUSTOM");
        List<EmittedResource> out = exporter.exportInfrastructureResource(ir, ctx());
        assertTrue(concatWarnings(out).contains("unsupported resource_type='CUSTOM'"));
    }

    private static InfrastructureResourceDto buildResource(String id, String name, String resourceType) {
        Map<String, Object> overrides = new HashMap<>();
        overrides.put("id", id);
        overrides.put("name", name);
        overrides.put("resource_type", resourceType);
        return TerraformTestFixtures.buildRecord(InfrastructureResourceDto.class, overrides);
    }
}
