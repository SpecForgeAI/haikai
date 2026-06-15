package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.model.dto.relationship.IaCResourceBindingDto;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Value-class context carrier passed to every {@link TerraformImporter}.
 *
 * <p>Carries the parsed HCL files, the user-supplied import options, the
 * loaded existing model (for matching against existing
 * {@code IaCResourceBinding} rows), a pre-built lookup map keyed by
 * {@code iac_address}, and a mutable {@code warnings} collector.
 *
 * <p>Mirrors the {@code service.export.terraform.TerraformContext} shape
 * for symmetric ergonomics. Notable inversions:
 * <ul>
 *   <li>Selections are carried as <em>id strings</em>
 *       ({@code environmentId}, {@code cloudAccountId}, {@code locationId})
 *       rather than as {@code EnvironmentDto} / etc.; the importer
 *       proposes a candidate that the model-save flow then materialises,
 *       so dehydrated id-based references suffice on the import side.
 *   <li>The lookup map keys on {@code iac_address} (Q6 deterministic
 *       matching) rather than on {@code infrastructure_point_id}.
 *   <li>Carries a mutable {@code warnings} collector populated by the
 *       parser + classifier; the export-side context held only
 *       per-emitter immutable state because warnings flowed through
 *       {@code EmittedResource}.
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 1.5
 */
public final class TerraformImportContext {

    private final List<ParsedHclFile> hclFiles;
    private final MetaModelDto existingModel;
    private final Map<String, IaCResourceBindingDto> bindingsByIacAddress;

    // user-supplied import options
    private final String environmentId;
    private final String cloudAccountId;
    private final String locationId;
    private final String providerId;
    private final String repositoryUrl;
    private final String branch;
    private final String commitSha;
    private final String path;
    private final String workspace;

    // mutable warnings collector populated by the parser + classifier
    private final List<String> warnings = new ArrayList<>();

    public TerraformImportContext(
        List<ParsedHclFile> hclFiles,
        MetaModelDto existingModel,
        String environmentId,
        String cloudAccountId,
        String locationId,
        String providerId,
        String repositoryUrl,
        String branch,
        String commitSha,
        String path,
        String workspace
    ) {
        this.hclFiles = hclFiles == null ? List.of() : List.copyOf(hclFiles);
        this.existingModel = existingModel;
        this.environmentId = Objects.requireNonNull(environmentId, "environmentId is required");
        this.cloudAccountId = cloudAccountId;
        this.locationId = locationId;
        this.providerId = Objects.requireNonNull(providerId, "providerId is required");
        this.repositoryUrl = repositoryUrl;
        this.branch = branch;
        this.commitSha = commitSha;
        this.path = path;
        this.workspace = workspace;
        this.bindingsByIacAddress = buildBindingsByIacAddress(existingModel);
    }

    public List<ParsedHclFile> hclFiles() { return hclFiles; }
    public MetaModelDto existingModel() { return existingModel; }
    public Map<String, IaCResourceBindingDto> bindingsByIacAddress() { return bindingsByIacAddress; }

    public String environmentId() { return environmentId; }
    public String cloudAccountId() { return cloudAccountId; }
    public String locationId() { return locationId; }
    public String providerId() { return providerId; }
    public String repositoryUrl() { return repositoryUrl; }
    public String branch() { return branch; }
    public String commitSha() { return commitSha; }
    public String path() { return path; }
    public String workspace() { return workspace; }

    /** Mutable warnings collector. Importer + parser append; result-builder reads. */
    public List<String> warnings() { return warnings; }

    /** Append a top-level import warning. Convenience over direct list access. */
    public void addWarning(String warning) {
        if (warning == null || warning.isBlank()) return;
        warnings.add(warning);
    }

    /**
     * Slug helper. Lowercases the input and replaces every run of non
     * lower-alphanumeric characters with a single underscore.
     *
     * <p>Locked contract: identical to
     * {@link com.example.architecturemodel.service.export.terraform.TerraformContext#slugify(String)}
     * so import + export produce the same address values for round-trip
     * stability.
     */
    public static String slugify(String name) {
        if (name == null) {
            return "";
        }
        return name.toLowerCase().replaceAll("[^a-z0-9]+", "_");
    }

    // ----- private helpers -----

    private static Map<String, IaCResourceBindingDto> buildBindingsByIacAddress(MetaModelDto model) {
        if (model == null
            || model.relationships() == null
            || model.relationships().iacResourceBindings() == null) {
            return Collections.emptyMap();
        }
        Map<String, IaCResourceBindingDto> out = new LinkedHashMap<>();
        for (IaCResourceBindingDto b : model.relationships().iacResourceBindings()) {
            if (b == null) continue;
            String addr = b.iacAddress();
            if (addr == null || addr.isBlank()) continue;
            // last-binding-wins (rare; defensive). Preserve insertion order.
            out.put(addr, b);
        }
        return Collections.unmodifiableMap(out);
    }
}
