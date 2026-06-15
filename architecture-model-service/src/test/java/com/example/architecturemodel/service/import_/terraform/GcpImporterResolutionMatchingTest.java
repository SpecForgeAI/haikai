package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;
import com.example.architecturemodel.service.import_.terraform.hcl.HclSourceFile;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests covering Task Group 4 (resolution + matching + relationship inference)
 * + the carry-forward Task 3.8 (context inference).
 *
 * <p>Bundled into a single test class to keep the targeted-test invocation
 * small. Each {@code @Test} method exercises one resolver / matcher /
 * inferrer concern end-to-end against a small parsed HCL fixture.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 4.1
 */
class GcpImporterResolutionMatchingTest {

    // ============================================================
    // Plumbing helpers
    // ============================================================

    private static ParsedHclFile parse(String filePath, String src) {
        return HclSourceFile.parse(filePath, src, new ArrayList<>());
    }

    private static TerraformImportContext newCtx(
        List<ParsedHclFile> files,
        String envId, String cloudAcctId, String locId
    ) {
        return new TerraformImportContext(
            files, null,
            envId, cloudAcctId, locId,
            "GCP",
            null, null, null, null, null
        );
    }

    private static TerraformImportContext newCtxWithModel(
        List<ParsedHclFile> files,
        MetaModelDto model
    ) {
        return new TerraformImportContext(
            files, model,
            "env-1", "ca-1", "loc-1",
            "GCP",
            null, null, null, null, null
        );
    }

    private static TerraformImportContext newCtxWithFormFields(
        List<ParsedHclFile> files,
        String repositoryUrl, String branch, String commitSha,
        String path, String workspace
    ) {
        return new TerraformImportContext(
            files, null,
            "env-1", "ca-1", "loc-1",
            "GCP",
            repositoryUrl, branch, commitSha, path, workspace
        );
    }

    // ============================================================
    // VariableResolver tests
    // ============================================================

    @Test
    void variableResolver_userOption_winsOverDefault() {
        // variable "branch" { default = "develop" } in HCL, but user supplied
        // branch="main" via the form fields. User option wins (priority 1).
        String src = """
            variable "branch" {
              default = "develop"
            }
            """;
        ParsedHclFile file = parse("variables.tf", src);
        TerraformImportContext ctx = newCtxWithFormFields(
            List.of(file),
            "https://example.com/repo.git",
            "main",         // user supplied branch
            null, null, null
        );

        Optional<Object> resolved = new VariableResolver().resolveVarRef("branch", ctx);
        assertTrue(resolved.isPresent());
        assertEquals("main", resolved.get(),
            "user-supplied form option must win over variable default");
    }

    @Test
    void variableResolver_defaultLiteral_resolvesWhenNoUserOption() {
        // variable "region" { default = "europe-west1" } -- no user option
        // for region in form (locationId is a UUID, not the location name);
        // the resolver returns the locationId-as-string per the lookup map,
        // so to test default resolution we use a custom variable name.
        String src = """
            variable "extra" {
              default = "europe-west1"
            }
            """;
        ParsedHclFile file = parse("variables.tf", src);
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);

