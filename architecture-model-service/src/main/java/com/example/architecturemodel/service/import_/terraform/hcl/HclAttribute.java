package com.example.architecturemodel.service.import_.terraform.hcl;

/**
 * Single {@code name = value} attribute inside an HCL block body.
 *
 * <p>{@code line} is the 1-indexed source line of the attribute name --
 * driven by the lexer's per-token line tracking and used for accurate
 * {@code IaCResourceBinding.start_line} provenance.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.2
 */
public record HclAttribute(
    String name,
    HclValue value,
    int line
) {
    public HclAttribute {
        if (name == null) {
            throw new IllegalArgumentException("attribute name must not be null");
        }
        if (value == null) {
            throw new IllegalArgumentException("attribute value must not be null");
        }
    }
}
