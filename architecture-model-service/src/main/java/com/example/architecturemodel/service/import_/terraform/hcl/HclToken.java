package com.example.architecturemodel.service.import_.terraform.hcl;

/**
 * Single token emitted by {@link HclLexer}.
 *
 * <p>Carries source-line + column for accurate
 * {@code IaCResourceBinding.start_line} / {@code end_line} provenance --
 * round-trip stability with the export contract depends on this. Line +
 * column are 1-indexed.
 *
 * <p>For STRING tokens, {@code text} contains the unescaped string value
 * (e.g. {@code "line1\nline2"} → {@code text == "line1\nline2"} where
 * {@code \n} is an actual newline byte). The verbatim source text is not
 * preserved on the token; the parser captures verbatim source slices when
 * it encounters expressions it cannot classify.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.2
 */
public record HclToken(
    HclTokenType type,
    String text,
    int line,
    int column
) {
    public HclToken {
        if (type == null) {
            throw new IllegalArgumentException("token type must not be null");
        }
        if (text == null) {
            text = "";
        }
    }
}