        Optional<Object> resolved = new VariableResolver().resolveVarRef("extra", ctx);
        assertTrue(resolved.isPresent());
        assertEquals("europe-west1", resolved.get(),
            "variable default literal must resolve when no user option");
    }

    @Test
    void variableResolver_returnsEmptyForUnknownVar_oneHopRule() {
        // No variable block at all; no user option; resolver returns empty.
        ParsedHclFile file = parse("main.tf", "resource \"google_compute_network\" \"vpc\" {}");
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);

        Optional<Object> resolved = new VariableResolver().resolveVarRef("unknown_var", ctx);
        assertTrue(resolved.isEmpty());
    }

    @Test
    void variableResolver_doesNotFollowVarOfVar_oneHopOnly() {
        // variable "a" { default = var.b }   --   default is itself a ref.
        // Resolver MUST NOT follow it (one-hop rule per Q5). Returns empty.
        String src = """
            variable "a" {
              default = var.b
            }
            variable "b" {
              default = "literal"
            }
            """;
        ParsedHclFile file = parse("variables.tf", src);
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);

        Optional<Object> resolved = new VariableResolver().resolveVarRef("a", ctx);
        assertTrue(resolved.isEmpty(),
            "var-of-var must not recurse (one-hop rule)");
    }

    // ============================================================
    // LocalsResolver tests
    // ============================================================

    @Test
    void localsResolver_literalString_resolves() {
        String src = """
            locals {
              db_host = "10.0.0.5"
              port    = 5432
              enabled = true
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);
        LocalsResolver r = new LocalsResolver();

        assertEquals("10.0.0.5", r.resolveLocalRef("db_host", ctx).orElse(null));
        assertEquals(new BigDecimal("5432"), r.resolveLocalRef("port", ctx).orElse(null));
        assertEquals(true, r.resolveLocalRef("enabled", ctx).orElse(null));
    }

    @Test
    void localsResolver_nonLiteral_returnsEmpty_andDoesNotRecurse() {
        // local.x = local.y  -- resolver returns empty (one-hop rule).
        String src = """
            locals {
              x = local.y
              y = "wired-up"
            }
            """;
        ParsedHclFile file = parse("main.tf", src);
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);

        Optional<Object> resolved = new LocalsResolver().resolveLocalRef("x", ctx);
        assertTrue(resolved.isEmpty(),
            "non-literal locals value must NOT be resolved (one-hop rule)");
    }

    @Test
    void localsResolver_unknownKey_returnsEmpty() {
        ParsedHclFile file = parse("main.tf", "locals { a = \"v\" }");
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);
        assertTrue(new LocalsResolver().resolveLocalRef("missing", ctx).isEmpty());
    }

    // ============================================================
    // ModuleResolver tests
    // ============================================================

    @Test
    void moduleResolver_localSource_returnsResourceBlocksFromTargetFiles() {
        String rootSrc = """
            module "network" {
              source = "./modules/network"
              env    = "prod"
            }
            """;
        String moduleSrc = """
            resource "google_compute_network" "vpc" {
              name = "main"
            }
            resource "google_compute_subnetwork" "app" {
              name          = "app-subnet"
              ip_cidr_range = "10.0.0.0/24"
              network       = google_compute_network.vpc.self_link
            }
            """;
        ParsedHclFile root = parse("main.tf", rootSrc);
        ParsedHclFile mod = parse("modules/network/main.tf", moduleSrc);
        TerraformImportContext ctx = newCtx(List.of(root, mod), "env-1", null, null);

        // pull the module block out of root
        HclBlock moduleBlock = null;
        for (HclBlock b : root.blocks()) {
            if ("module".equals(b.blockType())) {
                moduleBlock = b;
                break;
            }
        }
        assertNotNull(moduleBlock);

        List<HclBlock> resolved = new ModuleResolver().resolveLocalModule(moduleBlock, ctx);
        assertEquals(2, resolved.size(),
            "both resource blocks under modules/network/ must be returned");

        // module-call comment marker must be prepended
        boolean foundMarker = false;
        for (HclBlock b : resolved) {
            if (b.precedingComments() != null
                && b.precedingComments().contains("# Module call: network")) {
                foundMarker = true;
                break;
            }
        }
        assertTrue(foundMarker, "module-call comment must annotate resolved blocks");
        assertTrue(ctx.warnings().isEmpty(), "no warnings on successful local-module resolution");
    }

    @Test
    void moduleResolver_remoteSource_emitsSoftWarn_neverFetches() {
        String rootSrc = """
            module "shared_vpc" {
              source = "git::https://github.com/example/terraform-shared-vpc.git//modules/network?ref=v1.0.0"
            }
            module "registry_vpc" {
              source = "registry.terraform.io/example/network/google"
            }
            """;
        ParsedHclFile root = parse("main.tf", rootSrc);
        TerraformImportContext ctx = newCtx(List.of(root), "env-1", null, null);

        for (HclBlock b : root.blocks()) {
            if (!"module".equals(b.blockType())) continue;
            List<HclBlock> resolved = new ModuleResolver().resolveLocalModule(b, ctx);
            assertTrue(resolved.isEmpty(), "remote module sources MUST NOT be fetched");
        }
        // Two soft-warns recorded (one per remote module).
        assertEquals(2, ctx.warnings().size(),
            "remote module sources must produce one soft-warn each");
        for (String w : ctx.warnings()) {
            assertTrue(w.contains("remote module not fetched"),
                "warning text must call out 'remote module not fetched': " + w);
        }
    }

    // ============================================================
    // CandidateMatcher tests
    // ============================================================

    @Test
    void candidateMatcher_matchByIacAddress_producesWillUpdate() throws Exception {
        // Existing binding shows the same iac_address as the candidate -> WILL_UPDATE.
        IaCResourceBindingDto existing = new IaCResourceBindingDto(
            "b1", "src1", "ip1", "env-1",
            "google_compute_network.vpc",
            "google_compute_network", "vpc",
            "GCP", "main.tf", 1, 5,
            null, null, "BOUND", null, null,
            "user-edited description", null
        );
        MetaModelDto model = new MetaModelDto(null,
            relationshipsWithBindings(List.of(existing)));

        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            "google_compute_network.vpc",
            "google_compute_network", "vpc",
            "GCP", "main.tf", 1, 5, null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            "main.tf", 1, 5, "snippet", null
        );
        Map<String, Object> proposed = new java.util.LinkedHashMap<>();
        proposed.put("name", "vpc-imported");
        proposed.put("description", "imported description");
        proposed.put("ip_cidr_range", "10.0.0.0/16");
        ImportedCandidate cand = ImportedCandidate.of(
            ImportedCandidate.TYPE_NETWORK, proposed, pb,
            ImportedCandidate.CONFIDENCE_HIGH, List.of(), ev
        );

        TerraformImportContext ctx = newCtxWithModel(List.of(), model);
        CandidateMatcher.MatchResult result = new CandidateMatcher().match(cand, ctx);

        assertEquals(CandidateMatcher.Outcome.WILL_UPDATE, result.outcome());
        assertSame(existing, result.existingBinding());
    }

    @Test
    void candidateMatcher_userEditedFieldsWin_technicalImportedWins() throws Exception {
        // Existing binding's iac_resource_name = "vpc-existing" surfaces as
        // existingName for the diff. User-edited "name" wins; "ip_cidr_range"
        // (technical) -> imported wins.
        IaCResourceBindingDto existing = new IaCResourceBindingDto(
            "b1", "src1", "ip1", "env-1",
            "google_compute_network.vpc",
            "google_compute_network",
            "vpc-existing",
            "GCP", "main.tf", 1, 5,
            null, null, "BOUND", null, null,
            "user-edited desc", null
        );
        MetaModelDto model = new MetaModelDto(null,
            relationshipsWithBindings(List.of(existing)));

        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            "google_compute_network.vpc",
            "google_compute_network", "vpc",
            "GCP", "main.tf", 1, 5, null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            "main.tf", 1, 5, "snippet", null
        );
        Map<String, Object> proposed = new java.util.LinkedHashMap<>();
        proposed.put("name", "vpc-imported");
        proposed.put("description", "imported description");
        proposed.put("ip_cidr_range", "10.0.0.0/16");
        ImportedCandidate cand = ImportedCandidate.of(
            ImportedCandidate.TYPE_NETWORK, proposed, pb,
            ImportedCandidate.CONFIDENCE_HIGH, List.of(), ev
        );

        TerraformImportContext ctx = newCtxWithModel(List.of(), model);
        CandidateMatcher.MatchResult result = new CandidateMatcher().match(cand, ctx);

        // Reconciled fields: name comes from existing binding's
        // iac_resource_name; ip_cidr_range stays imported (technical).
        Map<String, Object> reconciled = result.reconciled().proposedEntityFields();
        assertEquals("vpc-existing", reconciled.get("name"),
            "user-edited name must be preserved on update");
        assertEquals("user-edited desc", reconciled.get("description"),
            "user-edited description must be preserved on update");
        assertEquals("10.0.0.0/16", reconciled.get("ip_cidr_range"),
            "technical field (ip_cidr_range) -> imported wins");

        // Diff payload surfaces every diverging field.
        assertFalse(result.fieldDiff().isEmpty());
    }

    @Test
    void candidateMatcher_noMatch_producesWillCreate() throws Exception {
        IaCResourceBindingDto otherBinding = new IaCResourceBindingDto(
            "b1", "src1", "ip1", "env-1",
            "google_compute_network.someone_else",
            "google_compute_network", "someone_else",
            "GCP", "main.tf", 1, 5,
            null, null, "BOUND", null, null,
            null, null
        );
        MetaModelDto model = new MetaModelDto(null,
            relationshipsWithBindings(List.of(otherBinding)));

        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            "google_compute_network.vpc",        // different iac_address
            "google_compute_network", "vpc",
            "GCP", "main.tf", 1, 5, null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            "main.tf", 1, 5, "snippet", null
        );
        ImportedCandidate cand = ImportedCandidate.of(
            ImportedCandidate.TYPE_NETWORK,
            Map.of("name", "vpc"),
            pb,
            ImportedCandidate.CONFIDENCE_HIGH, List.of(), ev
        );

        TerraformImportContext ctx = newCtxWithModel(List.of(), model);
        CandidateMatcher.MatchResult result = new CandidateMatcher().match(cand, ctx);
        assertEquals(CandidateMatcher.Outcome.WILL_CREATE, result.outcome());
        assertNull(result.existingBinding());
    }

    // ============================================================
    // RelationshipInferrer tests
    // ============================================================

    @Test
    void relationshipInferrer_resourceHostedInSubnet_inferred() {
        // ComputeResource subnetwork_ref = "google_compute_subnetwork.app.self_link"
        // resolves to a parsed Subnet candidate -> ResourceHostedInSubnet emitted.
        ImportedCandidate subnet = newSimpleCandidate(
            ImportedCandidate.TYPE_SUBNET,
            "google_compute_subnetwork.app",
            Map.of("name", "app-subnet")
        );
        ImportedCandidate compute = newSimpleCandidate(
            ImportedCandidate.TYPE_COMPUTE_RESOURCE,
            "google_compute_instance.app",
            Map.of(
                "name", "app-vm",
                "subnetwork_ref", "google_compute_subnetwork.app.self_link"
            )
        );
        TerraformImportContext ctx = newCtx(List.of(), "env-1", null, null);

        List<RelationshipInferrer.InferredRelationship> rels =
            new RelationshipInferrer().infer(List.of(subnet, compute), ctx);

        assertEquals(1, rels.size());
        RelationshipInferrer.InferredRelationship r = rels.get(0);
        assertEquals(RelationshipInferrer.REL_RESOURCE_HOSTED_IN_SUBNET, r.relationshipType());
        assertEquals(compute.candidateId(), r.sourceCandidateId());
        assertEquals(subnet.candidateId(), r.targetCandidateId());
    }

    @Test
    void relationshipInferrer_deploymentUnitRunsOnCompute_inferred() {
        ImportedCandidate compute = newSimpleCandidate(
            ImportedCandidate.TYPE_COMPUTE_RESOURCE,
            "google_cloud_run_v2_service.app",
            Map.of("name", "app-cr")
        );
        ImportedCandidate du = newSimpleCandidate(
            ImportedCandidate.TYPE_DEPLOYMENT_UNIT,
            "google_cloud_run_v2_service.app_du",
            Map.of(
                "name", "app-du",
                "image", "gcr.io/example/app:1.0",
                "parent_compute_resource_address", "google_cloud_run_v2_service.app"
            )
        );
        TerraformImportContext ctx = newCtx(List.of(), "env-1", null, null);

        List<RelationshipInferrer.InferredRelationship> rels =
            new RelationshipInferrer().infer(List.of(compute, du), ctx);

        assertEquals(1, rels.size());
        RelationshipInferrer.InferredRelationship r = rels.get(0);
        assertEquals(RelationshipInferrer.REL_DEPLOYMENT_UNIT_RUNS_ON_COMPUTE, r.relationshipType());
        assertEquals(du.candidateId(), r.sourceCandidateId());
        assertEquals(compute.candidateId(), r.targetCandidateId());
    }

    @Test
    void relationshipInferrer_loadBalancerRoutesToCompute_compositeSuccessOnly() {
        // Composite-LB success: a LoadBalancer candidate with non-empty
        // composite_component_addresses + a backend-service component
        // referencing a compute resource. ResourceHostedIn... is NOT emitted
        // for partial-fallback LBs.
        ImportedCandidate compute = newSimpleCandidate(
            ImportedCandidate.TYPE_COMPUTE_RESOURCE,
            "google_compute_instance.app",
            Map.of("name", "app-vm")
        );
        ImportedCandidate backendService = newSimpleCandidate(
            ImportedCandidate.TYPE_LOAD_BALANCER + "Component",
            "google_compute_backend_service.bs",
            Map.of(
                "lb_component_resource_type", "google_compute_backend_service",
                "name", "bs",
                "backend_compute", "google_compute_instance.app.self_link"
            )
        );
        ImportedCandidate lb = newSimpleCandidate(
            ImportedCandidate.TYPE_LOAD_BALANCER,
            "google_compute_global_forwarding_rule.fr",
            Map.of(
                "name", "lb",
                "composite_component_addresses", List.of("google_compute_backend_service.bs")
            )
        );
        TerraformImportContext ctx = newCtx(List.of(), "env-1", null, null);

        List<RelationshipInferrer.InferredRelationship> rels =
            new RelationshipInferrer().infer(List.of(compute, backendService, lb), ctx);

        assertEquals(1, rels.size());
        RelationshipInferrer.InferredRelationship r = rels.get(0);
        assertEquals(RelationshipInferrer.REL_LOAD_BALANCER_ROUTES_TO, r.relationshipType());
        assertEquals(lb.candidateId(), r.sourceCandidateId());
        assertEquals(compute.candidateId(), r.targetCandidateId());
    }

    // ============================================================
    // ContextInferrer tests (carry-forward of task 3.8)
    // ============================================================

    @Test
    void contextInferrer_providerBlock_emitsCloudAccountAndLocation() {
        String src = """
            provider "google" {
              project = "gcp-prod-project"
              region  = "europe-west1"
              zone    = "europe-west1-a"
            }
            """;
        ParsedHclFile file = parse("provider.tf", src);
        // user did NOT supply cloudAccountId / locationId -> inference fires.
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);

        List<ImportedCandidate> inferred = new ContextInferrer().infer(ctx);

        long cloudAccts = inferred.stream()
            .filter(c -> ImportedCandidate.TYPE_CLOUD_ACCOUNT.equals(c.targetEntityType()))
            .count();
        long locations = inferred.stream()
            .filter(c -> ImportedCandidate.TYPE_LOCATION.equals(c.targetEntityType()))
            .count();
        assertEquals(1, cloudAccts, "one CloudAccount inferred from provider.project");
        assertEquals(2, locations, "two Locations inferred from provider.region + .zone");
    }

    @Test
    void contextInferrer_skipsWhenUserSuppliedIds() {
        String src = """
            provider "google" {
              project = "gcp-prod-project"
              region  = "europe-west1"
            }
            """;
        ParsedHclFile file = parse("provider.tf", src);
        // user supplied BOTH cloudAccountId AND locationId -> inference skipped.
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", "ca-1", "loc-1");

        List<ImportedCandidate> inferred = new ContextInferrer().infer(ctx);
        assertTrue(inferred.isEmpty(),
            "user-supplied ids must skip provider-block inference entirely");
    }

    @Test
    void contextInferrer_googleProjectResource_emitsCloudAccount() {
        String src = """
            resource "google_project" "p" {
              project_id = "gcp-prod-project"
              name       = "Prod Project"
            }
            """;
        ParsedHclFile file = parse("project.tf", src);
        TerraformImportContext ctx = newCtx(List.of(file), "env-1", null, null);

        List<ImportedCandidate> inferred = new ContextInferrer().infer(ctx);
        long cloudAccts = inferred.stream()
            .filter(c -> ImportedCandidate.TYPE_CLOUD_ACCOUNT.equals(c.targetEntityType()))
            .count();
        assertEquals(1, cloudAccts, "google_project resource must produce CloudAccount candidate");
    }

    // ============================================================
    // helpers
    // ============================================================

    private static ImportedCandidate newSimpleCandidate(
        String entityType, String iacAddress, Map<String, Object> fields
    ) {
        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            "main.tf", 1, 2, "snippet", null
        );
        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            iacAddress,
            iacAddress.split("\\.")[0],
            iacAddress.split("\\.").length > 1 ? iacAddress.split("\\.")[1] : "(unnamed)",
            "GCP", "main.tf", 1, 2, null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        return ImportedCandidate.of(
            entityType, fields, pb,
            ImportedCandidate.CONFIDENCE_HIGH, List.of(), ev
        );
    }

    @SuppressWarnings("unchecked")
    private static MetaModelRelationshipsDto relationshipsWithBindings(
        List<IaCResourceBindingDto> bindings
    ) throws Exception {
        Class<MetaModelRelationshipsDto> cls = MetaModelRelationshipsDto.class;
        RecordComponent[] components = cls.getRecordComponents();
        Class<?>[] paramTypes = new Class<?>[components.length];
        Object[] args = new Object[components.length];
        for (int i = 0; i < components.length; i++) {
            paramTypes[i] = components[i].getType();
        }
        Constructor<MetaModelRelationshipsDto> ctor = cls.getDeclaredConstructor(paramTypes);
        ctor.setAccessible(true);
        Parameter[] params = ctor.getParameters();
        for (int i = 0; i < components.length; i++) {
            String jsonName = jsonNameFor(components[i], params[i]);
            if ("iac_resource_bindings".equals(jsonName)) {
                args[i] = bindings;
            } else if (paramTypes[i] == List.class) {
                args[i] = new ArrayList<>();
            } else {
                args[i] = null;
            }
        }
        return ctor.newInstance(args);
    }

    private static String jsonNameFor(RecordComponent c, Parameter ctorParam) {
        JsonProperty ann = c.getAnnotation(JsonProperty.class);
        if (ann != null && !ann.value().isEmpty()) return ann.value();
        try {
            Method accessor = c.getAccessor();
            if (accessor != null) {
                JsonProperty a2 = accessor.getAnnotation(JsonProperty.class);
                if (a2 != null && !a2.value().isEmpty()) return a2.value();
            }
        } catch (Exception ignored) { }
        if (ctorParam != null) {
            JsonProperty a3 = ctorParam.getAnnotation(JsonProperty.class);
            if (a3 != null && !a3.value().isEmpty()) return a3.value();
        }
        return c.getName();
    }
}
