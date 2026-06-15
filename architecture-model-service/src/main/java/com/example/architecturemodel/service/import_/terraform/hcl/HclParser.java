package com.example.architecturemodel.service.import_.terraform.hcl;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Hand-rolled tolerant top-down recursive-descent HCL subset parser.
 *
 * <p>Consumes the {@link HclToken} stream produced by {@link HclLexer} into a
 * {@link List} of {@link HclBlock}s. Top-level constructs recognised:
 * {@code resource}, {@code module}, {@code variable}, {@code output},
 * {@code locals}, {@code provider}, {@code data} (treated as resource for
 * V1), {@code terraform} (parsed but produces a soft-warn in the importer
 * downstream).
 *
 * <p><b>Tolerance contract (Q1=b, Q5):</b>
 * <ul>
 *   <li>Unknown / unsupported expressions on the right-hand side of an
 *       attribute are captured as {@link HclValue.RawValue} preserving the
 *       verbatim source slice. Functions, ternaries, {@code for}
 *       comprehensions, interpolated strings with {@code "${...}"} logic,
 *       {@code count} / {@code for_each} -- all preserved, never thrown.</li>
 *   <li>Unknown top-level identifiers produce an {@link HclBlock} with the
 *       unknown {@code blockType} preserved; the classifier downstream
 *       decides what to do with it.</li>
 *   <li>Genuinely malformed inputs (mismatched braces, unterminated string)
 *       raise {@link HclParseException}. These are caught at the file
 *       boundary by {@link HclSourceFile}, surfaced as a soft-warn, and the
 *       parser returns whatever it parsed up to that point.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.4
 */
public final class HclParser {

    private final List<HclToken> tokens;
    private final List<HclLexer.Comment> comments;
    private final String source;
    private int idx;

    public HclParser(HclLexer lexer) {
        // tokenize lazily so the parser owns the lexer's full state
        this.tokens = lexer.tokenize();
        this.comments = lexer.comments();
        this.source = lexer.source();
        this.idx = 0;
    }

    /** Parse the full token stream into a list of top-level HCL blocks. */
    public List<HclBlock> parse() {
        List<HclBlock> blocks = new ArrayList<>();
        while (peek().type() != HclTokenType.EOF) {
            HclToken t = peek();
            if (t.type() == HclTokenType.IDENT) {
                blocks.add(parseBlock(blocks));
            } else {
                // tolerate stray tokens at the top level by skipping them; this
                // matches the Q1=b "soft-warn over crash" contract.
                advance();
            }
        }
        return blocks;
    }

    // ---------------------------------------------------------------------
    // block parser
    // ---------------------------------------------------------------------

    private HclBlock parseBlock(List<HclBlock> emittedSoFar) {
        HclToken keyword = expect(HclTokenType.IDENT);
        String blockType = keyword.text();
        int startLine = keyword.line();

        // labels: zero or more STRINGs (or IDENTs in `resource <type> "<name>"` form)
        List<String> labels = new ArrayList<>();
        while (peek().type() == HclTokenType.STRING || peek().type() == HclTokenType.IDENT) {
            // peek further: if the next thing is LBRACE we stop accumulating
            // labels. (`resource "google_compute_network" "vpc" {` consumes
            // 2 STRINGs; `locals {` consumes zero.)
            HclToken candidate = peek();
            // If we hit an IDENT that could be the start of an attribute
            // (`name = ...`), stop. Heuristic: if we've already opened LBRACE
            // we'd never reach here.
            // The simplest disambiguator: only accept STRING tokens as labels.
            // HCL syntax: labels are quoted in canonical form. Any IDENT we see
            // before LBRACE here is treated as a label only if the next token
            // after it is STRING or LBRACE (i.e. there are more labels coming).
            if (candidate.type() == HclTokenType.IDENT) {
                // attribute-form check: IDENT EQUALS would be inside the body, not at label position.
                // We're not inside a body yet (no LBRACE consumed), so this IDENT must be a label.
                // But guard: don't loop forever -- bail if next is EOF
                if (idx + 1 >= tokens.size() || tokens.get(idx + 1).type() == HclTokenType.EOF) {
                    break;
                }
            }
            labels.add(candidate.text());
            advance();
        }

        HclToken openBrace = expect(HclTokenType.LBRACE);
        // body
        List<HclAttribute> attributes = new ArrayList<>();
        List<HclBlock> nestedBlocks = new ArrayList<>();
        parseBody(attributes, nestedBlocks);
        HclToken closeBrace = expect(HclTokenType.RBRACE);
        int endLine = closeBrace.line();

        List<String> precedingComments = collectPrecedingComments(emittedSoFar, startLine);

        return new HclBlock(
            blockType,
            labels,
            attributes,
            nestedBlocks,
            startLine,
            endLine,
            precedingComments
        );
    }

