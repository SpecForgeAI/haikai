package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclAttribute;
import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;
import com.example.architecturemodel.service.import_.terraform.hcl.HclValue;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * GCP implementation of {@link TerraformImporter}.
 *
 * <p>Inverts the locked GCP mapping table emitted by
 * {@link com.example.architecturemodel.service.export.terraform.GcpTerraformExporter}.
 * Walks every {@link HclBlock} of {@code blockType == "resource"} across all
 * parsed files in the supplied {@link TerraformImportContext}, dispatches on
 * the resource-type label to a per-family classifier, and emits one
 * {@link ImportedCandidate} per resource. After the per-resource pass a
 * composite-LB detection pass rewrites the 5 GCP load-balancer component
 * candidates into a single grouped {@code LoadBalancer} + {@code Listener}
 * candidate when all pieces are present and references resolve; otherwise the
 * per-component candidates remain in place with an "unrecognised LB pattern"
 * top-level warning.
 *
 * <p>The classifier is intentionally pure: it never reads from the database,
 * never throws on unsupported resource types, and surfaces every soft-warn
 * via {@link ImportedCandidate#perCandidateWarnings()} (per-candidate) and
 * {@link TerraformImportContext#warnings()} (result-level). One-hop variable
 * / locals / module resolution and field-precedence reconciliation are out
 * of scope for this group; unresolved references are surfaced verbatim on
 * the {@link ImportedCandidate.Evidence#unresolvedExpressionText()} field
 * so confidence bucketing can downgrade.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 3
 */
@Component
public class GcpTerraformImporter implements TerraformImporter {

    /** Provider id for Spring bean lookup keyed by {@code providerId()}. */
    private static final String PROVIDER_ID = "GCP";

    // The 5 GCP LB component types used by the composite detection pass.
    private static final Set<String> LB_FORWARDING_RULE_TYPES = Set.of(
        "google_compute_global_forwarding_rule",
        "google_compute_forwarding_rule"
    );
    private static final Set<String> LB_TARGET_PROXY_TYPES = Set.of(
        "google_compute_target_http_proxy",
        "google_compute_target_https_proxy"
    );
    private static final String LB_URL_MAP_TYPE = "google_compute_url_map";
    private static final String LB_BACKEND_SERVICE_TYPE = "google_compute_backend_service";
    private static final Set<String> LB_NEG_TYPES = Set.of(
        "google_compute_network_endpoint_group",
        "google_compute_region_network_endpoint_group",
        "google_compute_global_network_endpoint_group"
    );

    @Override
    public String providerId() {
        return PROVIDER_ID;
    }

    @Override
    public List<ImportedCandidate> importResources(TerraformImportContext ctx) {
        List<ImportedCandidate> candidates = new ArrayList<>();
        if (ctx == null || ctx.hclFiles() == null) {
            return candidates;
        }

        // Track which CLOUD_RUN / CLOUD_FUNCTIONS implicit cluster we've already
        // emitted (one-per-import); mirrors the export's "implicit cluster only
        // if not already present" contract.
        Set<String> implicitClusterPlatforms = new HashSet<>();

        for (ParsedHclFile file : ctx.hclFiles()) {
            if (file == null || file.blocks() == null) continue;
            walkBlocks(file, file.blocks(), null, ctx, candidates, implicitClusterPlatforms);
        }

        // Composite-LB detection pass (Q9 try-then-fallback).
        return groupLbComposites(candidates, ctx);
    }

    /**
     * Recursively walk top-level + module-nested blocks, emitting candidates
     * for each {@code resource} block and following {@code module} bodies.
     *
     * @param modulePrefix dotted module path (e.g. {@code "module.network"})
     *     for nested module blocks; {@code null} at the file root.
     */
    private void walkBlocks(
        ParsedHclFile file,
        List<HclBlock> blocks,
        String modulePrefix,
        TerraformImportContext ctx,
        List<ImportedCandidate> out,
        Set<String> implicitClusterPlatforms
    ) {
        for (HclBlock block : blocks) {
            if (block == null) continue;
            String type = block.blockType();
            if ("resource".equals(type)) {
                ImportedCandidate cand = classifyResource(block, file, modulePrefix, ctx, out, implicitClusterPlatforms);
                if (cand != null) {
                    out.add(cand);
                }
            } else if ("module".equals(type)) {
                // Group 3 does not parse the referenced module file (that is
                // Group 4's one-hop module resolution). However, a `module`
                // block may contain its own resources inline (rare but
                // legal); recurse so they pick up the module prefix.
                String name = (block.labels() != null && !block.labels().isEmpty())
                    ? block.labels().get(0)
                    : "anonymous";
                String childPrefix = (modulePrefix == null ? "" : modulePrefix + ".") + "module." + name;
                walkBlocks(file, block.nestedBlocks(), childPrefix, ctx, out, implicitClusterPlatforms);
            }
            // Other top-level blocks (variable / output / locals / provider /
            // data / terraform) are not classified by Group 3.
        }
    }

    /**
     * Dispatch on {@code labels[0]} (the GCP resource type) to the matching
     * classifier. Returns {@code null} when the classifier emitted candidates
     * directly into {@code out} (Cloud Run / Cloud Functions emit 2-3
     * candidates; we add them inline and return null so the caller does not
     * double-add).
     */
    private ImportedCandidate classifyResource(
        HclBlock block,
        ParsedHclFile file,
        String modulePrefix,
        TerraformImportContext ctx,
        List<ImportedCandidate> out,
        Set<String> implicitClusterPlatforms
    ) {
        if (block.labels() == null || block.labels().size() < 2) {
            // malformed resource block; emit unsupported fallback
            return classifyUnsupportedResource(block, file, modulePrefix, ctx, "(missing labels)");
        }
        String resourceType = block.labels().get(0);
        return switch (resourceType) {
            case "google_compute_network" -> classifyComputeNetwork(block, file, modulePrefix, ctx);
            case "google_compute_subnetwork" -> classifyComputeSubnetwork(block, file, modulePrefix, ctx);
            case "google_container_cluster" -> classifyContainerCluster(block, file, modulePrefix, ctx);
            case "google_compute_instance" -> classifyComputeInstance(block, file, modulePrefix, ctx);
            case "google_cloud_run_v2_service" -> {
                classifyCloudRunV2Service(block, file, modulePrefix, ctx, out, implicitClusterPlatforms);
                yield null;
            }
            case "google_cloudfunctions2_function" -> {
                classifyCloudFunctions2Function(block, file, modulePrefix, ctx, out, implicitClusterPlatforms);
                yield null;
            }
            case "google_sql_database_instance" -> classifySqlDatabaseInstance(block, file, modulePrefix, ctx);
            case "google_sql_database" -> classifySqlDatabase(block, file, modulePrefix, ctx);
            case "google_redis_instance" -> classifyRedisInstance(block, file, modulePrefix, ctx);
            case "google_storage_bucket" -> classifyStorageBucket(block, file, modulePrefix, ctx);
            case "google_pubsub_topic" -> classifyPubsubTopic(block, file, modulePrefix, ctx);
            case "google_pubsub_subscription" -> classifyPubsubSubscription(block, file, modulePrefix, ctx);
            case "google_secret_manager_secret" -> classifySecretManagerSecret(block, file, modulePrefix, ctx);
            case "google_cloud_scheduler_job" -> classifyCloudSchedulerJob(block, file, modulePrefix, ctx);
            case "google_artifact_registry_repository" -> classifyArtifactRegistryRepository(block, file, modulePrefix, ctx);
            // BigQuery (best-effort, MEDIUM)
            case "google_bigquery_dataset", "google_bigquery_table" ->
                classifyBigQueryResource(block, file, modulePrefix, ctx);
            // AlloyDB (best-effort, MEDIUM)
            case "google_alloydb_cluster", "google_alloydb_instance", "google_alloydb_backup" ->
                classifyAlloyDbResource(block, file, modulePrefix, ctx);
            // LB component types -- emit per-component placeholder candidates
            // to be grouped (or left in place with warning) by the
            // composite-LB pass.
            case "google_compute_global_forwarding_rule",
                 "google_compute_forwarding_rule",
                 "google_compute_target_http_proxy",
                 "google_compute_target_https_proxy",
                 "google_compute_url_map",
                 "google_compute_backend_service",
                 "google_compute_network_endpoint_group",
                 "google_compute_region_network_endpoint_group",
                 "google_compute_global_network_endpoint_group" ->
                classifyLbComponent(block, file, modulePrefix, ctx);
            default -> classifyUnsupportedResource(block, file, modulePrefix, ctx, null);
        };
    }

    // ========================================================================
    // Networking classifiers
    // ========================================================================

    private ImportedCandidate classifyComputeNetwork(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        String name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        copyIfPresent(block, "description", fields, "description");
        copyIfPresent(block, "routing_mode", fields, "routing_mode");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);

        return buildCandidate(
            ImportedCandidate.TYPE_NETWORK,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyComputeSubnetwork(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        String name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        copyIfPresent(block, "ip_cidr_range", fields, "cidr");
        copyIfPresent(block, "region", fields, "region");
        copyIfPresent(block, "network", fields, "network_ref");
        copyIfPresent(block, "gateway_address", fields, "gateway_address");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);

        return buildCandidate(
            ImportedCandidate.TYPE_SUBNET,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    // ========================================================================
    // Compute classifiers
    // ========================================================================

    private ImportedCandidate classifyContainerCluster(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        String name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        fields.put("provider_resource_type", "KUBERNETES");
        fields.put("platform_type", "KUBERNETES");
        copyIfPresent(block, "location", fields, "location");
        copyIfPresent(block, "region", fields, "region");
        copyIfPresent(block, "network", fields, "network_ref");
        copyIfPresent(block, "min_master_version", fields, "version");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);

        // Capture node_pool blocks as evidence comments (NOT first-class
        // candidates per the export's contract).
        if (block.nestedBlocks() != null) {
            for (HclBlock nested : block.nestedBlocks()) {
                if (nested == null) continue;
                if ("node_pool".equals(nested.blockType())) {
                    String npName = stringAttr(nested, "name", "(unnamed)");
                    warnings.add("# Node pool: " + npName);
                }
            }
        }

        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_COMPUTE_CLUSTER,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyComputeInstance(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        String name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        fields.put("provider_resource_type", "VM");
        fields.put("compute_type", "VM");
        copyIfPresent(block, "machine_type", fields, "machine_type");
        copyIfPresent(block, "zone", fields, "zone");
        copyIfPresent(block, "region", fields, "region");

        // boot_disk.initialize_params.image -> image hint
        HclBlock bootDisk = findNestedBlock(block, "boot_disk");
        if (bootDisk != null) {
            HclBlock initParams = findNestedBlock(bootDisk, "initialize_params");
            if (initParams != null) {
                Object image = readAttrValue(initParams, "image");
                if (image != null) {
                    fields.put("image", image);
                }
            }
        }

        // network_interface[0].subnetwork -> subnet ref
        HclBlock netIf = findNestedBlock(block, "network_interface");
        if (netIf != null) {
            Object subnetwork = readAttrValue(netIf, "subnetwork");
            if (subnetwork != null) {
                fields.put("subnetwork_ref", subnetwork);
            }
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_COMPUTE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private void classifyCloudRunV2Service(
        HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx,
        List<ImportedCandidate> out, Set<String> implicitClusterPlatforms
    ) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        String name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        fields.put("provider_resource_type", "CLOUD_RUN_SERVICE");
        fields.put("compute_type", "CLOUD_RUN_SERVICE");
        copyIfPresent(block, "location", fields, "location");

        // template.containers[0].image -> container image
        Object imageVal = null;
        HclBlock template = findNestedBlock(block, "template");
        if (template != null) {
            HclBlock containers = findNestedBlock(template, "containers");
            if (containers != null) {
                imageVal = readAttrValue(containers, "image");
                if (imageVal != null) {
                    fields.put("image", imageVal);
                }
            }
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        out.add(buildCandidate(
            ImportedCandidate.TYPE_COMPUTE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        ));

        // Implicit ComputeCluster (CLOUD_RUN) when not already present.
        if (!implicitClusterPlatforms.contains("CLOUD_RUN") && !hasCloudRunCluster(out)) {
            implicitClusterPlatforms.add("CLOUD_RUN");
            Map<String, Object> clusterFields = new LinkedHashMap<>();
            clusterFields.put("name", "cloud-run-cluster");
            clusterFields.put("provider_resource_type", "CLOUD_RUN");
            clusterFields.put("platform_type", "CLOUD_RUN");
            clusterFields.put("implicit", Boolean.TRUE);
            ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
                file.filePath(), block.startLine(), block.endLine(),
                rawSnippet(block, file),
                null
            );
            ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
                resourceAddress("google_cloud_run_v2_service", resourceName, modulePrefix) + "_cluster",
                "implicit_cloud_run_cluster",
                resourceName + "_cluster",
                PROVIDER_ID,
                file.filePath(), block.startLine(), block.endLine(),
                null,
                ImportedCandidate.CONFIDENCE_HIGH
            );
            out.add(ImportedCandidate.of(
                ImportedCandidate.TYPE_COMPUTE_CLUSTER,
                clusterFields,
                pb,
                ImportedCandidate.CONFIDENCE_HIGH,
                List.of("implicit ComputeCluster (CLOUD_RUN) inferred from Cloud Run service '" + name + "'"),
                ev
            ));
        }

        // DeploymentUnit candidate from container image (only when image present).
        if (imageVal != null) {
            Map<String, Object> duFields = new LinkedHashMap<>();
            duFields.put("name", name + "-deployment-unit");
            duFields.put("image", imageVal);
            duFields.put("parent_compute_resource_address", resourceAddress("google_cloud_run_v2_service", resourceName, modulePrefix));
            ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
                file.filePath(), block.startLine(), block.endLine(),
                rawSnippet(block, file),
                null
            );
            ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
                resourceAddress("google_cloud_run_v2_service", resourceName, modulePrefix) + "_du",
                "deployment_unit",
                resourceName + "_du",
                PROVIDER_ID,
                file.filePath(), block.startLine(), block.endLine(),
                null,
                ImportedCandidate.CONFIDENCE_HIGH
            );
            out.add(ImportedCandidate.of(
                ImportedCandidate.TYPE_DEPLOYMENT_UNIT,
                duFields,
                pb,
                ImportedCandidate.CONFIDENCE_HIGH,
                List.of("DeploymentUnit inferred from container image; relationship 'Deployment Unit runs on Compute' to parent CR"),
                ev
            ));
        }
    }

    private void classifyCloudFunctions2Function(
        HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx,
        List<ImportedCandidate> out, Set<String> implicitClusterPlatforms
    ) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        String name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        fields.put("provider_resource_type", "FUNCTION");
        fields.put("compute_type", "FUNCTION");
        copyIfPresent(block, "location", fields, "location");

        // build_config.source -> function source
        Object sourceVal = null;
        HclBlock buildConfig = findNestedBlock(block, "build_config");
        if (buildConfig != null) {
            sourceVal = readAttrValue(buildConfig, "source");
            if (sourceVal == null) {
                HclBlock src = findNestedBlock(buildConfig, "source");
                if (src != null) {
                    sourceVal = "source { ... }";
                }
            }
        }
        // top-level "source" attribute fallback
        if (sourceVal == null) {
            sourceVal = readAttrValue(block, "source");
        }
        if (sourceVal != null) {
            fields.put("source", sourceVal);
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        out.add(buildCandidate(
            ImportedCandidate.TYPE_COMPUTE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        ));

        // Implicit ComputeCluster (CLOUD_FUNCTIONS) when not already present.
        if (!implicitClusterPlatforms.contains("CLOUD_FUNCTIONS") && !hasCloudFunctionsCluster(out)) {
            implicitClusterPlatforms.add("CLOUD_FUNCTIONS");
            Map<String, Object> clusterFields = new LinkedHashMap<>();
            clusterFields.put("name", "cloud-functions-cluster");
            clusterFields.put("provider_resource_type", "CLOUD_FUNCTIONS");
            clusterFields.put("platform_type", "CLOUD_FUNCTIONS");
            clusterFields.put("implicit", Boolean.TRUE);
            ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
                file.filePath(), block.startLine(), block.endLine(),
                rawSnippet(block, file),
                null
            );
            ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
                resourceAddress("google_cloudfunctions2_function", resourceName, modulePrefix) + "_cluster",
                "implicit_cloud_functions_cluster",
                resourceName + "_cluster",
                PROVIDER_ID,
                file.filePath(), block.startLine(), block.endLine(),
                null,
                ImportedCandidate.CONFIDENCE_HIGH
            );
            out.add(ImportedCandidate.of(
                ImportedCandidate.TYPE_COMPUTE_CLUSTER,
                clusterFields,
                pb,
                ImportedCandidate.CONFIDENCE_HIGH,
                List.of("implicit ComputeCluster (CLOUD_FUNCTIONS) inferred from function '" + name + "'"),
                ev
            ));
        }

        // DeploymentUnit candidate from function source.
        if (sourceVal != null) {
            Map<String, Object> duFields = new LinkedHashMap<>();
            duFields.put("name", name + "-deployment-unit");
            duFields.put("source", sourceVal);
            duFields.put("parent_compute_resource_address", resourceAddress("google_cloudfunctions2_function", resourceName, modulePrefix));
            ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
                file.filePath(), block.startLine(), block.endLine(),
                rawSnippet(block, file),
                null
            );
            ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
                resourceAddress("google_cloudfunctions2_function", resourceName, modulePrefix) + "_du",
                "deployment_unit",
                resourceName + "_du",
                PROVIDER_ID,
                file.filePath(), block.startLine(), block.endLine(),
                null,
                ImportedCandidate.CONFIDENCE_HIGH
            );
            out.add(ImportedCandidate.of(
                ImportedCandidate.TYPE_DEPLOYMENT_UNIT,
                duFields,
                pb,
                ImportedCandidate.CONFIDENCE_HIGH,
                List.of("DeploymentUnit inferred from function source; relationship 'Deployment Unit runs on Compute' to parent CR"),
                ev
            ));
        }
    }

    // ========================================================================
    // Load-balancer per-component classifier (composite pass groups them)
    // ========================================================================

    private ImportedCandidate classifyLbComponent(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceType = block.labels().get(0);
        String resourceName = block.labels().get(1);
        fields.put("lb_component_resource_type", resourceType);
        fields.put("name", stringAttr(block, "name", resourceName));
        // preserve all attributes verbatim so the composite pass / future
        // resolution group can read them.
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            fields.putIfAbsent(attr.name(), describeValue(attr.value()));
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        // Per-component LB candidates default to MEDIUM confidence per the
        // spec's fallback rule; the composite pass upgrades the grouped
        // LoadBalancer + Listener candidates to HIGH on success.
        BigDecimal confidence = ImportedCandidate.CONFIDENCE_MEDIUM;
        return buildCandidate(
            ImportedCandidate.TYPE_LOAD_BALANCER + "Component",
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    // ========================================================================
    // Data-store classifiers
    // ========================================================================

    private ImportedCandidate classifySqlDatabaseInstance(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("engine_class", "RELATIONAL");
        copyIfPresent(block, "database_version", fields, "database_version");
        copyIfPresent(block, "region", fields, "region");
        // host hint via "settings" / "ip_configuration" not always present;
        // surface what we can find at top level.
        copyIfPresent(block, "host", fields, "host");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_DATA_STORE_INSTANCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifySqlDatabase(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("engine_class", "RELATIONAL");
        fields.put("database_level", Boolean.TRUE);
        // preserve the parent instance reference verbatim
        Object parentInstance = readAttrValue(block, "instance");
        if (parentInstance != null) {
            fields.put("parentInstanceRef", parentInstance);
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_DATA_STORE_INSTANCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyRedisInstance(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        // Spec.md picked DataStoreInstance (engine class = CACHE) -- mirror exporter.
        fields.put("engine_class", "CACHE");
        fields.put("engine", "REDIS");
        copyIfPresent(block, "tier", fields, "tier");
        copyIfPresent(block, "memory_size_gb", fields, "memory_size_gb");
        copyIfPresent(block, "region", fields, "region");
        copyIfPresent(block, "host", fields, "host");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_DATA_STORE_INSTANCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyBigQueryResource(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceType = block.labels().get(0);
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("engine_class", "BIGQUERY");
        fields.put("bigquery_resource_type", resourceType);
        // copy the few BQ-specific attributes that are commonly present
        copyIfPresent(block, "dataset_id", fields, "dataset_id");
        copyIfPresent(block, "table_id", fields, "table_id");
        copyIfPresent(block, "location", fields, "location");

        List<String> warnings = new ArrayList<>();
        warnings.add("BigQuery best-effort classification; review fields before approve");
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        // Spec: BigQuery / AlloyDB are best-effort, MEDIUM confidence.
        return buildCandidate(
            ImportedCandidate.TYPE_DATA_STORE_INSTANCE,
            fields,
            block, file, modulePrefix,
            ImportedCandidate.CONFIDENCE_MEDIUM, warnings, unresolved
        );
    }

    private ImportedCandidate classifyAlloyDbResource(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceType = block.labels().get(0);
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("engine_class", "RELATIONAL");
        fields.put("engine", "ALLOYDB");
        fields.put("alloydb_resource_type", resourceType);
        copyIfPresent(block, "cluster_id", fields, "cluster_id");
        copyIfPresent(block, "instance_id", fields, "instance_id");
        copyIfPresent(block, "location", fields, "location");

        List<String> warnings = new ArrayList<>();
        warnings.add("AlloyDB best-effort classification; review fields before approve");
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        return buildCandidate(
            ImportedCandidate.TYPE_DATA_STORE_INSTANCE,
            fields,
            block, file, modulePrefix,
            ImportedCandidate.CONFIDENCE_MEDIUM, warnings, unresolved
        );
    }

    // ========================================================================
    // Infrastructure-resource classifiers
    // ========================================================================

    private ImportedCandidate classifyStorageBucket(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("provider_resource_type", "OBJECT_BUCKET");
        copyIfPresent(block, "location", fields, "location");
        copyIfPresent(block, "storage_class", fields, "storage_class");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyPubsubTopic(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("provider_resource_type", "MESSAGE_TOPIC");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyPubsubSubscription(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("provider_resource_type", "MESSAGE_QUEUE");
        // preserve parent topic reference verbatim
        Object topicRef = readAttrValue(block, "topic");
        if (topicRef != null) {
            fields.put("topic_ref", topicRef);
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifySecretManagerSecret(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        // secret_id is the GCP-canonical identifier; fall back to name attr / label.
        Object secretId = readAttrValue(block, "secret_id");
        if (secretId == null) {
            secretId = stringAttr(block, "name", resourceName);
        }
        fields.put("name", secretId);
        fields.put("provider_resource_type", "SECRET_STORE");
        // NEVER import secret values: explicitly drop any secret_data /
        // payload / data attribute. Filter at field-extraction time.
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            String n = attr.name();
            if (n == null) continue;
            if (n.equals("secret_data") || n.equals("payload")
                || n.equals("data") || n.toLowerCase().contains("secret_value")) {
                // skip -- never imported
                continue;
            }
            if (n.equals("secret_id") || n.equals("name")) continue; // already set
            fields.putIfAbsent(n, describeValue(attr.value()));
        }

        List<String> warnings = new ArrayList<>();
        warnings.add("secret values are never imported (filtered at field-extraction time)");
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyCloudSchedulerJob(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        fields.put("name", stringAttr(block, "name", resourceName));
        fields.put("provider_resource_type", "SCHEDULER");
        copyIfPresent(block, "schedule", fields, "schedule");
        // target may live in nested http_target / pubsub_target blocks
        HclBlock httpTarget = findNestedBlock(block, "http_target");
        if (httpTarget != null) {
            Object uri = readAttrValue(httpTarget, "uri");
            if (uri != null) fields.put("target_uri", uri);
        }
        HclBlock pubsubTarget = findNestedBlock(block, "pubsub_target");
        if (pubsubTarget != null) {
            Object topicName = readAttrValue(pubsubTarget, "topic_name");
            if (topicName != null) fields.put("target_topic", topicName);
        }

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    private ImportedCandidate classifyArtifactRegistryRepository(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceName = block.labels().get(1);
        // artifact registry uses "repository_id" / "name" for the canonical id
        Object name = readAttrValue(block, "repository_id");
        if (name == null) name = stringAttr(block, "name", resourceName);
        fields.put("name", name);
        fields.put("provider_resource_type", "ARTIFACT_REGISTRY");
        copyIfPresent(block, "location", fields, "location");
        copyIfPresent(block, "format", fields, "format");

        List<String> warnings = new ArrayList<>();
        String unresolved = collectUnresolvedRefs(block, fields, warnings);
        BigDecimal confidence = bucketConfidence(true, unresolved == null, ctx);
        return buildCandidate(
            ImportedCandidate.TYPE_INFRASTRUCTURE_RESOURCE,
            fields,
            block, file, modulePrefix,
            confidence, warnings, unresolved
        );
    }

    // ========================================================================
    // Unsupported-fallback classifier
    // ========================================================================

    private ImportedCandidate classifyUnsupportedResource(HclBlock block, ParsedHclFile file, String modulePrefix, TerraformImportContext ctx, String reason) {
        Map<String, Object> fields = new LinkedHashMap<>();
        String resourceType = block.labels() != null && !block.labels().isEmpty()
            ? block.labels().get(0) : "(unknown)";
        String resourceName = block.labels() != null && block.labels().size() >= 2
            ? block.labels().get(1) : "(unnamed)";
        fields.put("resource_type", resourceType);
        fields.put("resource_name", resourceName);
        // preserve every attribute verbatim
        if (block.attributes() != null) {
            for (HclAttribute attr : block.attributes()) {
                if (attr == null || attr.name() == null) continue;
                fields.putIfAbsent(attr.name(), describeValue(attr.value()));
            }
        }
        String warning = "unsupported resource type: " + resourceType
            + (reason == null ? "" : " (" + reason + ")")
            + "; preserved as TODO";
        List<String> warnings = new ArrayList<>();
        warnings.add(warning);
        if (ctx != null) {
            ctx.addWarning(warning + " at " + file.filePath() + ":" + block.startLine());
        }

        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            file.filePath(), block.startLine(), block.endLine(),
            rawSnippet(block, file),
            null
        );
        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            resourceAddress(resourceType, resourceName, modulePrefix),
            resourceType, resourceName,
            PROVIDER_ID,
            file.filePath(), block.startLine(), block.endLine(),
            null,
            ImportedCandidate.CONFIDENCE_LOW
        );
        return ImportedCandidate.of(
            ImportedCandidate.TYPE_UNSUPPORTED,
            fields,
            pb,
            ImportedCandidate.CONFIDENCE_LOW,
            warnings,
            ev
        );
    }

    // ========================================================================
    // Composite-LB grouping pass
    // ========================================================================

    private List<ImportedCandidate> groupLbComposites(List<ImportedCandidate> candidates, TerraformImportContext ctx) {
        // Partition candidates into LB components vs everything else.
        List<ImportedCandidate> lbComponents = new ArrayList<>();
        List<ImportedCandidate> rest = new ArrayList<>();
        for (ImportedCandidate c : candidates) {
            if (c == null) continue;
            if ((ImportedCandidate.TYPE_LOAD_BALANCER + "Component").equals(c.targetEntityType())) {
                lbComponents.add(c);
            } else {
                rest.add(c);
            }
        }

        if (lbComponents.isEmpty()) {
            return candidates;
        }

        // Index components by LB resource type bucket.
        boolean hasFwdRule = lbComponents.stream().anyMatch(c -> LB_FORWARDING_RULE_TYPES.contains(componentResourceType(c)));
        boolean hasTargetProxy = lbComponents.stream().anyMatch(c -> LB_TARGET_PROXY_TYPES.contains(componentResourceType(c)));
        boolean hasUrlMap = lbComponents.stream().anyMatch(c -> LB_URL_MAP_TYPE.equals(componentResourceType(c)));
        boolean hasBackendService = lbComponents.stream().anyMatch(c -> LB_BACKEND_SERVICE_TYPE.equals(componentResourceType(c)));
        boolean hasNeg = lbComponents.stream().anyMatch(c -> LB_NEG_TYPES.contains(componentResourceType(c)));

        // Composite success requires all 5 (NEG required per the spec). The
        // task spec calls out NEG as one of the 5 mandatory components.
        boolean allFive = hasFwdRule && hasTargetProxy && hasUrlMap && hasBackendService && hasNeg;

        if (allFive && lbReferencesResolve(lbComponents)) {
            // Build the grouped LoadBalancer + Listener candidates.
            ImportedCandidate forwardingRule = lbComponents.stream()
                .filter(c -> LB_FORWARDING_RULE_TYPES.contains(componentResourceType(c)))
                .findFirst().orElse(null);
            ImportedCandidate targetProxy = lbComponents.stream()
                .filter(c -> LB_TARGET_PROXY_TYPES.contains(componentResourceType(c)))
                .findFirst().orElse(null);
            ImportedCandidate urlMap = lbComponents.stream()
                .filter(c -> LB_URL_MAP_TYPE.equals(componentResourceType(c)))
                .findFirst().orElse(null);
            ImportedCandidate backendService = lbComponents.stream()
                .filter(c -> LB_BACKEND_SERVICE_TYPE.equals(componentResourceType(c)))
                .findFirst().orElse(null);
            ImportedCandidate neg = lbComponents.stream()
                .filter(c -> LB_NEG_TYPES.contains(componentResourceType(c)))
                .findFirst().orElse(null);

            // LoadBalancer fields
            Map<String, Object> lbFields = new LinkedHashMap<>();
            String lbName = String.valueOf(forwardingRule.proposedEntityFields().getOrDefault("name", "lb"));
            lbFields.put("name", lbName);
            String proxyType = componentResourceType(targetProxy);
            String protocol = "google_compute_target_https_proxy".equals(proxyType) ? "HTTPS" : "HTTP";
            lbFields.put("exposure", protocol);
            // forwarding-rule port -> listener port
            Object portRange = forwardingRule.proposedEntityFields().get("port_range");
            if (portRange != null) {
                lbFields.put("port", portRange);
            }
            // composite component bindings
            List<String> componentAddresses = new ArrayList<>();
            componentAddresses.add(forwardingRule.proposedBinding().iacAddress());
            componentAddresses.add(targetProxy.proposedBinding().iacAddress());
            componentAddresses.add(urlMap.proposedBinding().iacAddress());
            componentAddresses.add(backendService.proposedBinding().iacAddress());
            componentAddresses.add(neg.proposedBinding().iacAddress());
            lbFields.put("composite_component_addresses", componentAddresses);

            ImportedCandidate.Evidence lbEv = new ImportedCandidate.Evidence(
                forwardingRule.evidence().filePath(),
                forwardingRule.evidence().startLine(),
                forwardingRule.evidence().endLine(),
                forwardingRule.evidence().rawSnippet(),
                null
            );
            ImportedCandidate lbCandidate = ImportedCandidate.of(
                ImportedCandidate.TYPE_LOAD_BALANCER,
                lbFields,
                forwardingRule.proposedBinding(),
                ImportedCandidate.CONFIDENCE_HIGH,
                List.of("composite LB grouped from 5 components: " + String.join(", ", componentAddresses)),
                lbEv
            );

            // Listener fields driven by url-map host/path rules + forwarding port + target proxy protocol
            Map<String, Object> listenerFields = new LinkedHashMap<>();
            listenerFields.put("name", lbName + "-listener");
            listenerFields.put("protocol", protocol);
            if (portRange != null) {
                listenerFields.put("port", portRange);
            }
            // Surface url-map host/path rules verbatim if present
            Object hostRules = urlMap.proposedEntityFields().get("host_rule");
            if (hostRules != null) {
                listenerFields.put("host_rule", hostRules);
            }
            Object pathMatcher = urlMap.proposedEntityFields().get("path_matcher");
            if (pathMatcher != null) {
                listenerFields.put("path_matcher", pathMatcher);
            }

            ImportedCandidate.Evidence listenerEv = new ImportedCandidate.Evidence(
                urlMap.evidence().filePath(),
                urlMap.evidence().startLine(),
                urlMap.evidence().endLine(),
                urlMap.evidence().rawSnippet(),
                null
            );
            ImportedCandidate listenerCandidate = ImportedCandidate.of(
                ImportedCandidate.TYPE_LISTENER,
                listenerFields,
                urlMap.proposedBinding(),
                ImportedCandidate.CONFIDENCE_HIGH,
                List.of("composite LB Listener inferred from URL map + target proxy + forwarding rule"),
                listenerEv
            );

            // Replace the 5 component candidates with the 2 grouped candidates.
            List<ImportedCandidate> result = new ArrayList<>(rest);
            result.add(lbCandidate);
            result.add(listenerCandidate);
            return result;
        }

        // Partial: per-component candidates remain in place; flag each as
        // possibly-part-of-LB AND emit one top-level result warning.
        List<String> missing = new ArrayList<>();
        if (!hasFwdRule) missing.add("forwarding_rule");
        if (!hasTargetProxy) missing.add("target_proxy");
        if (!hasUrlMap) missing.add("url_map");
        if (!hasBackendService) missing.add("backend_service");
        if (!hasNeg) missing.add("network_endpoint_group");
        String closureSummary = "missing: " + String.join(", ", missing);
        if (ctx != null) {
            ctx.addWarning("unrecognised LB pattern at " + closureSummary);
        }

        List<ImportedCandidate> result = new ArrayList<>(rest);
        for (ImportedCandidate c : lbComponents) {
            // re-emit each component as an Unsupported-style candidate with a TODO.
            List<String> w = new ArrayList<>(c.perCandidateWarnings());
            w.add("this looks like part of a composite LB; consider creating a parent LoadBalancer entity manually");
            result.add(new ImportedCandidate(
                c.candidateId(),
                ImportedCandidate.TYPE_UNSUPPORTED,
                c.proposedEntityFields(),
                c.proposedBinding(),
                ImportedCandidate.CONFIDENCE_MEDIUM,
                w,
                c.evidence(),
                c.ignored()
            ));
        }
        return result;
    }

    /** Best-effort check that LB component references resolve into the bag. */
    private boolean lbReferencesResolve(List<ImportedCandidate> lbComponents) {
        // For Group 3 we treat presence of all 5 component types as "refs
        // resolve". Group 4 will tighten this with full ref-graph resolution.
        return lbComponents.size() >= 5;
    }

    private static String componentResourceType(ImportedCandidate c) {
        Object v = c.proposedEntityFields().get("lb_component_resource_type");
        return v == null ? "" : v.toString();
    }

    // ========================================================================
    // Helpers
    // ========================================================================

    /**
     * Build the address string used for {@code iac_address} +
     * {@code IaCResourceBinding.iac_address}. Top-level form
     * {@code <type>.<name>}; module-scoped form
     * {@code module.<m>.<type>.<name>}. Round-trip stability with the export
     * is the locked contract.
     */
    private static String resourceAddress(String resourceType, String resourceName, String modulePrefix) {
        String base = resourceType + "." + resourceName;
        if (modulePrefix == null || modulePrefix.isBlank()) {
            return base;
        }
        return modulePrefix + "." + base;
    }

    private static ImportedCandidate buildCandidate(
        String targetEntityType,
        Map<String, Object> fields,
        HclBlock block,
        ParsedHclFile file,
        String modulePrefix,
        BigDecimal confidence,
        List<String> warnings,
        String unresolvedExpressionText
    ) {
        String resourceType = block.labels().get(0);
        String resourceName = block.labels().size() >= 2 ? block.labels().get(1) : "(unnamed)";
        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            file.filePath(), block.startLine(), block.endLine(),
            rawSnippet(block, file),
            unresolvedExpressionText
        );
        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            resourceAddress(resourceType, resourceName, modulePrefix),
            resourceType,
            resourceName,
            PROVIDER_ID,
            file.filePath(), block.startLine(), block.endLine(),
            null,
            confidence
        );
        return ImportedCandidate.of(
            targetEntityType,
            fields,
            pb,
            confidence,
            warnings,
            ev
        );
    }

    /** Extract the raw HCL slice for the block from the file's source content. */
    private static String rawSnippet(HclBlock block, ParsedHclFile file) {
        if (file == null || file.rawContent() == null) return "";
        String[] lines = file.rawContent().split("\\R", -1);
        int from = Math.max(1, block.startLine()) - 1;
        int to = Math.min(lines.length, block.endLine());
        if (from >= lines.length) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = from; i < to; i++) {
            sb.append(lines[i]);
            if (i < to - 1) sb.append("\n");
        }
        return sb.toString();
    }

    private static String stringAttr(HclBlock block, String attrName, String fallback) {
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            if (attrName.equals(attr.name())) {
                HclValue v = attr.value();
                if (v instanceof HclValue.StringValue sv) {
                    return sv.value();
                }
                return v.rawText();
            }
        }
        return fallback;
    }

    /**
     * Read an attribute value as a typed object (String for string literals,
     * BigDecimal for numbers, Boolean for bools, raw expression for refs and
     * unsupported expressions). Returns {@code null} when the attribute is
     * not present.
     */
    private static Object readAttrValue(HclBlock block, String attrName) {
        if (block == null) return null;
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            if (attrName.equals(attr.name())) {
                return describeValue(attr.value());
            }
        }
        return null;
    }

    private static Object describeValue(HclValue v) {
        if (v == null) return null;
        if (v instanceof HclValue.StringValue sv) return sv.value();
        if (v instanceof HclValue.NumberValue nv) return nv.value();
        if (v instanceof HclValue.BoolValue bv) return bv.value();
        if (v instanceof HclValue.ListValue lv) {
            List<Object> items = new ArrayList<>();
            for (HclValue x : lv.items()) items.add(describeValue(x));
            return items;
        }
        if (v instanceof HclValue.MapValue mv) {
            Map<String, Object> m = new LinkedHashMap<>();
            for (Map.Entry<String, HclValue> e : mv.entries().entrySet()) {
                m.put(e.getKey(), describeValue(e.getValue()));
            }
            return m;
        }
        if (v instanceof HclValue.ReferenceValue rv) {
            // Preserve the raw expression text -- Group 4 will resolve.
            return rv.rawExpression();
        }
        if (v instanceof HclValue.RawValue rw) {
            return rw.rawText();
        }
        return v.rawText();
    }

    private static void copyIfPresent(HclBlock block, String srcAttr, Map<String, Object> fields, String destKey) {
        Object v = readAttrValue(block, srcAttr);
        if (v != null) {
            fields.put(destKey, v);
        }
    }

    private static HclBlock findNestedBlock(HclBlock parent, String type) {
        if (parent == null || parent.nestedBlocks() == null) return null;
        for (HclBlock b : parent.nestedBlocks()) {
            if (b == null) continue;
            if (type.equals(b.blockType())) return b;
        }
        return null;
    }

    /**
     * Walk every attribute (incl. nested-block attributes) collecting
     * unresolved {@link HclValue.ReferenceValue} or {@link HclValue.RawValue}
     * expressions; appends a per-candidate warning per unresolved ref and
     * returns the concatenated unresolved-expression text (or {@code null}
     * when none).
     */
    private static String collectUnresolvedRefs(HclBlock block, Map<String, Object> fields, List<String> warnings) {
        List<String> unresolvedTexts = new ArrayList<>();
        collectUnresolvedRefs(block, unresolvedTexts, warnings, "");
        if (unresolvedTexts.isEmpty()) return null;
        return String.join("; ", unresolvedTexts);
    }

    private static void collectUnresolvedRefs(HclBlock block, List<String> unresolvedTexts, List<String> warnings, String pathPrefix) {
        if (block.attributes() != null) {
            for (HclAttribute attr : block.attributes()) {
                if (attr == null) continue;
                String full = pathPrefix.isEmpty() ? attr.name() : pathPrefix + "." + attr.name();
                checkValueUnresolved(attr.value(), full, unresolvedTexts, warnings);
            }
        }
        if (block.nestedBlocks() != null) {
            for (HclBlock nested : block.nestedBlocks()) {
                if (nested == null) continue;
                String np = pathPrefix.isEmpty() ? nested.blockType() : pathPrefix + "." + nested.blockType();
                collectUnresolvedRefs(nested, unresolvedTexts, warnings, np);
            }
        }
    }

    private static void checkValueUnresolved(HclValue v, String attrPath, List<String> unresolvedTexts, List<String> warnings) {
        if (v == null) return;
        if (v instanceof HclValue.ReferenceValue rv) {
            String text = rv.rawExpression();
            // var.x / local.x / module.* / <resource>.<name>.<attr> are all
            // unresolved at Group 3 (Group 4 resolves one-hop var/local).
            unresolvedTexts.add(attrPath + "=" + text);
            warnings.add(attrPath + " ref `" + text + "` unresolved");
        } else if (v instanceof HclValue.RawValue rw) {
            String text = rw.rawText();
            if (text != null && !text.isBlank()) {
                unresolvedTexts.add(attrPath + "=" + text);
                warnings.add(attrPath + " expression `" + text + "` unresolved (function/template/for/ternary)");
            }
        } else if (v instanceof HclValue.ListValue lv) {
            int i = 0;
            for (HclValue x : lv.items()) {
                checkValueUnresolved(x, attrPath + "[" + i + "]", unresolvedTexts, warnings);
                i++;
            }
        } else if (v instanceof HclValue.MapValue mv) {
            for (Map.Entry<String, HclValue> e : mv.entries().entrySet()) {
                checkValueUnresolved(e.getValue(), attrPath + "." + e.getKey(), unresolvedTexts, warnings);
            }
        }
    }

    /**
     * Confidence bucketing rule (spec.md Q8):
     * <ul>
     *   <li>HIGH when the resource is in the GCP mapping table AND zero
     *       unresolved refs AND env/region known.</li>
     *   <li>MEDIUM when mapped but unresolved refs OR env/region not inferred.</li>
     *   <li>LOW when unmapped (handled at the unsupported classifier).</li>
     * </ul>
     */
    private static BigDecimal bucketConfidence(boolean inMappingTable, boolean noUnresolvedRefs, TerraformImportContext ctx) {
        if (!inMappingTable) {
            return ImportedCandidate.CONFIDENCE_LOW;
        }
        boolean envKnown = ctx != null && ctx.environmentId() != null && !ctx.environmentId().isBlank();
        boolean locationKnown = ctx != null && ctx.locationId() != null && !ctx.locationId().isBlank();
        if (noUnresolvedRefs && envKnown && locationKnown) {
            return ImportedCandidate.CONFIDENCE_HIGH;
        }
        return ImportedCandidate.CONFIDENCE_MEDIUM;
    }

    private static boolean hasCloudRunCluster(List<ImportedCandidate> existing) {
        for (ImportedCandidate c : existing) {
            if (c == null) continue;
            if (ImportedCandidate.TYPE_COMPUTE_CLUSTER.equals(c.targetEntityType())
                && "CLOUD_RUN".equals(String.valueOf(c.proposedEntityFields().get("provider_resource_type")))) {
                return true;
            }
        }
        return false;
    }

    private static boolean hasCloudFunctionsCluster(List<ImportedCandidate> existing) {
        for (ImportedCandidate c : existing) {
            if (c == null) continue;
            if (ImportedCandidate.TYPE_COMPUTE_CLUSTER.equals(c.targetEntityType())
                && "CLOUD_FUNCTIONS".equals(String.valueOf(c.proposedEntityFields().get("provider_resource_type")))) {
                return true;
            }
        }
        return false;
    }
}
