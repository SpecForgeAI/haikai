package com.example.architecturemodel.service.import_.terraform.hcl;

import com.example.architecturemodel.service.import_.terraform.ParsedHclFile;

import java.util.List;

/**
 * Orchestration helper combining {@link HclLexer} + {@link HclParser} +
 * {@link ParsedHclFile} construction.
 *
 * <p>Catches {@link HclParseException} at the file boundary and turns it
 * into a soft-warn entry in the supplied {@code warnings} collector,
 * returning whatever was parsed up to that point. This implements the Q1=b
 * "soft-warn over crash" tolerance contract at the file level: a single
 * malformed file does not abort the whole import.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.4
 */
public final class HclSourceFile {

    private HclSourceFile() {}

    /**
     * Parse a single HCL file's source into a {@link ParsedHclFile}.
     *
     * @param filePath path relative to the upload root (ZIP entry path or
     *     bare filename); preserved verbatim on the resulting record for
     *     {@code IaCResourceBinding.file_path} provenance.
     * @param content the file's raw text content.
     * @param warnings mutable warnings collector; {@code null} disables
     *     soft-warn capture (the parse exception will then propagate).
     */
    public static ParsedHclFile parse(String filePath, String content, List<String> warnings) {
        if (content == null) content = "";
        try {
            HclLexer lexer = new HclLexer(content);
            HclParser parser = new HclParser(lexer);
            List<HclBlock> blocks = parser.parse();
            return new ParsedHclFile(filePath, content, blocks);
        } catch (HclParseException ex) {
            if (warnings != null) {
                warnings.add("unparseable HCL in " + filePath + ": " + ex.getMessage());
                return new ParsedHclFile(filePath, content, List.of());
            }
            throw ex;
        }
    }

    /**
     * Parse a single HCL file with a strict mode (no warnings collector --
     * any {@link HclParseException} propagates). Useful for tests that want
     * to assert the exception shape.
     */
    public static ParsedHclFile parseStrict(String filePath, String content) {
        return parse(filePath, content, null);
    }
}
