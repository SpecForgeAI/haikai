package com.example.architecturemodel.service.export.terraform;

import com.example.architecturemodel.model.dto.MetaModelEntitiesDto;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Concatenates {@link EmittedResource} fragments produced by the per-entity
 * emitters into the final 4-file output set ({@code main.tf},
 * {@code variables.tf}, {@code outputs.tf}, {@code README.md}) plus a
 * {@code warnings.json} payload.
 *
 * <p>Pure utility: no Spring dependencies on {@link com.example.architecturemodel.service.ModelService}
 * or filesystem; just walks lists and concatenates strings.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-export-gcp -- Task Group 5.
 */
@Component
public class TerraformAssembler {

    static final String FILE_MAIN = "main.tf";
    static final String FILE_VARIABLES = "variables.tf";
    static final String FILE_OUTPUTS = "outputs.tf";
    static final String FILE_README = "README.md";
    static final String FILE_WARNINGS = "warnings.json";

    private static final List<String> FILE_ORDER = List.of(FILE_MAIN, FILE_VARIABLES, FILE_OUTPUTS, FILE_README);

    private static final DateTimeFormatter HEADER_TIMESTAMP =
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Aggregated output of {@link #assemble(List, TerraformContext)}.
     *
     * <p>{@code filesByName} maps each top-level filename (e.g. {@code main.tf})
     * to its full UTF-8 string content. {@code warnings} is the aggregated list
     * of warning strings collected from all {@link EmittedResource} entries.
     */
    public record AssembledOutput(
        Map<String, String> filesByName,
        List<String> warnings,
        String warningsJson
    ) {}

    /**
     * Build the 4 file contents + warnings list + warnings.json payload.
     *
     * <p>Steps:
     * <ol>
     *   <li>Group {@code resources} by {@code targetFile}.</li>
     *   <li>For each known target file, prepend a top-level header (provider,
     *       generated-at timestamp), then concatenate each resource's comment
     *       lines (each prefixed with {@code # }) followed by the
     *       {@code hclFragment}, separated by a single blank line.</li>
     *   <li>Walk every infra entity in {@code ctx.entities()} parsing the
     *       {@code terraform_variable_hints} JSON into one
     *       {@code variable "<name>" {}} block per top-level key, appended to
     *       {@code variables.tf}.</li>
     *   <li>Build {@code README.md} from a template (project / architecture
     *       context, file list, warnings summary).</li>
     *   <li>Build a {@code warnings.json} JSON array.</li>
     * </ol>
     */
    public AssembledOutput assemble(List<EmittedResource> resources, TerraformContext ctx) {
        if (resources == null) resources = List.of();
        Map<String, List<EmittedResource>> grouped = groupByTargetFile(resources);

        // Header timestamp (single instant for the whole output)
        String now = LocalDateTime.now().format(HEADER_TIMESTAMP);

        Map<String, String> files = new LinkedHashMap<>();
        for (String fileName : FILE_ORDER) {
            List<EmittedResource> bucket = grouped.getOrDefault(fileName, List.of());
            files.put(fileName, buildFile(fileName, bucket, ctx, now));
        }

        // Append variable_hints-derived blocks to variables.tf.
        String varHints = buildVariableHintsBlocks(ctx);
        if (!varHints.isEmpty()) {
            files.put(FILE_VARIABLES, files.get(FILE_VARIABLES) + "\n" + varHints);
        }

        // Replace README with rich version including file list + warning summary.
        files.put(FILE_README, buildReadme(ctx, now, resources));

        // Aggregate warnings.
        List<String> warnings = new ArrayList<>();
        for (EmittedResource r : resources) {
            if (r.warnings() != null) warnings.addAll(r.warnings());
        }
        String warningsJson = buildWarningsJson(warnings);

        return new AssembledOutput(Collections.unmodifiableMap(files), warnings, warningsJson);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    private static Map<String, List<EmittedResource>> groupByTargetFile(List<EmittedResource> resources) {
        Map<String, List<EmittedResource>> out = new LinkedHashMap<>();
        for (EmittedResource r : resources) {
            if (r == null || r.targetFile() == null) continue;
            out.computeIfAbsent(r.targetFile(), x -> new ArrayList<>()).add(r);
        }
        return out;
    }

    private String buildFile(String fileName,
                             List<EmittedResource> bucket,
                             TerraformContext ctx,
                             String timestamp) {
        StringBuilder sb = new StringBuilder();
        sb.append(buildFileHeader(fileName, ctx, timestamp));

        if (bucket.isEmpty()) {
            sb.append('\n').append("# (no resources of this kind generated)\n");
            return sb.toString();
        }

        boolean first = true;
        for (EmittedResource r : bucket) {
            if (!first) {
                sb.append('\n');
            }
            first = false;
            // Comment lines (already prefixed with '#' by the emitter).
            if (r.comments() != null) {
                for (String c : r.comments()) {
                    if (c == null) continue;
                    sb.append(c);
                    if (!c.endsWith("\n")) sb.append('\n');
                }
            }
            String frag = r.hclFragment() == null ? "" : r.hclFragment();
            sb.append(frag);
            if (!frag.isEmpty() && !frag.endsWith("\n")) {
                sb.append('\n');
            }
        }
        return sb.toString();
    }

    private static String buildFileHeader(String fileName, TerraformContext ctx, String timestamp) {
        StringBuilder sb = new StringBuilder();
        sb.append("# Generated by Infrastructure Terraform Export\n");
        sb.append("# File: ").append(fileName).append('\n');
        sb.append("# Provider: ").append(ctx == null || ctx.providerId() == null ? "GCP" : ctx.providerId()).append('\n');
        if (ctx != null && ctx.selectedEnvironment() != null) {
            sb.append("# Environment: ").append(ctx.selectedEnvironment().name()).append('\n');
        }
        sb.append("# Generated: ").append(timestamp).append('\n');
        sb.append("# DRAFT -- review TODO comments and warnings.json before apply.\n");
        return sb.toString();
    }

    /**
     * Walks every infra entity in {@code ctx.entities()} that exposes a
     * {@code terraform_variable_hints} field and parses each top-level JSON
     * key into a {@code variable "<name>" { ... }} block.
     */
    private String buildVariableHintsBlocks(TerraformContext ctx) {
        if (ctx == null || ctx.entities() == null) return "";
        StringBuilder sb = new StringBuilder();
        // De-dupe by variable name (last wins) so duplicates across entities
        // don't produce conflicting blocks.
        Map<String, String> uniqueBlocks = new LinkedHashMap<>();

        appendVarHintsFromEntityList(uniqueBlocks, hintsFor(ctx.entities()));

        for (String block : uniqueBlocks.values()) {
            sb.append(block);
            if (!block.endsWith("\n")) sb.append('\n');
        }
        return sb.toString();
    }

    /**
     * Extract every non-null {@code terraform_variable_hints} JSON string from
     * the entity lists. Uses reflection on each list element to locate the
     * accessor; this keeps the assembler decoupled from each entity's record
     * shape.
     */
    private static List<String> hintsFor(MetaModelEntitiesDto entities) {
        List<String> out = new ArrayList<>();
        if (entities == null) return out;
        // The 12 Infrastructure entity DTOs all carry a
        // String terraformVariableHints() accessor by spec 7. We collect from
        // every list field whose elements expose that accessor.
        for (java.lang.reflect.RecordComponent rc : MetaModelEntitiesDto.class.getRecordComponents()) {
            try {
                Object value = rc.getAccessor().invoke(entities);
                if (!(value instanceof List<?> list)) continue;
                for (Object item : list) {
                    if (item == null) continue;
                    try {
                        java.lang.reflect.Method m = item.getClass().getMethod("terraformVariableHints");
                        Object hints = m.invoke(item);
                        if (hints instanceof String s && !s.isBlank()) {
                            out.add(s);
                        }
                    } catch (NoSuchMethodException ignored) {
                        // entity doesn't expose terraformVariableHints; skip
                    }
                }
            } catch (Exception ignored) {
                // best-effort introspection; never fail the export
            }
        }
        return out;
    }

    private void appendVarHintsFromEntityList(Map<String, String> out, List<String> jsonStrings) {
        for (String json : jsonStrings) {
            try {
                JsonNode node = objectMapper.readTree(json);
                if (node.isObject()) {
                    Iterator<Map.Entry<String, JsonNode>> fields = node.fields();
                    while (fields.hasNext()) {
                        Map.Entry<String, JsonNode> e = fields.next();
                        out.put(e.getKey(), buildVariableBlock(e.getKey(), e.getValue()));
                    }
                } else if (node.isArray()) {
                    // Tolerate array form: [{name, type, description, default}, ...]
                    for (JsonNode entry : node) {
                        if (!entry.isObject()) continue;
                        JsonNode nameNode = entry.get("name");
                        if (nameNode == null || !nameNode.isTextual()) continue;
                        String name = nameNode.asText();
                        out.put(name, buildVariableBlock(name, entry));
                    }
                }
            } catch (Exception ignored) {
                // Malformed JSON: skip silently. The emitter-level warnings
                // surface incomplete data; assembler must never fail.
            }
        }
    }

    /**
     * Build a HCL {@code variable "<name>" { ... }} block from a JSON value.
     * Tolerates either a scalar default value or an object carrying
     * {@code type}/{@code description}/{@code default}.
     */
    private static String buildVariableBlock(String name, JsonNode value) {
        StringBuilder sb = new StringBuilder();
        sb.append("variable \"").append(name).append("\" {\n");
        String type = "string";
        String description = null;
        JsonNode defaultValue = null;
        if (value.isObject()) {
            JsonNode t = value.get("type");
            if (t != null && t.isTextual()) type = t.asText();
            JsonNode d = value.get("description");
            if (d != null && d.isTextual()) description = d.asText();
            defaultValue = value.get("default");
        } else {
            defaultValue = value;
        }
        if (description != null) {
            sb.append("  description = \"").append(escapeHcl(description)).append("\"\n");
        }
        sb.append("  type        = ").append(type).append('\n');
        if (defaultValue != null && !defaultValue.isNull()) {
            sb.append("  default     = ");
            if (defaultValue.isTextual()) {
                sb.append('"').append(escapeHcl(defaultValue.asText())).append('"');
            } else {
                sb.append(defaultValue.toString());
            }
            sb.append('\n');
        }
        sb.append("}\n");
        return sb.toString();
    }

    private static String escapeHcl(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    private static String buildReadme(TerraformContext ctx,
                                      String timestamp,
                                      List<EmittedResource> resources) {
        StringBuilder sb = new StringBuilder();
        sb.append("# Infrastructure Terraform Export\n\n");
        sb.append("Generated by the Architecture Model Service Terraform export feature.\n\n");
        sb.append("## Context\n\n");
        sb.append("- Provider: `").append(ctx == null || ctx.providerId() == null ? "GCP" : ctx.providerId()).append("`\n");
        if (ctx != null && ctx.selectedEnvironment() != null) {
            sb.append("- Environment: `").append(ctx.selectedEnvironment().name()).append("`\n");
        }
        if (ctx != null && ctx.selectedCloudAccount() != null) {
            sb.append("- Cloud Account: `").append(ctx.selectedCloudAccount().name()).append("`\n");
        } else {
            sb.append("- Cloud Account: _not selected_\n");
        }
        if (ctx != null && ctx.selectedLocation() != null) {
            sb.append("- Location: `").append(ctx.selectedLocation().name()).append("`\n");
        } else {
            sb.append("- Location: _not selected_\n");
        }
        sb.append("- Generated: ").append(timestamp).append("\n\n");

        sb.append("## Files\n\n");
        sb.append("- `main.tf` -- resource blocks per Infrastructure concept.\n");
        sb.append("- `variables.tf` -- variables declared from `terraform_variable_hints` plus standard env/region/project variables.\n");
        sb.append("- `outputs.tf` -- exported outputs.\n");
        sb.append("- `README.md` -- this file.\n");
        sb.append("- `warnings.json` -- soft-warn entries (TODOs surfaced inline as `# TODO` comments).\n\n");

        // Aggregated warnings preview.
        List<String> warnings = new ArrayList<>();
        for (EmittedResource r : resources) {
            if (r.warnings() != null) warnings.addAll(r.warnings());
        }
        sb.append("## Warnings / TODOs\n\n");
        if (warnings.isEmpty()) {
            sb.append("_None._\n\n");
        } else {
            for (String w : warnings) {
                sb.append("- ").append(w).append('\n');
            }
            sb.append('\n');
        }
        sb.append("## Draft Notice\n\n");
        sb.append("This export is a DRAFT. Review every `# TODO` comment in the generated\n");
        sb.append("files and the `warnings.json` payload before running `terraform plan`.\n");
        sb.append("This export feature does NOT call `terraform init` / `plan` / `apply`,\n");
        sb.append("does NOT contact GCP APIs, and does NOT handle credentials.\n");
        return sb.toString();
    }

    private String buildWarningsJson(List<String> warnings) {
        try {
            return objectMapper.writerWithDefaultPrettyPrinter()
                .writeValueAsString(Map.of("warnings", warnings));
        } catch (Exception e) {
            // Fallback: hand-rolled minimal JSON.
            StringBuilder sb = new StringBuilder();
            sb.append("{\n  \"warnings\": [");
            for (int i = 0; i < warnings.size(); i++) {
                sb.append("\n    \"").append(escapeJson(warnings.get(i))).append('"');
                if (i < warnings.size() - 1) sb.append(',');
            }
            sb.append("\n  ]\n}\n");
            return sb.toString();
        }
    }

    private static String escapeJson(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t");
    }
}
