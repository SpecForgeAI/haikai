package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.example.architecturemodel.model.dto.MetaModelRelationshipsDto;
import com.example.architecturemodel.model.dto.entity.EnvironmentDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Foundation tests for the Terraform export package.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Group 1.
 */
class TerraformExporterFoundationTest {

    @Test
    void emittedResource_isRecord_with4Components_andNullSafeAccessors() {
        EmittedResource r = new EmittedResource("main.tf", "resource \"x\" \"y\" {}", null, null);

        // Record component accessors return non-null lists even when null was supplied.
        assertEquals("main.tf", r.targetFile());
        assertEquals("resource \"x\" \"y\" {}", r.hclFragment());
        assertNotNull(r.comments());
        assertNotNull(r.warnings());
        assertTrue(r.comments().isEmpty());
        assertTrue(r.warnings().isEmpty());

        // With supplied lists, values round-trip.
        EmittedResource r2 = new EmittedResource(
            "variables.tf",
            "variable \"v\" {}",
            List.of("# header"),
            List.of("warning-1")
        );
        assertEquals(List.of("# header"), r2.comments());
        assertEquals(List.of("warning-1"), r2.warnings());
    }

    @Test
    void terraformContext_carriesModelAndSelections_andSlugifyAndResourceAddressHelpersWork() {
        EnvironmentDto env = new EnvironmentDto(
            "env-1", "Prod", null, null, null, null,
            "PRODUCTION", "RUNNING", true, false, null, null,
            null, null, null, null, null, null,
            null, null, null, null, null
        );

        MetaModelEntitiesDto entities = TerraformTestFixtures.emptyEntities();
        MetaModelRelationshipsDto relationships = TerraformTestFixtures.emptyRelationships();

        TerraformContext ctx = new TerraformContext(entities, relationships, env, null, null, "GCP");

        assertSame(entities, ctx.entities());
        assertSame(relationships, ctx.relationships());
        assertSame(env, ctx.selectedEnvironment());
        assertEquals("GCP", ctx.providerId());
        assertNotNull(ctx.bindingsByInfrastructurePointId());
        assertNotNull(ctx.deploymentsByComputeResourceId());
        assertNotNull(ctx.exposuresByLoadBalancerId());
        assertNotNull(ctx.hostingsByDataStoreId());
        assertNotNull(ctx.usesByInfrastructureResourceId());

        // slugify locked contract
        assertEquals("prod_app_vpc", TerraformContext.slugify("Prod App VPC"));
        assertEquals("prod_app_vpc", TerraformContext.slugify("PROD-APP-VPC"));
        assertEquals("a_b_c", TerraformContext.slugify("a/b/c"));
        assertEquals("", TerraformContext.slugify(null));

        // resourceAddress: synthesised when no binding present
        assertEquals("prod_app_vpc", TerraformContext.resourceAddress("App VPC", "Prod", null));

        // resourceAddress: reused verbatim when binding has iac_address
        IaCResourceBindingDto binding = new IaCResourceBindingDto(
            "b1", "src1", "ip1", "env-1",
            "module.network.google_compute_network.app",
            "google_compute_network", "app",
            "GCP", "main.tf", null, null, null, null,
            "BOUND", null, null, null, null
        );
        assertEquals("module.network.google_compute_network.app",
            TerraformContext.resourceAddress("App VPC", "Prod", binding));
    }

    @Test
    void terraformExporter_interfaceExposes_providerIdAnd12EmitterMethods() {
        long emitterCount = 0;
        boolean hasProviderId = false;
        for (Method m : TerraformExporter.class.getDeclaredMethods()) {
            if (Modifier.isStatic(m.getModifiers())) continue;
            if (m.getName().equals("providerId")) {
                hasProviderId = true;
                continue;
            }
            if (m.getName().startsWith("export") && m.getReturnType() == List.class) {
                emitterCount++;
            }
        }
        assertTrue(hasProviderId, "TerraformExporter must declare providerId()");
        assertEquals(12L, emitterCount,
            "TerraformExporter must declare 12 entity-type emitter methods returning List<EmittedResource>");
    }
}
