package com.example.architecturemodel.service.import_.terraform.hcl;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link HclLexer}.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.1
 */
class HclLexerTest {

    @Test
    void tokenises_resource_block_into_expected_token_sequence() {
        String src = "resource \"google_compute_network\" \"vpc\" { name = \"x\" }";
        HclLexer lexer = new HclLexer(src);
        List<HclToken> tokens = lexer.tokenize();

        // expected: IDENT STRING STRING LBRACE IDENT EQUALS STRING RBRACE EOF
        assertEquals(HclTokenType.IDENT, tokens.get(0).type());
        assertEquals("resource", tokens.get(0).text());

        assertEquals(HclTokenType.STRING, tokens.get(1).type());
        assertEquals("google_compute_network", tokens.get(1).text());

        assertEquals(HclTokenType.STRING, tokens.get(2).type());
        assertEquals("vpc", tokens.get(2).text());

        assertEquals(HclTokenType.LBRACE, tokens.get(3).type());

        assertEquals(HclTokenType.IDENT, tokens.get(4).type());
        assertEquals("name", tokens.get(4).text());

        assertEquals(HclTokenType.EQUALS, tokens.get(5).type());

        assertEquals(HclTokenType.STRING, tokens.get(6).type());
        assertEquals("x", tokens.get(6).text());

        assertEquals(HclTokenType.RBRACE, tokens.get(7).type());
        assertEquals(HclTokenType.EOF, tokens.get(8).type());

        // line tracking on the first token is line 1
        assertEquals(1, tokens.get(0).line());
    }

    @Test
    void string_escapes_unescape_into_token_text() {
        // HCL source bytes: "line1\nline2 \"quoted\""
        // We construct it as the actual Java string the lexer would receive.
        String src = "x = \"line1\\nline2 \\\"quoted\\\"\"";
        HclLexer lexer = new HclLexer(src);
        List<HclToken> tokens = lexer.tokenize();

        // tokens: IDENT EQUALS STRING EOF
        assertEquals(HclTokenType.STRING, tokens.get(2).type());
        // unescape: \n -> actual newline, \" -> "
        String expected = "line1\nline2 \"quoted\"";
        assertEquals(expected, tokens.get(2).text());
    }

    @Test
    void number_bool_list_map_literals_produce_expected_tokens() {
        String src = "a = 42\n"
                   + "b = -1.5e2\n"
                   + "c = true\n"
                   + "d = [1, 2, 3]\n"
                   + "e = { k = \"v\" }\n";
        HclLexer lexer = new HclLexer(src);
        List<HclToken> tokens = lexer.tokenize();

        // walk and collect just the kinds we care about
        boolean sawNumber = false;
        boolean sawNegFloat = false;
        boolean sawBool = false;
        boolean sawLBracket = false;
        boolean sawComma = false;
        boolean sawRBracket = false;
        boolean sawLBrace = false;
        boolean sawEqualsInsideMap = false;

        for (int i = 0; i < tokens.size(); i++) {
            HclToken t = tokens.get(i);
            if (t.type() == HclTokenType.NUMBER) {
                if ("42".equals(t.text())) sawNumber = true;
                if ("-1.5e2".equals(t.text())) sawNegFloat = true;
            }
            if (t.type() == HclTokenType.BOOL && "true".equals(t.text())) sawBool = true;
            if (t.type() == HclTokenType.LBRACKET) sawLBracket = true;
            if (t.type() == HclTokenType.COMMA) sawComma = true;
            if (t.type() == HclTokenType.RBRACKET) sawRBracket = true;
            if (t.type() == HclTokenType.LBRACE) sawLBrace = true;
            // Map: "{ k = "v" }" has IDENT EQUALS STRING. Find IDENT k, then check next is EQUALS.
            if (t.type() == HclTokenType.IDENT && "k".equals(t.text())) {
                if (tokens.get(i + 1).type() == HclTokenType.EQUALS) sawEqualsInsideMap = true;
            }
        }

        assertTrue(sawNumber, "expected NUMBER token '42'");
        assertTrue(sawNegFloat, "expected NUMBER token '-1.5e2' for scientific");
        assertTrue(sawBool, "expected BOOL token 'true'");
        assertTrue(sawLBracket, "expected LBRACKET");
        assertTrue(sawComma, "expected COMMA inside list");
        assertTrue(sawRBracket, "expected RBRACKET");
        assertTrue(sawLBrace, "expected LBRACE inside map literal");
        assertTrue(sawEqualsInsideMap, "expected EQUALS after map key 'k'");
    }

    @Test
    void comments_stripped_from_token_stream_but_captured_separately() {
        String src = "# leading hash comment\n"
                   + "// leading slashslash comment\n"
                   + "/* block\n   comment */\n"
                   + "resource \"x\" \"y\" {\n"
                   + "  name = \"z\"  # trailing\n"
                   + "}\n";
        HclLexer lexer = new HclLexer(src);
        List<HclToken> tokens = lexer.tokenize();

        // assert no UNKNOWN tokens (i.e. comments fully consumed) and the first
        // token is IDENT 'resource'
        for (HclToken t : tokens) {
            assertFalse(t.type() == HclTokenType.UNKNOWN,
                "comments must not leak as UNKNOWN tokens; saw: " + t);
        }
        assertEquals(HclTokenType.IDENT, tokens.get(0).type());
        assertEquals("resource", tokens.get(0).text());

        // four comments captured: hash, slashslash, block, trailing
        List<HclLexer.Comment> comments = lexer.comments();
        assertEquals(4, comments.size(),
            "expected 4 comments total (3 leading + 1 trailing)");

        // first three comments precede the resource block (line < 5)
        long preceding = comments.stream().filter(c -> c.line() < 5).count();
        assertEquals(3, preceding,
            "expected exactly 3 comments before the resource block");
        assertTrue(comments.get(0).text().contains("leading hash comment"));
        assertTrue(comments.get(1).text().contains("leading slashslash comment"));
        assertTrue(comments.get(2).text().contains("block"));
    }

    @Test
    void unterminated_string_raises_parse_exception_with_line_column() {
        String src = "x = \"oops\n";
        HclLexer lexer = new HclLexer(src);
        HclParseException ex = assertThrows(HclParseException.class, lexer::tokenize);
        assertEquals(1, ex.line());
    }
}