    private void parseBody(List<HclAttribute> attributes, List<HclBlock> nestedBlocks) {
        while (peek().type() != HclTokenType.RBRACE && peek().type() != HclTokenType.EOF) {
            if (peek().type() != HclTokenType.IDENT) {
                // tolerate stray tokens by skipping
                advance();
                continue;
            }

            // Disambiguate: IDENT (STRING|IDENT)* LBRACE ... RBRACE  -> nested block
            //               IDENT EQUALS <value>                      -> attribute
            int look = idx + 1;
            while (look < tokens.size()
                && (tokens.get(look).type() == HclTokenType.STRING
                    || tokens.get(look).type() == HclTokenType.IDENT)) {
                look++;
            }
            if (look < tokens.size() && tokens.get(look).type() == HclTokenType.LBRACE) {
                // nested block
                nestedBlocks.add(parseNestedBlock());
            } else if (look < tokens.size() && tokens.get(look).type() == HclTokenType.EQUALS) {
                attributes.add(parseAttribute());
            } else {
                // tolerate -- skip to next RBRACE-or-NEWLINE-equivalent
                advance();
            }
        }
    }

    private HclBlock parseNestedBlock() {
        HclToken keyword = expect(HclTokenType.IDENT);
        String blockType = keyword.text();
        int startLine = keyword.line();
        List<String> labels = new ArrayList<>();
        while (peek().type() == HclTokenType.STRING || peek().type() == HclTokenType.IDENT) {
            labels.add(peek().text());
            advance();
        }
        expect(HclTokenType.LBRACE);
        List<HclAttribute> attrs = new ArrayList<>();
        List<HclBlock> nested = new ArrayList<>();
        parseBody(attrs, nested);
        HclToken closeBrace = expect(HclTokenType.RBRACE);
        return new HclBlock(blockType, labels, attrs, nested,
            startLine, closeBrace.line(), List.of());
    }

    private HclAttribute parseAttribute() {
        HclToken nameToken = expect(HclTokenType.IDENT);
        expect(HclTokenType.EQUALS);
        HclValue value = parseValue();
        return new HclAttribute(nameToken.text(), value, nameToken.line());
    }

    // ---------------------------------------------------------------------
    // value parser
    // ---------------------------------------------------------------------

    private HclValue parseValue() {
        HclToken t = peek();
        switch (t.type()) {
            case STRING: {
                advance();
                String unescaped = t.text();
                String raw = "\"" + escape(unescaped) + "\"";
                return new HclValue.StringValue(unescaped, raw);
            }
            case NUMBER: {
                advance();
                BigDecimal n;
                try {
                    n = new BigDecimal(t.text());
                } catch (NumberFormatException ex) {
                    return new HclValue.RawValue(t.text());
                }
                return new HclValue.NumberValue(n, t.text());
            }
            case BOOL: {
                advance();
                return new HclValue.BoolValue(Boolean.parseBoolean(t.text()), t.text());
            }
            case LBRACKET:
                return parseList();
            case LBRACE:
                return parseMap();
            case IDENT:
                return parseIdentExpression();
            default:
                // unknown / unsupported -- consume defensively until we hit a
                // statement boundary (NEWLINE-equivalent: COMMA, RBRACE, EOF).
                int startPos = t.column();
                int startLine = t.line();
                StringBuilder raw = new StringBuilder();
                while (peek().type() != HclTokenType.EOF
                    && peek().type() != HclTokenType.RBRACE
                    && peek().type() != HclTokenType.COMMA
                    && peek().line() == startLine) {
                    raw.append(peek().text()).append(" ");
                    advance();
                }
                return new HclValue.RawValue(raw.toString().trim());
        }
    }

