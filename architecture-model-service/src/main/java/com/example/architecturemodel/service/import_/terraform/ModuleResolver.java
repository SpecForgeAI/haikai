package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclAttribute;
import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;
import com.example.architecturemodel.service.import_.terraform.hcl.HclValue;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Local-module resolver.
 *
 * <p>Reads {@code source = "..."} on a {@code module "name" { ... }} block:
 * <ul>
 *   <li>Local relative path ({@code "./modules/x"}, {@code "../shared/y"})
 *       AND matching {@code .tf} files exist in the upload payload --
 *       returns the resource blocks parsed from those files. Caller can
 *       then classify them as candidates with the calling module's prefix.
 *       Per Q5 the file paths are preserved verbatim
 *       ({@code "modules/x/main.tf"}) and module-variable parameter
 *       substitution is NOT performed in V1.</li>
 *   <li>Remote source ({@code "git::..."}, {@code "registry.terraform.io/..."},
 *       {@code "<owner>/<name>/<provider>"}) -- emits a soft-warn TODO and
 *       returns an empty list. NEVER attempts a network fetch (locked safety
 *       boundary).</li>
 *   <li>Missing source attribute or unresolved expression -- empty list +
 *       TODO warning.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 4.4
 */
@Component
public class ModuleResolver {

    /**
     * Resolve a {@code module "name" { source = "..." }} block to the parsed
     * resource blocks of the referenced module body, if locally available.
     *
     * <p>The returned list is a flat list of {@code resource} blocks --
     * caller classifies each one. Block {@code precedingComments} is augmented
     * with a {@code "# Module call: <name>"} marker so the candidate evidence
     * surfaces the calling module name.
     */
    public List<HclBlock> resolveLocalModule(HclBlock moduleBlock, TerraformImportContext ctx) {
        List<HclBlock> out = new ArrayList<>();
        if (moduleBlock == null || ctx == null) return out;
        if (!"module".equals(moduleBlock.blockType())) return out;

        String moduleName = (moduleBlock.labels() != null && !moduleBlock.labels().isEmpty())
            ? moduleBlock.labels().get(0)
            : "anonymous";

        String source = readStringAttr(moduleBlock, "source");
        if (source == null || source.isBlank()) {
            ctx.addWarning("module \"" + moduleName + "\" has no source attribute; skipping");
            return out;
        }

        // Remote sources (locked safety boundary -- NEVER fetch).
        if (isRemoteSource(source)) {
            ctx.addWarning("remote module not fetched: " + source);
            return out;
        }

        // Local relative path -- resolve against the upload's parsed file set.
        String normalisedDir = normaliseLocalDir(source);
        List<ParsedHclFile> matchingFiles = collectFilesUnderDir(normalisedDir, ctx);
        if (matchingFiles.isEmpty()) {
            ctx.addWarning("local module source \"" + source + "\" not found in upload; skipping");
            return out;
        }

        for (ParsedHclFile file : matchingFiles) {
            if (file.blocks() == null) continue;
            for (HclBlock block : file.blocks()) {
                if (block == null) continue;
                if (!"resource".equals(block.blockType())) continue;
                out.add(annotateWithModuleCall(block, moduleName));
            }
        }
        return out;
    }

    private static boolean isRemoteSource(String source) {
        if (source == null) return false;
        String s = source.trim();
        if (s.startsWith("git::")) return true;
        if (s.startsWith("github.com/")) return true;
        if (s.startsWith("bitbucket.org/")) return true;
        if (s.startsWith("https://") || s.startsWith("http://")) return true;
        if (s.startsWith("registry.terraform.io/")) return true;
        // Pattern "<owner>/<name>/<provider>" -- registry shorthand.
        if (s.indexOf('/') >= 0 && !s.startsWith("./") && !s.startsWith("../") && !s.startsWith("/")) {
            // Heuristic: if it looks like a path prefix (starts with letter
            // and has dots/slashes that match a registry shorthand)
            int slashes = 0;
            for (int i = 0; i < s.length(); i++) {
                if (s.charAt(i) == '/') slashes++;
            }
            // registry shorthand has exactly 2 slashes and no leading dot.
            if (slashes >= 2 && !s.contains(":")) return true;
        }
        return false;
    }

    /**
     * Normalise a relative module source to a directory prefix used for
     * matching {@link ParsedHclFile#filePath()}. Strips leading {@code "./"}
     * and trailing slash. {@code "./modules/network"} -> {@code "modules/network"}.
     */
    private static String normaliseLocalDir(String source) {
        String s = source.trim();
        while (s.startsWith("./")) s = s.substring(2);
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static List<ParsedHclFile> collectFilesUnderDir(String dirPrefix, TerraformImportContext ctx) {
        List<ParsedHclFile> out = new ArrayList<>();
        if (dirPrefix == null) return out;
        String prefix = dirPrefix.endsWith("/") ? dirPrefix : dirPrefix + "/";
        for (ParsedHclFile file : ctx.hclFiles()) {
            if (file == null || file.filePath() == null) continue;
            String fp = file.filePath();
            // accept files directly under dirPrefix (e.g. "modules/network/main.tf")
            if (fp.startsWith(prefix) && fp.endsWith(".tf")) {
                out.add(file);
            }
        }
        return out;
    }

    private static HclBlock annotateWithModuleCall(HclBlock block, String moduleName) {
        List<String> existing = block.precedingComments() == null
            ? new ArrayList<>()
            : new ArrayList<>(block.precedingComments());
        String marker = "# Module call: " + moduleName;
        if (!existing.contains(marker)) {
            existing.add(0, marker);
        }
        return new HclBlock(
            block.blockType(),
            block.labels(),
            block.attributes(),
            block.nestedBlocks(),
            block.startLine(),
            block.endLine(),
            existing
        );
    }

    private static String readStringAttr(HclBlock block, String attrName) {
        if (block == null || block.attributes() == null) return null;
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            if (!attrName.equals(attr.name())) continue;
            HclValue v = attr.value();
            if (v instanceof HclValue.StringValue sv) {
                return sv.value();
            }
            return v == null ? null : v.rawText();
        }
        return null;
    }
}
