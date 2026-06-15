package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclSourceFile;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link GcpTerraformImporter} -- the GCP reverse-mapping classifier
 * that inverts {@code GcpTerraformExporter}.
 *
 * <p>Each top-level test exercises a single GCP resource type (or grouped
 * sibling family) and asserts {@code targetEntityType}, key fields in
 * {@code proposedEntityFields}, the exact {@code iac_address} byte form, and
 * the confidence bucket. Composite-LB tests cover the success closure (5
 * resources -> 1 {@code LoadBalancer} + 1 {@code Listener}) and the partial
 * fallback (per-component candidates + top-level warning). The unsupported
 * fallback test asserts a {@code google_*} resource type not in the locked
 * mapping (e.g. {@code google_compute_firewall}) lands as
 * {@code targetEntityType = "Unsupported"} with full HCL preserved as
 * evidence. The module-scoped iac_address test asserts a resource declared
 * inside a {@code module "x" &#123;&#125;} block produces the
 * {@code module.x.&lt;type&gt;.&lt;name&gt;} address shape.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 3.1
 */
class GcpTerraformImporterTest {

    // ============================================================
    // Test plumbing helpers
    // ============================================================

    private static GcpTerraformImporter newImporter() {
        return new GcpTerraformImporter();
    }

    private static TerraformImportContext newCtx(ParsedHclFile file) {
        return new TerraformImportContext(
            List.of(file),
            null,
            "env-1",          // environmentId required
            "cloud-acct-1",   // cloudAccountId
            "loc-1",          // locationId
            "GCP",            // providerId
            null, null, null, null, null
        );
    }

    private static ParsedHclFile parse(String filePath, String src) {
        return HclSourceFile.parse(filePath, src, new ArrayList<>());
    }

    private static ImportedCandidate findFirst(List<ImportedCandidate> cands, String entityType) {
        for (ImportedCandidate c : cands) {
            if (entityType.equals(c.targetEntityType())) return c;
        }
        return null;
    }

    private static List<ImportedCandidate> findAll(List<ImportedCandidate> cands, String entityType) {
        List<ImportedCandidate> out = new ArrayList<>();
        for (ImportedCandidate c : cands) {
            if (entityType.equals(c.targetEntityType())) out.add(c);
        }
        return out;
    }

    // ============================================================
    // Provider id
    // ============================================================

    @Test
    void providerId_returnsGcp() {
        assertEquals("GCP", newImporter().providerId());
    }

    // ============================================================
    // Networking
    // ============================================================

    @Test
    void googleComputeNetwork_classifiesToNetwork_withFieldsAndIacAddress() {
        String src = """
            resource "google_compute_network" "vpc" {
              name         = "main"
              description  = "main vpc"
              routing_mode = "REGIONAL"
              auto_create_subnetworks = false
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_NETWORK, c.targetEntityType());

        Map<String, Object> f = c.proposedEntityFields();
        assertEquals("main", f.get("name"));
        assertEquals("main vpc", f.get("description"));
        assertEquals("REGIONAL", f.get("routing_mode"));

        assertEquals("google_compute_network.vpc", c.proposedBinding().iacAddress());
        assertEquals("google_compute_network", c.proposedBinding().iacResourceType());
        assertEquals("vpc", c.proposedBinding().iacResourceName());
        assertEquals("GCP", c.proposedBinding().provider());
        assertEquals(ImportedCandidate.CONFIDENCE_HIGH, c.confidence());
    }

    @Test
    void googleComputeSubnetwork_preservesCidrRegionAndNetworkRef() {
        String src = """
            resource "google_compute_subnetwork" "app" {
              name          = "app-subnet"
              ip_cidr_range = "10.0.1.0/24"
              region        = "europe-west1"
              network       = google_compute_network.vpc.id
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_SUBNET, c.targetEntityType());
        Map<String, Object> f = c.proposedEntityFields();
        assertEquals("app-subnet", f.get("name"));
        assertEquals("10.0.1.0/24", f.get("cidr"));
        assertEquals("europe-west1", f.get("region"));
        // network is a reference; preserved as raw expression text.
        assertEquals("google_compute_network.vpc.id", String.valueOf(f.get("network_ref")));
        assertEquals("google_compute_subnetwork.app", c.proposedBinding().iacAddress());
        // unresolved ref present -> MEDIUM
        assertEquals(ImportedCandidate.CONFIDENCE_MEDIUM, c.confidence());
        assertNotNull(c.evidence().unresolvedExpressionText());
        assertTrue(c.evidence().unresolvedExpressionText().contains("google_compute_network.vpc.id"));
    }

    // ============================================================
    // Compute -- container cluster, instance, cloud run, cloud functions
    // ============================================================

    @Test
    void googleContainerCluster_classifiesToComputeCluster_withNodePoolAsEvidence() {
        String src = """
            resource "google_container_cluster" "primary" {
              name     = "prod-cluster"
              location = "europe-west1"
              min_master_version = "1.27"
              node_pool {
                name = "default-pool"
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_COMPUTE_CLUSTER, c.targetEntityType());
        Map<String, Object> f = c.proposedEntityFields();
        assertEquals("prod-cluster", f.get("name"));
        assertEquals("KUBERNETES", f.get("provider_resource_type"));
        assertEquals("europe-west1", f.get("location"));
        assertEquals("1.27", f.get("version"));
        assertEquals("google_container_cluster.primary", c.proposedBinding().iacAddress());
        // Node pool surfaced as evidence comment in warnings (NOT a first-class candidate).
        boolean nodePoolFound = c.perCandidateWarnings().stream()
            .anyMatch(w -> w.contains("Node pool: default-pool"));
        assertTrue(nodePoolFound, "expected node-pool evidence in perCandidateWarnings");
    }

    @Test
    void googleComputeInstance_classifiesToComputeResourceVm_withMachineTypeZoneAndImage() {
        String src = """
            resource "google_compute_instance" "web" {
              name         = "web-1"
              machine_type = "e2-medium"
              zone         = "europe-west1-b"
              boot_disk {
                initialize_params {
                  image = "debian-cloud/debian-12"
                }
              }
              network_interface {
                subnetwork = google_compute_subnetwork.app.id
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_COMPUTE_RESOURCE, c.targetEntityType());
        Map<String, Object> f = c.proposedEntityFields();
        assertEquals("web-1", f.get("name"));
        assertEquals("VM", f.get("provider_resource_type"));
        assertEquals("e2-medium", f.get("machine_type"));
        assertEquals("europe-west1-b", f.get("zone"));
        assertEquals("debian-cloud/debian-12", f.get("image"));
        assertEquals("google_compute_subnetwork.app.id", String.valueOf(f.get("subnetwork_ref")));
        assertEquals("google_compute_instance.web", c.proposedBinding().iacAddress());
    }

    @Test
    void googleCloudRunV2Service_emitsComputeResource_implicitCluster_andDeploymentUnit() {
        String src = """
            resource "google_cloud_run_v2_service" "api" {
              name     = "api-service"
              location = "europe-west1"
              template {
                containers {
                  image = "gcr.io/proj/api:1.0"
                }
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        // Expect 3 candidates: ComputeResource + ComputeCluster (implicit) + DeploymentUnit
        assertEquals(3, cands.size());
        ImportedCandidate cr = findFirst(cands, ImportedCandidate.TYPE_COMPUTE_RESOURCE);
        ImportedCandidate cluster = findFirst(cands, ImportedCandidate.TYPE_COMPUTE_CLUSTER);
        ImportedCandidate du = findFirst(cands, ImportedCandidate.TYPE_DEPLOYMENT_UNIT);
        assertNotNull(cr, "ComputeResource missing");
        assertNotNull(cluster, "implicit ComputeCluster missing");
        assertNotNull(du, "DeploymentUnit missing");

        assertEquals("CLOUD_RUN_SERVICE", cr.proposedEntityFields().get("provider_resource_type"));
        assertEquals("api-service", cr.proposedEntityFields().get("name"));
        assertEquals("gcr.io/proj/api:1.0", cr.proposedEntityFields().get("image"));
        assertEquals("google_cloud_run_v2_service.api", cr.proposedBinding().iacAddress());

        assertEquals("CLOUD_RUN", cluster.proposedEntityFields().get("provider_resource_type"));
        assertEquals(Boolean.TRUE, cluster.proposedEntityFields().get("implicit"));

        assertEquals("gcr.io/proj/api:1.0", du.proposedEntityFields().get("image"));
        assertEquals("google_cloud_run_v2_service.api", du.proposedEntityFields().get("parent_compute_resource_address"));
    }

    @Test
    void cloudRunImplicitCluster_notDoubled_whenTwoCloudRunServicesPresent() {
        String src = """
            resource "google_cloud_run_v2_service" "a" {
              name = "a"
              location = "eu"
              template {
                containers {
                  image = "i:1"
                }
              }
            }
            resource "google_cloud_run_v2_service" "b" {
              name = "b"
              location = "eu"
              template {
                containers {
                  image = "i:2"
                }
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        // Only ONE implicit ComputeCluster should be emitted across both services.
        long clusterCount = cands.stream()
            .filter(c -> ImportedCandidate.TYPE_COMPUTE_CLUSTER.equals(c.targetEntityType()))
            .count();
        assertEquals(1, clusterCount,
            "implicit CLOUD_RUN cluster must be emitted only once even with multiple Cloud Run services");
    }

    @Test
    void googleCloudFunctions2Function_emitsComputeResource_implicitCluster_andDeploymentUnit() {
        String src = """
            resource "google_cloudfunctions2_function" "fn" {
              name     = "task-fn"
              location = "europe-west1"
              build_config {
                source = "gs://bucket/fn.zip"
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(3, cands.size());
        ImportedCandidate cr = findFirst(cands, ImportedCandidate.TYPE_COMPUTE_RESOURCE);
        ImportedCandidate cluster = findFirst(cands, ImportedCandidate.TYPE_COMPUTE_CLUSTER);
        ImportedCandidate du = findFirst(cands, ImportedCandidate.TYPE_DEPLOYMENT_UNIT);
        assertNotNull(cr);
        assertNotNull(cluster);
        assertNotNull(du);
        assertEquals("FUNCTION", cr.proposedEntityFields().get("provider_resource_type"));
        assertEquals("CLOUD_FUNCTIONS", cluster.proposedEntityFields().get("provider_resource_type"));
        assertEquals("gs://bucket/fn.zip", du.proposedEntityFields().get("source"));
        assertEquals("google_cloudfunctions2_function.fn", cr.proposedBinding().iacAddress());
    }

    // ============================================================
    // Data stores -- SQL, Redis, BigQuery, AlloyDB
    // ============================================================

    @Test
    void googleSqlDatabaseInstance_andGoogleSqlDatabase_areClassifiedToDataStoreInstance() {
        String src = """
            resource "google_sql_database_instance" "main" {
              name             = "main-db"
              database_version = "POSTGRES_15"
              region           = "europe-west1"
            }
            resource "google_sql_database" "appdb" {
              name     = "app"
              instance = google_sql_database_instance.main.name
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(2, cands.size());
        List<ImportedCandidate> dsis = findAll(cands, ImportedCandidate.TYPE_DATA_STORE_INSTANCE);
        assertEquals(2, dsis.size());

        ImportedCandidate inst = dsis.stream()
            .filter(c -> "google_sql_database_instance".equals(c.proposedBinding().iacResourceType()))
            .findFirst().orElseThrow();
        assertEquals("RELATIONAL", inst.proposedEntityFields().get("engine_class"));
        assertEquals("POSTGRES_15", inst.proposedEntityFields().get("database_version"));
        assertEquals("europe-west1", inst.proposedEntityFields().get("region"));
        assertEquals("google_sql_database_instance.main", inst.proposedBinding().iacAddress());

        ImportedCandidate db = dsis.stream()
            .filter(c -> "google_sql_database".equals(c.proposedBinding().iacResourceType()))
            .findFirst().orElseThrow();
        assertEquals(Boolean.TRUE, db.proposedEntityFields().get("database_level"));
        // parent instance reference preserved verbatim
        assertEquals("google_sql_database_instance.main.name",
            String.valueOf(db.proposedEntityFields().get("parentInstanceRef")));
        assertEquals("google_sql_database.appdb", db.proposedBinding().iacAddress());
    }

    @Test
    void googleRedisInstance_classifiesToDataStoreInstance_cacheRedis() {
        String src = """
            resource "google_redis_instance" "cache" {
              name           = "redis-1"
              tier           = "BASIC"
              memory_size_gb = 1
              region         = "europe-west1"
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));

        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_DATA_STORE_INSTANCE, c.targetEntityType());
        // Spec.md picked DataStoreInstance (engine class = CACHE, engine = REDIS) for round-trip parity.
        assertEquals("CACHE", c.proposedEntityFields().get("engine_class"));
        assertEquals("REDIS", c.proposedEntityFields().get("engine"));
        assertEquals("BASIC", c.proposedEntityFields().get("tier"));
        assertEquals("google_redis_instance.cache", c.proposedBinding().iacAddress());
    }

    @Test
    void bigQueryAndAlloyDb_areBestEffortMediumConfidence() {
        String src = """
            resource "google_bigquery_dataset" "ds" {
              dataset_id = "analytics"
              location   = "EU"
            }
            resource "google_alloydb_cluster" "ac" {
              cluster_id = "main-cluster"
              location   = "europe-west1"
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));
        assertEquals(2, cands.size());
        for (ImportedCandidate c : cands) {
            assertEquals(ImportedCandidate.TYPE_DATA_STORE_INSTANCE, c.targetEntityType());
            assertEquals(ImportedCandidate.CONFIDENCE_MEDIUM, c.confidence(),
                "BigQuery / AlloyDB classification must be MEDIUM (best-effort)");
        }
        ImportedCandidate bq = cands.stream()
            .filter(c -> "google_bigquery_dataset".equals(c.proposedBinding().iacResourceType()))
            .findFirst().orElseThrow();
        assertEquals("BIGQUERY", bq.proposedEntityFields().get("engine_class"));
    }

    // ============================================================
    // Infrastructure resources -- bucket, pubsub, secret, scheduler, registry
    // ============================================================

    @Test
    void infrastructureResourceFamilies_eachClassifyToCorrectProviderResourceType_andSecretsAreNeverImported() {
        String src = """
            resource "google_storage_bucket" "assets" {
              name          = "assets"
              location      = "EU"
              storage_class = "STANDARD"
            }
            resource "google_pubsub_topic" "events" {
              name = "events"
            }
            resource "google_pubsub_subscription" "events_sub" {
              name  = "events-sub"
              topic = google_pubsub_topic.events.id
            }
            resource "google_secret_manager_secret" "db_password" {
              secret_id   = "db-password"
              secret_data = "this-must-never-be-imported"
            }
            resource "google_cloud_scheduler_job" "nightly" {
              name     = "nightly-job"
              schedule = "0 2 * * *"
              http_target {
                uri = "https://example.com/run"
              }
            }
            resource "google_artifact_registry_repository" "images" {
              repository_id = "images"
              location      = "europe-west1"
              format        = "DOCKER"
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));
        assertEquals(6, cands.size());

        ImportedCandidate bucket = cands.stream()
            .filter(c -> "google_storage_bucket".equals(c.proposedBinding().iacResourceType())).findFirst().orElseThrow();
        assertEquals(ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE, bucket.targetEntityType());
        assertEquals("OBJECT_BUCKET", bucket.proposedEntityFields().get("provider_resource_type"));
        assertEquals("EU", bucket.proposedEntityFields().get("location"));
        assertEquals("STANDARD", bucket.proposedEntityFields().get("storage_class"));

        ImportedCandidate topic = cands.stream()
            .filter(c -> "google_pubsub_topic".equals(c.proposedBinding().iacResourceType())).findFirst().orElseThrow();
        assertEquals("MESSAGE_TOPIC", topic.proposedEntityFields().get("provider_resource_type"));

        ImportedCandidate sub = cands.stream()
            .filter(c -> "google_pubsub_subscription".equals(c.proposedBinding().iacResourceType())).findFirst().orElseThrow();
        assertEquals("MESSAGE_QUEUE", sub.proposedEntityFields().get("provider_resource_type"));
        assertEquals("google_pubsub_topic.events.id",
            String.valueOf(sub.proposedEntityFields().get("topic_ref")));

        ImportedCandidate secret = cands.stream()
            .filter(c -> "google_secret_manager_secret".equals(c.proposedBinding().iacResourceType())).findFirst().orElseThrow();
        assertEquals("SECRET_STORE", secret.proposedEntityFields().get("provider_resource_type"));
        // secret value MUST NEVER be imported, even when literally present
        assertFalse(secret.proposedEntityFields().containsKey("secret_data"),
            "secret_data must never be imported");
        // none of the field values should contain the literal secret string
        for (Object v : secret.proposedEntityFields().values()) {
            if (v != null) {
                assertFalse(String.valueOf(v).contains("this-must-never-be-imported"),
                    "no field may carry the secret value");
            }
        }

        ImportedCandidate sched = cands.stream()
            .filter(c -> "google_cloud_scheduler_job".equals(c.proposedBinding().iacResourceType())).findFirst().orElseThrow();
        assertEquals("SCHEDULER", sched.proposedEntityFields().get("provider_resource_type"));
        assertEquals("0 2 * * *", sched.proposedEntityFields().get("schedule"));
        assertEquals("https://example.com/run", sched.proposedEntityFields().get("target_uri"));

        ImportedCandidate registry = cands.stream()
            .filter(c -> "google_artifact_registry_repository".equals(c.proposedBinding().iacResourceType())).findFirst().orElseThrow();
        assertEquals("ARTIFACT_REGISTRY", registry.proposedEntityFields().get("provider_resource_type"));
        assertEquals("DOCKER", registry.proposedEntityFields().get("format"));
        assertEquals("images", registry.proposedEntityFields().get("name"));
    }

    // ============================================================
    // Composite-LB success
    // ============================================================

    @Test
    void compositeLb_successClosure_emitsOneLoadBalancerAndOneListener() {
        String src = """
            resource "google_compute_global_forwarding_rule" "fwd" {
              name       = "lb-fwd"
              target     = google_compute_target_https_proxy.proxy.id
              port_range = "443"
            }
            resource "google_compute_target_https_proxy" "proxy" {
              name    = "lb-proxy"
              url_map = google_compute_url_map.um.id
            }
            resource "google_compute_url_map" "um" {
              name            = "lb-urlmap"
              default_service = google_compute_backend_service.bs.id
            }
            resource "google_compute_backend_service" "bs" {
              name                  = "lb-backend"
              load_balancing_scheme = "EXTERNAL"
              protocol              = "HTTPS"
            }
            resource "google_compute_region_network_endpoint_group" "neg" {
              name                  = "lb-neg"
              region                = "europe-west1"
              network_endpoint_type = "SERVERLESS"
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        TerraformImportContext ctx = newCtx(file);
        List<ImportedCandidate> cands = newImporter().importResources(ctx);

        // 5 components -> 1 LoadBalancer + 1 Listener
        assertEquals(2, cands.size(), "expected exactly LoadBalancer + Listener after composite grouping");

        ImportedCandidate lb = findFirst(cands, ImportedCandidate.TYPE_LOAD_BALANCER);
        ImportedCandidate lis = findFirst(cands, ImportedCandidate.TYPE_LISTENER);
        assertNotNull(lb, "expected a LoadBalancer candidate");
        assertNotNull(lis, "expected a Listener candidate");

        assertEquals(ImportedCandidate.CONFIDENCE_HIGH, lb.confidence());
        assertEquals(ImportedCandidate.CONFIDENCE_HIGH, lis.confidence());

        // protocol HTTPS, port 443
        assertEquals("HTTPS", lb.proposedEntityFields().get("exposure"));
        assertEquals("HTTPS", lis.proposedEntityFields().get("protocol"));
        assertEquals("443", String.valueOf(lis.proposedEntityFields().get("port")));

        // composite component addresses preserved on the LB candidate
        Object compAddrs = lb.proposedEntityFields().get("composite_component_addresses");
        assertTrue(compAddrs instanceof List, "composite_component_addresses must be a List");
        @SuppressWarnings("unchecked")
        List<String> addrs = (List<String>) compAddrs;
        assertTrue(addrs.contains("google_compute_global_forwarding_rule.fwd"));
        assertTrue(addrs.contains("google_compute_target_https_proxy.proxy"));
        assertTrue(addrs.contains("google_compute_url_map.um"));
        assertTrue(addrs.contains("google_compute_backend_service.bs"));
        assertTrue(addrs.contains("google_compute_region_network_endpoint_group.neg"));

        // No "unrecognised LB pattern" warning on the success path.
        assertFalse(ctx.warnings().stream().anyMatch(w -> w.contains("unrecognised LB pattern")),
            "success path must not emit 'unrecognised LB pattern' warning");
    }

    // ============================================================
    // Composite-LB partial fallback
    // ============================================================

    @Test
    void compositeLb_partial_emitsPerComponentCandidates_andTopLevelWarning() {
        // Only backend service + url map -- missing forwarding_rule, target_proxy, NEG.
        String src = """
            resource "google_compute_backend_service" "bs" {
              name = "lb-backend"
            }
            resource "google_compute_url_map" "um" {
              name            = "lb-urlmap"
              default_service = google_compute_backend_service.bs.id
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        TerraformImportContext ctx = newCtx(file);
        List<ImportedCandidate> cands = newImporter().importResources(ctx);

        // 2 per-component candidates remain in place (as Unsupported with TODO warning).
        assertEquals(2, cands.size());
        // No grouped LB candidate emitted.
        assertNull(findFirst(cands, ImportedCandidate.TYPE_LOAD_BALANCER));
        assertNull(findFirst(cands, ImportedCandidate.TYPE_LISTENER));

        // Each per-component candidate carries the TODO warning.
        for (ImportedCandidate c : cands) {
            boolean hasTodo = c.perCandidateWarnings().stream()
                .anyMatch(w -> w.contains("looks like part of a composite LB"));
            assertTrue(hasTodo, "per-component partial fallback must carry the composite-LB TODO warning");
        }

        // One top-level "unrecognised LB pattern" warning on the result.
        boolean topLevel = ctx.warnings().stream().anyMatch(w -> w.contains("unrecognised LB pattern"));
        assertTrue(topLevel, "expected a top-level 'unrecognised LB pattern' warning");
    }

    // ============================================================
    // Unsupported fallback
    // ============================================================

    @Test
    void unsupportedResourceType_emitsUnsupportedCandidateWithFullSnippetEvidence() {
        String src = """
            resource "google_compute_firewall" "allow_ssh" {
              name    = "allow-ssh"
              network = google_compute_network.vpc.id
              allow {
                protocol = "tcp"
                ports    = ["22"]
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        TerraformImportContext ctx = newCtx(file);
        List<ImportedCandidate> cands = newImporter().importResources(ctx);

        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_UNSUPPORTED, c.targetEntityType());
        assertEquals(ImportedCandidate.CONFIDENCE_LOW, c.confidence());
        assertEquals("google_compute_firewall.allow_ssh", c.proposedBinding().iacAddress());

        // Full HCL snippet preserved on evidence.
        String snippet = c.evidence().rawSnippet();
        assertNotNull(snippet);
        assertTrue(snippet.contains("google_compute_firewall"),
            "raw snippet must contain the resource header");
        assertTrue(snippet.contains("allow-ssh"), "raw snippet must contain the resource fields");

        // Per-candidate warning + top-level warning.
        boolean perCand = c.perCandidateWarnings().stream()
            .anyMatch(w -> w.contains("unsupported resource type: google_compute_firewall"));
        assertTrue(perCand);
        boolean topLevel = ctx.warnings().stream()
            .anyMatch(w -> w.contains("unsupported resource type: google_compute_firewall"));
        assertTrue(topLevel);
    }

    // ============================================================
    // Module-scoped iac_address
    // ============================================================

    @Test
    void resourceInsideModuleBlock_producesModuleScopedIacAddress() {
        // A module block whose nested body is parsed inline (rare but legal
        // -- and the Group 3 walkBlocks pass recurses into module bodies so
        // resources declared inline carry the module prefix).
        String src = """
            module "x" {
              source = "./mod"
              resource "google_compute_network" "vpc" {
                name = "main"
              }
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        TerraformImportContext ctx = newCtx(file);
        List<ImportedCandidate> cands = newImporter().importResources(ctx);

        // Should classify exactly one Network with the module-scoped address.
        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        assertEquals(ImportedCandidate.TYPE_NETWORK, c.targetEntityType());
        assertEquals("module.x.google_compute_network.vpc", c.proposedBinding().iacAddress());
    }

    // ============================================================
    // Confidence bucketing
    // ============================================================

    @Test
    void confidenceBucketing_dropsToMediumWhenUnresolvedRefsPresent() {
        // network attribute is a var.x reference -- unresolved at Group 3.
        String src = """
            resource "google_compute_subnetwork" "app" {
              name          = "app-subnet"
              ip_cidr_range = var.cidr
              region        = "europe-west1"
              network       = "default"
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        List<ImportedCandidate> cands = newImporter().importResources(newCtx(file));
        assertEquals(1, cands.size());
        ImportedCandidate c = cands.get(0);
        // var.cidr is unresolved -> MEDIUM
        assertEquals(ImportedCandidate.CONFIDENCE_MEDIUM, c.confidence());
        assertNotNull(c.evidence().unresolvedExpressionText());
        assertTrue(c.evidence().unresolvedExpressionText().contains("var.cidr"));
    }
}
