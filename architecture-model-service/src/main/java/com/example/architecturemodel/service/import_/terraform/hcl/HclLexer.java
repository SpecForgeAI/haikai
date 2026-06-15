package com.example.architecturemodel.service.import_.terraform.hcl;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Hand-rolled tolerant subset HCL tokenizer.
 *
 * <p>Single-pass character-by-character scanner producing a {@link List} of
 * {@link HclToken}s with accurate 1-indexed line + column tracking. Comments
 * ({@code #}, {@code //}, {@code /* *&#47;}) are stripped from the token
 * stream but accumulated into a parallel {@link Comment} list keyed by the
 * line they appeared on, so the parser can re-associate them with the
 * immediately-following block as {@code precedingComments}.
 *
 * <p>Locked contract:
 * <ul>
 *   <li>Zero new Maven dependencies.</li>
 *   <li>Tolerant for unrecognised characters (emits {@link HclTokenType#UNKNOWN}
 *       rather than throwing) -- only genuinely malformed inputs (unterminated
 *       string literal, unterminated block comment) raise
 *       {@link HclParseException}.</li>
 *   <li>Line numbers MUST be accurate: every emitted token carries the line
 *       its first byte appeared on.</li>
 *   <li>STRING tokens' {@link HclToken#text()} is the unescaped runtime
 *       string. The verbatim source slice (with surrounding quotes + escape
 *       sequences) is reconstructed by the parser when it builds
 *       {@link HclValue.StringValue}.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.3
 */
public final class HclLexer {

    /**
     * Comment captured by the lexer with its source line for re-association
     * by the parser. {@code line} is the 1-indexed line the comment opener
     * (e.g. {@code #} or {@code //} or {@code /*}) appeared on.
     */
    public record Comment(String text, int line) {}

    private final String source;
    private int pos;
    private int line;
    private int column;

    private final List<Comment> comments = new ArrayList<>();

    public HclLexer(String source) {
        this.source = source == null ? "" : source;
        this.pos = 0;
        this.line = 1;
        this.column = 1;
    }

    /**
     * Tokenize the full source. Returns the token stream ending with a single
     * {@link HclTokenType#EOF}. Comments are stripped from the stream and
     * available via {@link #comments()}.
     *
     * @throws HclParseException only for genuinely malformed inputs
     *     (unterminated string literal, unterminated block comment) -- the
     *     lexer is otherwise tolerant.
     */
    public List<HclToken> tokenize() {
        List<HclToken> tokens = new ArrayList<>();
        while (pos < source.length()) {
            char c = source.charAt(pos);

            // whitespace (incl. newlines)
            if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
                advance();
                continue;
            }

            // comments
            if (c == '#') {
                consumeLineComment("#");
                continue;
            }
            if (c == '/' && pos + 1 < source.length() && source.charAt(pos + 1) == '/') {
                consumeLineComment("//");
                continue;
            }
            if (c == '/' && pos + 1 < source.length() && source.charAt(pos + 1) == '*') {
                consumeBlockComment();
                continue;
            }

            int startLine = line;
            int startColumn = column;

            // single-character tokens
            switch (c) {
                case '{':
                    tokens.add(new HclToken(HclTokenType.LBRACE, "{", startLine, startColumn));
                    advance();
                    continue;
                case '}':
                    tokens.add(new HclToken(HclTokenType.RBRACE, "}", startLine, startColumn));
                    advance();
                    continue;
                case '[':
                    tokens.add(new HclToken(HclTokenType.LBRACKET, "[", startLine, startColumn));
                    advance();
                    continue;
                case ']':
                    tokens.add(new HclToken(HclTokenType.RBRACKET, "]", startLine, startColumn));
                    advance();
                    continue;
                case '=':
                    tokens.add(new HclToken(HclTokenType.EQUALS, "=", startLine, startColumn));
                    advance();
                    continue;
                case ',':
                    tokens.add(new HclToken(HclTokenType.COMMA, ",", startLine, startColumn));
                    advance();
                    continue;
                case ':':
                    tokens.add(new HclToken(HclTokenType.COLON, ":", startLine, startColumn));
                    advance();
                    continue;
                case '.':
                    tokens.add(new HclToken(HclTokenType.DOT, ".", startLine, startColumn));
                    advance();
                    continue;
                default:
                    // fall through
            }

            // string literal
            if (c == '"') {
                tokens.add(readString(startLine, startColumn));
                continue;
            }

            // number literal
            if (isDigit(c) || (c == '-' && pos + 1 < source.length() && isDigit(source.charAt(pos + 1)))) {
                tokens.add(readNumber(startLine, startColumn));
                continue;
            }

            // identifier / bool keyword
            if (isIdentStart(c)) {
                tokens.add(readIdentOrBool(startLine, startColumn));
                continue;
            }

            // unknown byte -- tolerate, emit UNKNOWN token, advance
            tokens.add(new HclToken(HclTokenType.UNKNOWN, String.valueOf(c), startLine, startColumn));
            advance();
        }
        tokens.add(new HclToken(HclTokenType.EOF, "", line, column));
        return tokens;
    }

    /** Comments captured during the most recent {@link #tokenize()} call, in source order. */
    public List<Comment> comments() {
        return Collections.unmodifiableList(comments);
    }

    /** Source string the lexer was constructed with (verbatim). */
    public String source() {
        return source;
    }

    // ---------------------------------------------------------------------
    // private scanners
    // ---------------------------------------------------------------------

    private HclToken readString(int startLine, int startColumn) {
        advance(); // consume opening "
        StringBuilder unescaped = new StringBuilder();
        while (pos < source.length()) {
            char c = source.charAt(pos);
            if (c == '"') {
                advance(); // consume closing "
                return new HclToken(HclTokenType.STRING, unescaped.toString(), startLine, startColumn);
            }
            if (c == '\\' && pos + 1 < source.length()) {
                char esc = source.charAt(pos + 1);
                advance(); // consume backslash
                advance(); // consume escape char
                switch (esc) {
                    case 'n':
                        unescaped.append('\n');
                        break;
                    case 't':
                        unescaped.append('\t');
                        break;
                    case 'r':
                        unescaped.append('\r');
                        break;
                    case '"':
                        unescaped.append('"');
                        break;
                    case '\\':
                        unescaped.append('\\');
                        break;
                    case '$':
                        unescaped.append('$');
                        break;
                    default:
                        // unknown escape -- keep verbatim (backslash then char)
                        unescaped.append('\\').append(esc);
                }
                continue;
            }
            // Bare newline before closing quote -> malformed (the tolerant subset
            // does not implement HCL heredocs).
            if (c == '\n') {
                throw new HclParseException(
                    "unterminated string literal", startLine, startColumn);
            }
            unescaped.append(c);
            advance();
        }
        throw new HclParseException(
            "unterminated string literal", startLine, startColumn);
    }

    private HclToken readNumber(int startLine, int startColumn) {
        int start = pos;
        if (source.charAt(pos) == '-') {
            advance();
        }
        while (pos < source.length() && isDigit(source.charAt(pos))) {
            advance();
        }
        if (pos < source.length() && source.charAt(pos) == '.') {
            advance();
            while (pos < source.length() && isDigit(source.charAt(pos))) {
                advance();
            }
        }
        if (pos < source.length() && (source.charAt(pos) == 'e' || source.charAt(pos) == 'E')) {
            advance();
            if (pos < source.length() && (source.charAt(pos) == '+' || source.charAt(pos) == '-')) {
                advance();
            }
            while (pos < source.length() && isDigit(source.charAt(pos))) {
                advance();
            }
        }
        String text = source.substring(start, pos);
        return new HclToken(HclTokenType.NUMBER, text, startLine, startColumn);
    }

    private HclToken readIdentOrBool(int startLine, int startColumn) {
        int start = pos;
        while (pos < source.length() && isIdentPart(source.charAt(pos))) {
            advance();
        }
        String text = source.substring(start, pos);
        if ("true".equals(text) || "false".equals(text)) {
            return new HclToken(HclTokenType.BOOL, text, startLine, startColumn);
        }
        return new HclToken(HclTokenType.IDENT, text, startLine, startColumn);
    }

    private void consumeLineComment(String marker) {
        int startLine = line;
        // skip the marker chars
        for (int i = 0; i < marker.length(); i++) advance();
        StringBuilder buf = new StringBuilder();
        while (pos < source.length() && source.charAt(pos) != '\n') {
            buf.append(source.charAt(pos));
            advance();
        }
        // trailing newline (if any) consumed by the main loop
        comments.add(new Comment(buf.toString().strip(), startLine));
    }

    private void consumeBlockComment() {
        int startLine = line;
        int startColumn = column;
        // skip "/*"
        advance();
        advance();
        StringBuilder buf = new StringBuilder();
        while (pos < source.length()) {
            char c = source.charAt(pos);
            if (c == '*' && pos + 1 < source.length() && source.charAt(pos + 1) == '/') {
                advance(); // consume *
                advance(); // consume /
                comments.add(new Comment(buf.toString().strip(), startLine));
                return;
            }
            buf.append(c);
            advance();
        }
        throw new HclParseException(
            "unterminated block comment", startLine, startColumn);
    }

    private void advance() {
        if (pos >= source.length()) return;
        char c = source.charAt(pos);
        pos++;
        if (c == '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }

    private static boolean isIdentStart(char c) {
        return (c >= 'a' && c <= 'z')
            || (c >= 'A' && c <= 'Z')
            || c == '_';
    }

    private static boolean isIdentPart(char c) {
        return isIdentStart(c) || isDigit(c) || c == '-';
    }
}
