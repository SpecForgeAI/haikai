package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import com.fasterxml.jackson.annotation.JsonProperty;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Parameter;
import java.lang.reflect.RecordComponent;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Foundation tests for the Terraform import package.
 *
 * <p>Mirrors {@code TerraformExporterFoundationTest} on the export side.
 * Asserts: ImportedCandidate / ImportReviewResult are records with the
 * documented components (incl. nested ProposedBinding / Evidence /
 * ProposedIaCSource / Summary records), TerraformImportContext exposes
 * parsed HCL files + user-supplied options + matching lookup map +
 * mutable warnings + slugify helper, TerraformImporter interface
 * declares the locked two-method shape.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 1.1
 */
class TerraformImporterFoundationTest {

    @Test
    void importedCandidate_isRecord_withDocumentedComponents_andNestedTypes() {
        // Records: declared shape
        assertTrue(ImportedCandidate.class.isRecord(),
            "ImportedCandidate must be a Java record");
        assertTrue(ImportedCandidate.ProposedBinding.class.isRecord(),
            "ImportedCandidate.ProposedBinding must be a Java record");
        assertTrue(ImportedCandidate.Evidence.class.isRecord(),
            "ImportedCandidate.Evidence must be a Java record");

        // Required components per tasks.md 1.3 (incl. per-candidate
        // identity + ignore-state plumbing for the follow-up UI spec).
        Set<String> seen = new HashSet<>();
        for (RecordComponent c : ImportedCandidate.class.getRecordComponents()) {
            seen.add(c.getName());
        }
        assertTrue(seen.contains("candidateId"));
        assertTrue(seen.contains("targetEntityType"));
        assertTrue(seen.contains("proposedEntityFields"));
        assertTrue(seen.contains("proposedBinding"));
        assertTrue(seen.contains("confidence"));
        assertTrue(seen.contains("perCandidateWarnings"));
        assertTrue(seen.contains("evidence"));
        assertTrue(seen.contains("ignored"));

        // Confidence buckets: locked at 0.900 / 0.600 / 0.300 (DECIMAL(4,3))
        assertEquals(new BigDecimal("0.900"), ImportedCandidate.CONFIDENCE_HIGH);
        assertEquals(new BigDecimal("0.600"), ImportedCandidate.CONFIDENCE_MEDIUM);
        assertEquals(new BigDecimal("0.300"), ImportedCandidate.CONFIDENCE_LOW);

        // Of-factory auto-generates a candidateId, defaults ignored=false,
        // null-safes proposedEntityFields + perCandidateWarnings.
        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            "main.tf", 10, 20,
            "resource \"google_compute_network\" \"vpc\" {}",
            null
        );
        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            "google_compute_network.vpc",
            "google_compute_network", "vpc",
            "GCP", "main.tf", 10, 20, null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        ImportedCandidate cand = ImportedCandidate.of(
            ImportedCandidate.TYPE_NETWORK,
            null,                    // proposedEntityFields null -> Map.of()
            pb,
            ImportedCandidate.CONFIDENCE_HIGH,
            null,                    // perCandidateWarnings null -> List.of()
            ev
        );
        assertNotNull(cand.candidateId());
        assertFalse(cand.candidateId().isBlank(),
            "candidateId must be non-blank (UUID auto-generated)");
        assertFalse(cand.ignored(),
            "ignored defaults to false (V1 ships read-only summary; UI flips later)");
        assertNotNull(cand.proposedEntityFields());
        assertTrue(cand.proposedEntityFields().isEmpty());
        assertNotNull(cand.perCandidateWarnings());
        assertTrue(cand.perCandidateWarnings().isEmpty());
        assertSame(pb, cand.proposedBinding());
        assertSame(ev, cand.evidence());
        assertEquals(ImportedCandidate.TYPE_NETWORK, cand.targetEntityType());
        assertEquals(ImportedCandidate.CONFIDENCE_HIGH, cand.confidence());
    }

    @Test
    void importReviewResult_carriesIacSource_threeCandidateLists_warnings_andSummary() {
        assertTrue(ImportReviewResult.class.isRecord());
        assertTrue(ImportReviewResult.ProposedIaCSource.class.isRecord());
        assertTrue(ImportReviewResult.Summary.class.isRecord());

        ImportReviewResult.ProposedIaCSource src = new ImportReviewResult.ProposedIaCSource(
            "GCP",
            "https://example.com/repo.git",
            "main",
            "abc123",
            "infra/",
            "prod"
        );

        ImportedCandidate willCreate = makeCandidate("Network", 1);
        ImportedCandidate willUpdate = makeCandidate("Subnet", 0);
        ImportedCandidate unsupported = makeCandidate("Unsupported", 2);

        ImportReviewResult result = ImportReviewResult.build(
            src,
            List.of(willCreate),
            List.of(willUpdate),
            List.of(unsupported),
            List.of("top-level warning A", "top-level warning B")
        );

        assertSame(src, result.iacSource());
        assertEquals(1, result.willCreate().size());
        assertEquals(1, result.willUpdate().size());
        assertEquals(1, result.unsupported().size());
        assertEquals(2, result.warnings().size());

        assertNotNull(result.summary());
        assertEquals(1, result.summary().willCreateCount());
        assertEquals(1, result.summary().willUpdateCount());
        assertEquals(1, result.summary().unsupportedCount());
        // 2 top-level + (1 + 0 + 2) per-candidate warnings = 5 total
        assertEquals(5, result.summary().totalWarningsCount());

        // Null lists are normalised to empty lists.
        ImportReviewResult emptyResult = new ImportReviewResult(
            null, null, null, null, null,
            new ImportReviewResult.Summary(0, 0, 0, 0)
        );
        assertNotNull(emptyResult.willCreate());
        assertNotNull(emptyResult.willUpdate());
        assertNotNull(emptyResult.unsupported());
        assertNotNull(emptyResult.warnings());
        assertTrue(emptyResult.willCreate().isEmpty());
    }

    @Test
    void terraformImportContext_carriesParsedFiles_options_lookupMap_warnings_andSlugify() throws Exception {
        // existing model with one binding so the lookup map has an entry.
        // Build relationships via reflection so the test stays resilient to
        // the evolving component count of MetaModelRelationshipsDto.
        IaCResourceBindingDto binding = new IaCResourceBindingDto(
            "b1", "src1", "ip1", "env-1",
            "google_compute_network.app",
            "google_compute_network", "app",
            "GCP", "main.tf", 1, 5, null, null,
            "BOUND", null, null, null, null
        );
        MetaModelRelationshipsDto rels = relationshipsWithBindings(List.of(binding));
        MetaModelDto model = new MetaModelDto(null, rels);

        ParsedHclFile file = new ParsedHclFile("main.tf", "resource \"x\" \"y\" {}", List.of());

        TerraformImportContext ctx = new TerraformImportContext(
            List.of(file),
            model,
            "env-1",      // environmentId required
            "ca-1",       // cloudAccountId optional
            "loc-1",      // locationId optional
            "GCP",        // providerId required
            "https://example.com/repo.git",
            "main",
            "abc123",
            "infra/",
            "prod"
        );

        // Parsed files round-trip
        assertEquals(1, ctx.hclFiles().size());
        assertEquals("main.tf", ctx.hclFiles().get(0).filePath());

        // User-supplied options
        assertEquals("env-1", ctx.environmentId());
        assertEquals("ca-1", ctx.cloudAccountId());
        assertEquals("loc-1", ctx.locationId());
        assertEquals("GCP", ctx.providerId());
        assertEquals("https://example.com/repo.git", ctx.repositoryUrl());
        assertEquals("main", ctx.branch());
        assertEquals("abc123", ctx.commitSha());
        assertEquals("infra/", ctx.path());
        assertEquals("prod", ctx.workspace());

        // Loaded model + lookup map keyed by iac_address
        assertSame(model, ctx.existingModel());
        assertEquals(1, ctx.bindingsByIacAddress().size());
        assertSame(binding, ctx.bindingsByIacAddress().get("google_compute_network.app"));

        // Mutable warnings collector
        assertNotNull(ctx.warnings());
        assertTrue(ctx.warnings().isEmpty());
        ctx.addWarning("unresolved var.region");
        assertEquals(1, ctx.warnings().size());
        ctx.addWarning(null);   // null and blank are no-ops
        ctx.addWarning("");
        assertEquals(1, ctx.warnings().size());

        // Slugify helper -- locked contract identical to TerraformContext.slugify
        assertEquals("prod_app_vpc", TerraformImportContext.slugify("Prod App VPC"));
        assertEquals("prod_app_vpc", TerraformImportContext.slugify("PROD-APP-VPC"));
        assertEquals("a_b_c", TerraformImportContext.slugify("a/b/c"));
        assertEquals("", TerraformImportContext.slugify(null));

        // Importer interface signature: providerId() + importResources(ctx)
        boolean hasProviderId = false;
        boolean hasImportResources = false;
        for (Method m : TerraformImporter.class.getDeclaredMethods()) {
            if (Modifier.isStatic(m.getModifiers())) continue;
            if (m.getName().equals("providerId")
                    && m.getReturnType() == String.class
                    && m.getParameterCount() == 0) {
                hasProviderId = true;
            } else if (m.getName().equals("importResources")
                    && m.getReturnType() == List.class
                    && m.getParameterCount() == 1
                    && m.getParameterTypes()[0] == TerraformImportContext.class) {
                hasImportResources = true;
            }
        }
        assertTrue(hasProviderId,
            "TerraformImporter must declare String providerId()");
        assertTrue(hasImportResources,
            "TerraformImporter must declare List<ImportedCandidate> importResources(TerraformImportContext ctx)");
    }

    // ----- helpers -----

    private static ImportedCandidate makeCandidate(String type, int warnCount) {
        List<String> warns = new ArrayList<>();
        for (int i = 0; i < warnCount; i++) warns.add("warn-" + i);
        return ImportedCandidate.of(
            type,
            Map.of("name", "ent-" + type),
            new ImportedCandidate.ProposedBinding(
                "addr_" + type, "google_x", "ent",
                "GCP", "main.tf", 1, 2, null,
                ImportedCandidate.CONFIDENCE_HIGH
            ),
            ImportedCandidate.CONFIDENCE_HIGH,
            warns,
            new ImportedCandidate.Evidence("main.tf", 1, 2, "snippet", null)
        );
    }

    /**
     * Build a {@link MetaModelRelationshipsDto} with only the
     * {@code iac_resource_bindings} list populated. Reflection-based to
     * keep the test resilient to the evolving component count of the
     * relationships record (mirrors the export-side
     * {@code TerraformTestFixtures.buildRecord} pattern but inlined to
     * avoid a cross-package test dependency).
     */
    @SuppressWarnings("unchecked")
    private static MetaModelRelationshipsDto relationshipsWithBindings(List<IaCResourceBindingDto> bindings) throws Exception {
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
