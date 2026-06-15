package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclAttribute;
import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;
import com.example.architecturemodel.service.import_.terraform.hcl.HclValue;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * One-hop resolver for {@code var.x} references.
 *
 * <p>Resolution priority (Q5):
 * <ol>
 *   <li>User-supplied import option matching the variable name (well-known
 *       names: {@code repository_url}, {@code branch}, {@code commit_sha},
 *       {@code path}, {@code workspace}; plus {@code environment_id} /
 *       {@code cloud_account_id} / {@code location_id} when supplied).</li>
 *   <li>{@code variable "<name>" { default = "<literal>" }} block parsed from
 *       any HCL file in the upload. Only LITERAL defaults are honoured --
 *       a default that is itself a {@code var.x} / {@code local.x} / function
 *       call does NOT recurse (one-hop rule).</li>
 *   <li>{@link Optional#empty()} -- caller emits TODO warning and the
 *       reference text is preserved verbatim on the candidate evidence.</li>
 * </ol>
 *
 * <p>Pure: no I/O, no Spring deps beyond {@code @Component}, no LLM. Safe to
 * register as a singleton bean.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 4.2
 */
@Component
public class VariableResolver {

    /**
     * Resolve {@code var.<varName>} to its literal value.
     *
     * @return the resolved literal as a Java type ({@link String} for STRING /
     *     unsupported expressions, {@link java.math.BigDecimal} for numbers,
     *     {@link Boolean} for bools), or {@link Optional#empty()} if no
     *     override or literal default is found.
     */
    public Optional<Object> resolveVarRef(String varName, TerraformImportContext ctx) {
        if (varName == null || varName.isBlank() || ctx == null) {
            return Optional.empty();
        }

        // Priority 1: user-supplied import option matching the var name.
        Object userOverride = lookupUserOption(varName, ctx);
        if (userOverride != null) {
            return Optional.of(userOverride);
        }

        // Priority 2: variable "<varName>" { default = <literal> } in any HCL file.
        for (ParsedHclFile file : ctx.hclFiles()) {
            if (file == null || file.blocks() == null) continue;
            for (HclBlock block : file.blocks()) {
                if (block == null) continue;
                if (!"variable".equals(block.blockType())) continue;
                if (block.labels() == null || block.labels().isEmpty()) continue;
                if (!varName.equals(block.labels().get(0))) continue;
                Object literal = readLiteralAttr(block, "default");
                if (literal != null) {
                    return Optional.of(literal);
                }
            }
        }

        return Optional.empty();
    }

    /**
     * Best-effort variable-name to user-option map. Recognises:
     * <ul>
     *   <li>{@code repository_url}, {@code branch}, {@code commit_sha},
     *       {@code path}, {@code workspace} -- direct mapping to the
     *       form fields of the same name.</li>
     *   <li>{@code project} / {@code project_id} -- {@code cloudAccountId}
     *       (when present).</li>
     *   <li>{@code region} / {@code zone} / {@code location} -- {@code locationId}
     *       (when present; the form field is the location's id, NOT the
     *       region/zone string -- caller chooses whether to use the resolved
     *       value as evidence or substitute a different rendering).</li>
     *   <li>{@code environment} / {@code env} -- {@code environmentId}.</li>
     * </ul>
     */
    private static Object lookupUserOption(String varName, TerraformImportContext ctx) {
        switch (varName) {
            case "repository_url":
                return ctx.repositoryUrl();
            case "branch":
                return ctx.branch();
            case "commit_sha":
                return ctx.commitSha();
            case "path":
                return ctx.path();
            case "workspace":
                return ctx.workspace();
            case "project":
            case "project_id":
                return ctx.cloudAccountId();
            case "region":
            case "zone":
            case "location":
                return ctx.locationId();
            case "environment":
            case "env":
            case "environment_id":
                return ctx.environmentId();
            default:
                return null;
        }
    }

    /**
     * Read a single attribute as a literal Java value.
     *
     * <p>Returns {@code null} for missing, reference, or unsupported-expression
     * values -- the one-hop rule means we never follow {@code default = var.y}.
     */
    private static Object readLiteralAttr(HclBlock block, String attrName) {
        if (block.attributes() == null) return null;
        for (HclAttribute attr : block.attributes()) {
            if (attr == null) continue;
            if (!attrName.equals(attr.name())) continue;
            return literalOrNull(attr.value());
        }
        return null;
    }

    private static Object literalOrNull(HclValue v) {
        if (v == null) return null;
        if (v instanceof HclValue.StringValue sv) return sv.value();
        if (v instanceof HclValue.NumberValue nv) return nv.value();
        if (v instanceof HclValue.BoolValue bv) return bv.value();
        if (v instanceof HclValue.ListValue lv) {
            // List of literals only (no nested refs).
            for (HclValue item : lv.items()) {
                if (item == null) continue;
                if (item instanceof HclValue.ReferenceValue) return null;
                if (item instanceof HclValue.RawValue) return null;
            }
            return lv;
        }
        if (v instanceof HclValue.MapValue mv) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<String, HclValue> e : mv.entries().entrySet()) {
                Object inner = literalOrNull(e.getValue());
                if (inner == null) return null; // not pure literal
                out.put(e.getKey(), inner);
            }
            return out;
        }
        // ReferenceValue / RawValue -> not a literal -> null (one-hop only).
        return null;
    }
}