    private HclValue parseList() {
        int startIdx = idx;
        expect(HclTokenType.LBRACKET);
        List<HclValue> items = new ArrayList<>();
        while (peek().type() != HclTokenType.RBRACKET && peek().type() != HclTokenType.EOF) {
            items.add(parseValue());
            if (peek().type() == HclTokenType.COMMA) {
                advance();
            }
        }
        expect(HclTokenType.RBRACKET);
        String raw = renderRange(startIdx, idx);
        return new HclValue.ListValue(items, raw);
    }

    private HclValue parseMap() {
        int startIdx = idx;
        expect(HclTokenType.LBRACE);
        Map<String, HclValue> entries = new LinkedHashMap<>();
        while (peek().type() != HclTokenType.RBRACE && peek().type() != HclTokenType.EOF) {
            HclToken keyTok = peek();
            String key;
            if (keyTok.type() == HclTokenType.IDENT || keyTok.type() == HclTokenType.STRING) {
                key = keyTok.text();
                advance();
            } else {
                // not a recognisable map -- treat the whole thing as raw and
                // gobble until matching RBRACE.
                while (peek().type() != HclTokenType.RBRACE && peek().type() != HclTokenType.EOF) {
                    advance();
                }
                expect(HclTokenType.RBRACE);
                String raw = renderRange(startIdx, idx);
                return new HclValue.RawValue(raw);
            }
            // separator: EQUALS or COLON
            if (peek().type() == HclTokenType.EQUALS || peek().type() == HclTokenType.COLON) {
                advance();
            } else {
                // malformed entry -- fall back to raw
                while (peek().type() != HclTokenType.RBRACE && peek().type() != HclTokenType.EOF) {
                    advance();
                }
                expect(HclTokenType.RBRACE);
                String raw = renderRange(startIdx, idx);
                return new HclValue.RawValue(raw);
            }
            HclValue v = parseValue();
            entries.put(key, v);
            if (peek().type() == HclTokenType.COMMA) {
                advance();
            }
        }
        expect(HclTokenType.RBRACE);
        String raw = renderRange(startIdx, idx);
        return new HclValue.MapValue(entries, raw);
    }

