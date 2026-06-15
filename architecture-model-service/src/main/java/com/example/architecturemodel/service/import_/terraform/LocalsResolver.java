package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclAttribute;
import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;
import com.example.architecturemodel.service.import_.terraform.hcl.HclValue;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * One-hop resolver for {@code local.x} references.
 *
 * <p>Walks every {@code locals { ... }} block in every parsed HCL file looking
 * for an entry whose key matches the requested {@code localName}. Returns the
 * literal value when the entry is a STRING / NUMBER / BOOL; returns
 * {@link Optional#empty()} for any non-literal entry (e.g. {@code local.x =
 * "${var.y}"} or {@code local.x = local.y}).
 *
 * <p>Pure: no I/O, no LLM, no var/local recursion (the locked one-hop rule
 * from Q5).
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 4.3
 */
@Component
public class LocalsResolver {

    /**
     * Resolve {@code local.<localName>} to its literal value.
     *
     * @return the resolved literal as a Java type ({@link String} /
     *     {@link java.math.BigDecimal} / {@link Boolean}); or
     *     {@link Optional#empty()} if no matching key is found OR the matched
     *     entry is not a literal.
     */
    public Optional<Object> resolveLocalRef(String localName, TerraformImportContext ctx) {
        if (localName == null || localName.isBlank() || ctx == null) {
            return Optional.empty();
        }
        for (ParsedHclFile file : ctx.hclFiles()) {
            if (file == null || file.blocks() == null) continue;
            for (HclBlock block : file.blocks()) {
                if (block == null) continue;
                if (!"locals".equals(block.blockType())) continue;
                if (block.attributes() == null) continue;
                for (HclAttribute attr : block.attributes()) {
                    if (attr == null) continue;
                    if (!localName.equals(attr.name())) continue;
                    Object literal = literalOrNull(attr.value());
                    if (literal != null) {
                        return Optional.of(literal);
                    }
                    // Matched the name but value is non-literal -- one-hop
                    // rule says we stop here (caller emits TODO).
                    return Optional.empty();
                }
            }
        }
        return Optional.empty();
    }

    private static Object literalOrNull(HclValue v) {
        if (v == null) return null;
        if (v instanceof HclValue.StringValue sv) return sv.value();
        if (v instanceof HclValue.NumberValue nv) return nv.value();
        if (v instanceof HclValue.BoolValue bv) return bv.value();
        // ReferenceValue / RawValue / List / Map -> not a primitive literal.
        // Per the spec, locals-resolver is locked to STRING / NUMBER / BOOL
        // literals only. Compound literals fall through.
        return null;
    }
}
