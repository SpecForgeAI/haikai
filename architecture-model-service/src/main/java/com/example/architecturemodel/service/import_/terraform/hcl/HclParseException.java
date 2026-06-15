package com.example.architecturemodel.service.import_.terraform.hcl;

/**
 * Runtime exception raised by {@link HclLexer} / {@link HclParser} for
 * genuinely malformed HCL fragments (mismatched braces, unterminated string,
 * etc.).
 *
 * <p><b>NOT</b> thrown for unknown identifiers, unsupported expressions, or
 * any syntactically valid construct outside the locked subset. Such inputs
 * are tolerated by capturing the raw source text on a
 * {@link HclValue.RawValue} and continuing -- the importer's contract
 * (Q1=b, hand-rolled tolerant subset) is to soft-warn, never crash.
 *
 * <p>{@link HclSourceFile} catches this exception at the file boundary,
 * appends a soft-warn entry to the result-level warnings collector, and
 * returns whatever was parsed up to the failure point.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.2
 */
public class HclParseException extends RuntimeException {

    private final int line;
    private final int column;

    public HclParseException(String message, int line, int column) {
        super(message + " at line " + line + ", column " + column);
        this.line = line;
        this.column = column;
    }

    public HclParseException(String message, int line, int column, Throwable cause) {
        super(message + " at line " + line + ", column " + column, cause);
        this.line = line;
        this.column = column;
    }

    public int line() { return line; }
    public int column() { return column; }
}