    /**
     * Parse a leading IDENT as either a reference traversal
     * ({@code var.x}, {@code local.x}, {@code module.x.y},
     * {@code &lt;resource_type&gt;.&lt;name&gt;.&lt;attr&gt;}) or as a fallback
     * raw expression (e.g. a function call {@code length(var.subnets)}).
     */
    private HclValue parseIdentExpression() {
        int startIdx = idx;
        List<String> parts = new ArrayList<>();
        parts.add(expect(HclTokenType.IDENT).text());
        while (peek().type() == HclTokenType.DOT) {
            advance(); // consume DOT
            HclToken next = peek();
            if (next.type() == HclTokenType.IDENT) {
                parts.add(next.text());
                advance();
            } else if (next.type() == HclTokenType.STRING) {
                // tolerate `module["x"].id`-style access on the dotted form;
                // capture as raw and break.
                String raw = renderRange(startIdx, idx + 1);
                advance();
                return new HclValue.RawValue(raw);
            } else {
                break;
            }
        }
        // If the next token is LPAREN-equivalent we treat the whole thing as a
        // raw expression. We don't have a LPAREN token type but unknown bytes
        // (e.g. '(') become UNKNOWN tokens.
        if (peek().type() == HclTokenType.UNKNOWN && "(".equals(peek().text())) {
            // function call -- consume to matching closing paren
            int depth = 0;
            while (peek().type() != HclTokenType.EOF) {
                HclToken cur = peek();
                if (cur.type() == HclTokenType.UNKNOWN && "(".equals(cur.text())) {
                    depth++;
                    advance();
                    continue;
                }
                if (cur.type() == HclTokenType.UNKNOWN && ")".equals(cur.text())) {
                    depth--;
                    advance();
                    if (depth == 0) break;
                    continue;
                }
                if (depth == 0 && (cur.type() == HclTokenType.RBRACE
                    || cur.type() == HclTokenType.COMMA
                    || cur.type() == HclTokenType.RBRACKET)) {
                    break;
                }
                advance();
            }
            String raw = renderRange(startIdx, idx);
            return new HclValue.RawValue(raw);
        }
        String raw = renderRange(startIdx, idx);
        return new HclValue.ReferenceValue(raw, parts);
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    private HclToken peek() {
        return tokens.get(idx);
    }

    private void advance() {
        if (idx < tokens.size() - 1) idx++;
    }

    private HclToken expect(HclTokenType type) {
        HclToken t = peek();
        if (t.type() != type) {
            throw new HclParseException(
                "expected " + type + " but found " + t.type()
                    + (t.text().isEmpty() ? "" : " '" + t.text() + "'"),
                t.line(), t.column());
        }
        advance();
        return t;
    }

    private List<String> collectPrecedingComments(List<HclBlock> emittedSoFar, int blockStartLine) {
        // Use the previous block's endLine (or 0) as the lower bound; collect
        // comments whose line is strictly between (lowerBound, blockStartLine).
        int lowerBound = 0;
        if (!emittedSoFar.isEmpty()) {
            lowerBound = emittedSoFar.get(emittedSoFar.size() - 1).endLine();
        }
        List<String> out = new ArrayList<>();
        for (HclLexer.Comment c : comments) {
            if (c.line() > lowerBound && c.line() < blockStartLine) {
                out.add(c.text());
            }
        }
        return out;
    }

    /**
     * Render the verbatim source slice spanned by tokens
     * {@code [startIdx, endIdx)}. Falls back to a simple join of token texts
     * when the source range cannot be reconstructed from line/column data.
     */
    private String renderRange(int startIdx, int endIdx) {
        if (startIdx >= endIdx || startIdx >= tokens.size()) return "";
        HclToken first = tokens.get(startIdx);
        // endIdx is exclusive but we want to span up to the last consumed token
        int lastTokenIdx = Math.min(endIdx - 1, tokens.size() - 1);
        HclToken last = tokens.get(lastTokenIdx);
        if (first.line() == last.line() && source != null && !source.isEmpty()) {
            // single-line range: slice the source by column.
            int startCol = first.column() - 1;
            int endCol = last.column() - 1 + last.text().length();
            int lineStart = nthLineStart(first.line());
            if (lineStart >= 0) {
                int absStart = lineStart + startCol;
                int absEnd = Math.min(source.length(), lineStart + endCol);
                if (absStart >= 0 && absEnd >= absStart && absEnd <= source.length()) {
                    return source.substring(absStart, absEnd);
                }
            }
        }
        // fallback: concatenate token text (loses spacing)
        StringBuilder sb = new StringBuilder();
        for (int i = startIdx; i < endIdx && i < tokens.size(); i++) {
            if (sb.length() > 0) sb.append(" ");
            sb.append(tokens.get(i).text());
        }
        return sb.toString();
    }

    private int nthLineStart(int line) {
        if (line <= 0 || source == null) return -1;
        if (line == 1) return 0;
        int seen = 1;
        for (int i = 0; i < source.length(); i++) {
            if (source.charAt(i) == '\n') {
                seen++;
                if (seen == line) return i + 1;
            }
        }
        return -1;
    }

    private static String escape(String s) {
        StringBuilder out = new StringBuilder(s.length() + 2);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\n' -> out.append("\\n");
                case '\t' -> out.append("\\t");
                case '\r' -> out.append("\\r");
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                default -> out.append(c);
            }
        }
        return out.toString();
    }
}
