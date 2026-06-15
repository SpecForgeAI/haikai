package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclAttribute;
import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;
import com.example.architecturemodel.service.import_.terraform.hcl.HclValue;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Context-inference classifier (carry-forward of deferred Group 3 task 3.8).
 *
 * <p>Walks {@code provider "google"} blocks and {@code resource "google_project"}
 * blocks across the parsed files in the upload to infer:
 * <ul>
 *   <li>{@code CloudAccount} candidates — sourced from
 *       {@code provider.project} / {@code resource.google_project.project_id}.
 *       Skipped entirely when the user supplied {@code cloudAccountId} on
 *       the import options.</li>
 *   <li>{@code Location} candidates — sourced from
 *       {@code provider.region} / {@code provider.zone}. Skipped when the
 *       user supplied {@code locationId}.</li>
 * </ul>
 *
 * <p>{@code Environment} inference is intentionally NOT performed in V1 —
 * the controller requires {@code environmentId}, so the user-supplied env
 * always wins.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 3.8 (deferred to 4)
 */
@Component
public class ContextInferrer {

    /** Provider id constant — matches {@link GcpTerraformImporter}. */
    private static final String PROVIDER_ID = "GCP";

    public List<ImportedCandidate> infer(TerraformImportContext ctx) {
        List<ImportedCandidate> out = new ArrayList<>();
        if (ctx == null || ctx.hclFiles() == null) return out;

        boolean cloudAccountSupplied = ctx.cloudAccountId() != null && !ctx.cloudAccountId().isBlank();
        boolean locationSupplied = ctx.locationId() != null && !ctx.locationId().isBlank();

        // Track emitted projects + locations to avoid duplicate inferred
        // candidates across files / blocks.
        java.util.Set<String> seenProjects = new java.util.LinkedHashSet<>();
        java.util.Set<String> seenLocations = new java.util.LinkedHashSet<>();

        for (ParsedHclFile file : ctx.hclFiles()) {
            if (file == null || file.blocks() == null) continue;
            for (HclBlock block : file.blocks()) {
                if (block == null) continue;
                String type = block.blockType();
                if ("provider".equals(type)) {
                    classifyProviderBlock(
                        block, file, ctx,
                        cloudAccountSupplied, locationSupplied,
                        seenProjects, seenLocations,
                        out
                    );
                } else if ("resource".equals(type)
                    && block.labels() != null && block.labels().size() >= 2
                    && "google_project".equals(block.labels().get(0))) {
                    classifyGoogleProjectResource(
                        block, file, ctx,
                        cloudAccountSupplied,
                        seenProjects,
                        out
                    );
                }
            }
        }
        return out;
    }

    /**
     * Inspect a {@code provider "google" { project = "..." region = "..." }}
     * block. Emits at most one CloudAccount candidate (when project literal
     * present AND user did not pre-supply cloudAccountId) and one Location
     * candidate (when region or zone literal present AND user did not
     * pre-supply locationId). De-dupes by literal value across the upload.
     */
    void classifyProviderBlock(
        HclBlock block,
        ParsedHclFile file,
        TerraformImportContext ctx,
        boolean cloudAccountSupplied,
        boolean locationSupplied,
        java.util.Set<String> seenProjects,
        java.util.Set<String> seenLocations,
        List<ImportedCandidate> out
    ) {
        // Provider name label -- e.g. ["google"]; we only inspect "google"
        // providers here. Other providers fall through (multi-provider
        // support is V2).
        String providerName = (block.labels() != null && !block.labels().isEmpty())
            ? block.labels().get(0) : null;
        if (!"google".equals(providerName) && !"google-beta".equals(providerName)) {
            return;
        }

        if (!cloudAccountSupplied) {
            String project = readLiteralStringAttr(block, "project");
            if (project != null && !project.isBlank() && seenProjects.add(project)) {
                out.add(buildCloudAccountCandidate(project, file, block));
            }
        }

        if (!locationSupplied) {
            String region = readLiteralStringAttr(block, "region");
            if (region != null && !region.isBlank() && seenLocations.add(region)) {
                out.add(buildLocationCandidate(region, "region", file, block));
            }
            String zone = readLiteralStringAttr(block, "zone");
            if (zone != null && !zone.isBlank() && seenLocations.add(zone)) {
                out.add(buildLocationCandidate(zone, "zone", file, block));
            }
        }
    }

