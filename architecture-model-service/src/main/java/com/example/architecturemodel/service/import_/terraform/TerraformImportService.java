package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.model.dto.ArchitectureModelDto;
import com.example.architecturemodel.model.dto.MetaModelDto;
import com.example.architecturemodel.service.ModelService;
import com.example.architecturemodel.service.import_.terraform.hcl.HclSourceFile;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Orchestrates the Infrastructure Terraform import pipeline.
 *
 * <p>Responsibilities:
 * <ol>
 *   <li>Hard-fail boundary checks BEFORE parse (4xx via
 *       {@link IllegalArgumentException}): missing files, missing
 *       {@code environmentId}, missing / invalid / unregistered
 *       {@code provider}, ZIP / file size caps.</li>
 *   <li>Unzip / collect uploaded {@code .tf} files using
 *       {@link java.util.zip.ZipInputStream} (no Apache Commons Compress).
 *       File paths are preserved relative to the ZIP root.</li>
 *   <li>Parse each file via {@link HclSourceFile#parse}; soft-warn on
 *       per-file parse exceptions.</li>
 *   <li>Load the existing model + build the matching lookup map keyed by
 *       {@code iac_address}.</li>
 *   <li>Run {@link ContextInferrer} to produce inferred CloudAccount /
 *       Location candidates from {@code provider} blocks (skipped when the
 *       user pre-supplied {@code cloudAccountId} / {@code locationId}).</li>
 *   <li>Dispatch to the registered {@link TerraformImporter} via
 *       {@code provider} and collect the per-resource candidates.</li>
 *   <li>Run {@link CandidateMatcher} per candidate to assign
 *       {@code WILL_CREATE} vs {@code WILL_UPDATE}.</li>
 *   <li>Run {@link RelationshipInferrer} to derive relationship candidates
 *       from direct Terraform evidence.</li>
 *   <li>Build the {@link ImportReviewResult.ProposedIaCSource} payload from
 *       form fields, bucketize candidates into {@code willCreate} /
 *       {@code willUpdate} / {@code unsupported}, and return the assembled
 *       {@link ImportReviewResult}.</li>
 * </ol>
 *
 * <p><b>NO model mutation.</b> The candidate review payload is transient; on
 * "Approve all" the frontend posts the candidates back through the existing
 * model-save flow. On "Discard all" nothing is persisted.
 *
 * <p>Mirrors {@link com.example.architecturemodel.service.export.terraform.TerraformExportService}
 * for Spring-idiomatic shape: constructor-injected {@code List<TerraformImporter>}
 * keyed by {@link TerraformImporter#providerId()}, configurable size caps via
 * {@code application.properties}.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 5.2
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class TerraformImportService {

    /**
     * Backend mirror of {@code iacSourceProviderOptions} declared in
     * {@code frontend/src/config/defaults.ts:1321}. Kept verbatim with
     * {@code TerraformExportService.PROVIDER_OPTIONS} -- new providers
     * MUST be added to BOTH.
     */
    static final Set<String> PROVIDER_OPTIONS = Set.of(
        "GCP", "AWS", "AZURE", "ON_PREM", "MULTI", "OTHER"
    );

    /** Default per-file cap (5 MB). Overridable via {@code application.properties}. */
    private static final long DEFAULT_MAX_FILE_BYTES = 5L * 1024L * 1024L;

    /** Default ZIP cap (10 MB). Overridable via {@code application.properties}. */
    private static final long DEFAULT_MAX_ZIP_BYTES = 10L * 1024L * 1024L;

    private final ModelService modelService;
    private final Map<String, TerraformImporter> importersByProviderId;
    private final ContextInferrer contextInferrer;
    private final CandidateMatcher candidateMatcher;
    private final RelationshipInferrer relationshipInferrer;
    private final long maxFileBytes;
    private final long maxZipBytes;

    public TerraformImportService(
        ModelService modelService,
        List<TerraformImporter> importers,
        ContextInferrer contextInferrer,
        CandidateMatcher candidateMatcher,
        RelationshipInferrer relationshipInferrer,
        @Value("${app.terraform-import.max-file-bytes:" + DEFAULT_MAX_FILE_BYTES + "}") long maxFileBytes,
        @Value("${app.terraform-import.max-zip-bytes:" + DEFAULT_MAX_ZIP_BYTES + "}") long maxZipBytes
    ) {
        this.modelService = modelService;
        this.contextInferrer = contextInferrer;
        this.candidateMatcher = candidateMatcher;
        this.relationshipInferrer = relationshipInferrer;
        this.maxFileBytes = maxFileBytes;
        this.maxZipBytes = maxZipBytes;
        Map<String, TerraformImporter> byId = new LinkedHashMap<>();
        if (importers != null) {
            for (TerraformImporter i : importers) {
                if (i == null || i.providerId() == null) continue;
                byId.put(i.providerId(), i);
            }
        }
        this.importersByProviderId = Collections.unmodifiableMap(byId);
    }

    /**
     * Run the full import pipeline.
     *
     * @return the transient {@link ImportReviewResult} -- no model mutation.
     * @throws IllegalArgumentException for hard-fail boundary cases (missing
     *     files / env / provider, oversized files / ZIP, unregistered
     *     provider).
     */
    public ImportReviewResult runImport(
        UUID projectId,
        UUID architectureId,
        MultipartFile[] files,
        ImportOptions options
    ) {
        // ---- Hard-fail boundary checks (BEFORE parse) ----
        if (files == null || files.length == 0) {
            throw new IllegalArgumentException("at least one file part is required");
        }
        if (options == null) {
            throw new IllegalArgumentException("import options are required");
        }
        if (options.environmentId() == null || options.environmentId().isBlank()) {
            throw new IllegalArgumentException("environmentId is required");
        }
        if (options.provider() == null || options.provider().isBlank()) {
            throw new IllegalArgumentException("provider is required");
        }
        if (!PROVIDER_OPTIONS.contains(options.provider())) {
            throw new IllegalArgumentException(
                "provider '" + options.provider() + "' is not in iacSourceProviderOptions");
        }
        if (!importersByProviderId.containsKey(options.provider())) {
            throw new IllegalArgumentException(
                "provider not registered: '" + options.provider() + "' (V1 only registers 'GCP')");
        }

        // size enforcement
        long totalBytes = 0;
        for (MultipartFile mf : files) {
            if (mf == null) continue;
            long size = mf.getSize();
            totalBytes += size;
            String name = mf.getOriginalFilename();
            if (isZipFile(mf)) {
                if (size > maxZipBytes) {
                    throw new IllegalArgumentException(
                        "uploaded ZIP '" + name + "' exceeds max size (" + maxZipBytes + " bytes)");
                }
            } else if (size > maxFileBytes) {
                throw new IllegalArgumentException(
                    "uploaded file '" + name + "' exceeds max size (" + maxFileBytes + " bytes)");
            }
        }

        // ---- Unzip / collect ----
        List<UploadedFile> collected = new ArrayList<>();
        List<String> warnings = new ArrayList<>();
        for (MultipartFile mf : files) {
            if (mf == null) continue;
            try {
                if (isZipFile(mf)) {
                    extractZipEntries(mf, collected, warnings);
                } else if (isTfFile(mf)) {
                    String content = new String(mf.getBytes(), StandardCharsets.UTF_8);
                    String filename = mf.getOriginalFilename();
                    if (filename == null || filename.isBlank()) filename = "anonymous.tf";
                    collected.add(new UploadedFile(filename, content));
                } else {
                    warnings.add("ignoring file '" + mf.getOriginalFilename()
                        + "': not a .tf or .zip");
                }
            } catch (IOException e) {
                warnings.add("failed to read upload '" + mf.getOriginalFilename()
                    + "': " + e.getMessage());
            }
        }

        if (collected.isEmpty()) {
            throw new IllegalArgumentException("no .tf files found in upload");
        }

        // ---- Parse ----
        List<ParsedHclFile> parsedFiles = new ArrayList<>();
        for (UploadedFile uf : collected) {
            ParsedHclFile parsed = HclSourceFile.parse(uf.path(), uf.content(), warnings);
            if (parsed != null) {
                parsedFiles.add(parsed);
            }
        }

        // ---- Load existing model + build context ----
        MetaModelDto existingMetaModel = null;
        try {
            ArchitectureModelDto loaded = modelService
                .loadModelByProjectIdAndArchitectureId(projectId, architectureId);
            if (loaded != null) {
                existingMetaModel = loaded.metaModel();
            }
        } catch (Exception e) {
            log.warn("Failed to load existing model for project {} architecture {}: {}",
                projectId, architectureId, e.getMessage());
            warnings.add("could not load existing model for matching; treating all candidates as new");
        }

        TerraformImportContext ctx = new TerraformImportContext(
            parsedFiles,
            existingMetaModel,
            options.environmentId(),
            options.cloudAccountId(),
            options.locationId(),
            options.provider(),
            options.repositoryUrl(),
            options.branch(),
            options.commitSha(),
            options.path(),
            options.workspace()
        );

        // Carry forward warnings collected during the unzip / parse phase.
        for (String w : warnings) {
            ctx.addWarning(w);
        }

        // ---- Context inference (carry-forward 3.8) ----
        List<ImportedCandidate> contextCandidates = contextInferrer.infer(ctx);

        // ---- Provider-specific resource classification ----
        TerraformImporter importer = importersByProviderId.get(options.provider());
        List<ImportedCandidate> resourceCandidates = importer.importResources(ctx);

        // Combine context + resource candidates.
        List<ImportedCandidate> allCandidates = new ArrayList<>(contextCandidates.size()
            + resourceCandidates.size());
        allCandidates.addAll(contextCandidates);
        allCandidates.addAll(resourceCandidates);

        // ---- Match each candidate (sorts into willCreate vs willUpdate) ----
        List<ImportedCandidate> willCreate = new ArrayList<>();
        List<ImportedCandidate> willUpdate = new ArrayList<>();
        List<ImportedCandidate> unsupported = new ArrayList<>();
        for (ImportedCandidate c : allCandidates) {
            if (c == null) continue;
            if (ImportedCandidate.TYPE_UNSUPPORTED.equals(c.targetEntityType())) {
                unsupported.add(c);
                continue;
            }
            CandidateMatcher.MatchResult mr = candidateMatcher.match(c, ctx);
            if (mr.isUpdate()) {
                willUpdate.add(mr.reconciled());
            } else {
                willCreate.add(mr.reconciled());
            }
        }

        // ---- Relationship inference (post-match so candidate ids are stable) ----
        // Inferred relationships are aggregated into top-level warnings as a
        // human-readable summary in V1; the V2 UI surfaces them as first-class
        // edges on the review modal. Relationship inference output is NOT
        // mutated into the model in this controller flow.
        List<RelationshipInferrer.InferredRelationship> relationships =
            relationshipInferrer.infer(allCandidates, ctx);
        for (RelationshipInferrer.InferredRelationship r : relationships) {
            ctx.addWarning("inferred relationship: " + r.relationshipType()
                + " (" + r.sourceCandidateId() + " -> " + r.targetCandidateId() + ")");
        }

        // ---- Build IaCSource proposal (one per import -- Q4) ----
        ImportReviewResult.ProposedIaCSource iacSource = new ImportReviewResult.ProposedIaCSource(
            options.provider(),
            options.repositoryUrl(),
            options.branch(),
            options.commitSha(),
            options.path(),
            options.workspace()
        );

        return ImportReviewResult.build(
            iacSource,
            willCreate,
            willUpdate,
            unsupported,
            ctx.warnings()
        );
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static boolean isZipFile(MultipartFile mf) {
        if (mf == null) return false;
        String name = mf.getOriginalFilename();
        if (name == null) return false;
        return name.toLowerCase().endsWith(".zip");
    }

    private static boolean isTfFile(MultipartFile mf) {
        if (mf == null) return false;
        String name = mf.getOriginalFilename();
        if (name == null) return false;
        return name.toLowerCase().endsWith(".tf");
    }

    private void extractZipEntries(
        MultipartFile zip,
        List<UploadedFile> collected,
        List<String> warnings
    ) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(
                new ByteArrayInputStream(zip.getBytes()), StandardCharsets.UTF_8)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    zis.closeEntry();
                    continue;
                }
                String name = entry.getName();
                if (name == null) {
                    zis.closeEntry();
                    continue;
                }
                // Reject zip-slip patterns; we only want safe relative paths.
                if (name.contains("..")) {
                    warnings.add("zip entry '" + name + "' rejected (path traversal)");
                    zis.closeEntry();
                    continue;
                }
                if (!name.toLowerCase().endsWith(".tf")) {
                    zis.closeEntry();
                    continue;
                }
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                long total = 0;
                while ((n = zis.read(buf)) > 0) {
                    total += n;
                    if (total > maxFileBytes) {
                        throw new IllegalArgumentException(
                            "ZIP entry '" + name + "' exceeds max file size");
                    }
                    out.write(buf, 0, n);
                }
                String content = out.toString(StandardCharsets.UTF_8);
                collected.add(new UploadedFile(name, content));
                zis.closeEntry();
            }
        }
    }

    /** Small carrier for an extracted (or single-uploaded) {@code .tf} file. */
    private record UploadedFile(String path, String content) {}
}
