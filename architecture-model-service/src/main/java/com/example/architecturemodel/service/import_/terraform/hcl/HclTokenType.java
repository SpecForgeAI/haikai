package com.example.architecturemodel.service.import_.terraform.hcl;

/**
 * Token kinds produced by {@link HclLexer}.
 *
 * <p>The hand-rolled subset lexer recognises just enough HCL to drive the
 * tolerant parser used by the Terraform import pipeline. Unknown bytes are
 * tolerated by emitting an {@link #UNKNOWN} token and surfacing a warning
 * rather than crashing.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.2
 */
public enum HclTokenType {

    /** Bare identifier (block keyword, attribute name, reference path part). */
    IDENT,

    /** Quoted string literal (with escapes already unescaped on {@code text}). */
    STRING,

    /** Integer / decimal / scientific number literal. */
    NUMBER,

    /** Boolean literal {@code true} / {@code false}. */
    BOOL,

    /** Open brace {@code &#123;}. */
    LBRACE,

    /** Close brace {@code &#125;}. */
    RBRACE,

    /** Open bracket {@code [}. */
    LBRACKET,

    /** Close bracket {@code ]}. */
    RBRACKET,

    /** Equals {@code =}. */
    EQUALS,

    /** Comma {@code ,}. */
    COMMA,

    /** Colon {@code :} (object literal kv separator). */
    COLON,

    /** Dot {@code .} (reference path separator). */
    DOT,

    /** End of input sentinel. */
    EOF,

    /** Unknown / unrecognised character (tolerated, surfaced via warning). */
    UNKNOWN
}