    /**
     * {@code resource "google_project" "p" { project_id = "..." name = "..." }}
     * → {@code CloudAccount} candidate. Skipped when the user pre-supplied
     * {@code cloudAccountId}.
     */
    void classifyGoogleProjectResource(
        HclBlock block,
        ParsedHclFile file,
        TerraformImportContext ctx,
        boolean cloudAccountSupplied,
        java.util.Set<String> seenProjects,
        List<ImportedCandidate> out
    ) {
        if (cloudAccountSupplied) return;
        String projectId = readLiteralStringAttr(block, "project_id");
        if (projectId == null || projectId.isBlank()) {
            // fall back to "name" attr if project_id missing
            projectId = readLiteralStringAttr(block, "name");
        }
        if (projectId == null || projectId.isBlank()) return;
        if (!seenProjects.add(projectId)) return;
        out.add(buildCloudAccountCandidate(projectId, file, block));
    }

    // ------------------------------------------------------------------
    // Candidate builders
    // ------------------------------------------------------------------

    private static ImportedCandidate buildCloudAccountCandidate(
        String projectId, ParsedHclFile file, HclBlock block
    ) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", projectId);
        fields.put("provider", PROVIDER_ID);
        fields.put("external_id", projectId);
        fields.put("inferred", Boolean.TRUE);

        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            file == null ? null : file.filePath(),
            block.startLine(), block.endLine(),
            null, null
        );
        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            "inferred_cloud_account." + projectId,
            "inferred_cloud_account",
            projectId,
            PROVIDER_ID,
            file == null ? null : file.filePath(),
            block.startLine(), block.endLine(),
            null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        return ImportedCandidate.of(
            ImportedCandidate.TYPE_CLOUD_ACCOUNT,
            fields,
            pb,
            ImportedCandidate.CONFIDENCE_HIGH,
            List.of("CloudAccount inferred from provider/project block"),
            ev
        );
    }

    private static ImportedCandidate buildLocationCandidate(
        String location, String kind, ParsedHclFile file, HclBlock block
    ) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", location);
        fields.put("location_kind", kind);   // "region" or "zone"
        fields.put("provider", PROVIDER_ID);
        fields.put("inferred", Boolean.TRUE);

        ImportedCandidate.Evidence ev = new ImportedCandidate.Evidence(
            file == null ? null : file.filePath(),
            block.startLine(), block.endLine(),
            null, null
        );
        ImportedCandidate.ProposedBinding pb = new ImportedCandidate.ProposedBinding(
            "inferred_location." + location,
            "inferred_location",
            location,
            PROVIDER_ID,
            file == null ? null : file.filePath(),
            block.startLine(), block.endLine(),
            null,
            ImportedCandidate.CONFIDENCE_HIGH
        );
        return ImportedCandidate.of(
            ImportedCandidate.TYPE_LOCATION,
            fields,
            pb,
            ImportedCandidate.CONFIDENCE_HIGH,
            List.of("Location inferred from provider " + kind + " literal"),
            ev
        );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static String readLiteralStringAttr(HclBlock block, String attrName) {
        if (block == null || block.attributes() == null) return null;
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            if (!attrName.equals(attr.name())) continue;
            HclValue v = attr.value();
            if (v instanceof HclValue.StringValue sv) {
                return sv.value();
            }
            // ReferenceValue / RawValue / Number / Bool / List / Map -> not a
            // literal string; skip (one-hop rule means we don't follow
            // references at this layer -- the orchestrator's resolver runs
            // before context inference where appropriate).
            return null;
        }
        return null;
    }
}
