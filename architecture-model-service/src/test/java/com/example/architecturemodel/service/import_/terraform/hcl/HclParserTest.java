package com.example.architecturemodel.service.import_.terraform.hcl;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Tests for {@link HclParser}.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.1
 */
class HclParserTest {

    @Test
    void parses_each_top_level_construct_with_correct_lines() {
        String src = """
            resource "google_compute_network" "vpc" {
              name = "main"
            }
            module "network" {
              source = "./modules/network"
            }
            variable "region" {
              default = "europe-west1"
            }
            output "vpc_id" {
              value = "x"
            }
            locals {
              env = "prod"
            }
            provider "google" {
              project = "p1"
            }
            """;
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        assertEquals(6, blocks.size(),
            "expected 6 top-level blocks (resource/module/variable/output/locals/provider)");

        // block types
        assertEquals("resource", blocks.get(0).blockType());
        assertEquals("module", blocks.get(1).blockType());
        assertEquals("variable", blocks.get(2).blockType());
        assertEquals("output", blocks.get(3).blockType());
        assertEquals("locals", blocks.get(4).blockType());
        assertEquals("provider", blocks.get(5).blockType());

        // labels
        assertEquals(List.of("google_compute_network", "vpc"), blocks.get(0).labels());
        assertEquals(List.of("network"), blocks.get(1).labels());
        assertEquals(List.of("region"), blocks.get(2).labels());
        assertEquals(List.of("vpc_id"), blocks.get(3).labels());
        assertEquals(List.of(), blocks.get(4).labels());
        assertEquals(List.of("google"), blocks.get(5).labels());

        // line ranges -- the resource block spans lines 1-3
        HclBlock resource = blocks.get(0);
        assertEquals(1, resource.startLine());
        assertEquals(3, resource.endLine());

        // module spans lines 4-6
        HclBlock module = blocks.get(1);
        assertEquals(4, module.startLine());
        assertEquals(6, module.endLine());
    }

    @Test
    void resource_reference_extraction_yields_reference_value_and_path_parts() {
        String src = "resource \"google_storage_bucket_object\" \"o\" {\n"
                   + "  bucket = google_storage_bucket.assets.name\n"
                   + "}\n";
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        assertEquals(1, blocks.size());
        HclBlock b = blocks.get(0);
        assertEquals(1, b.attributes().size());
        HclAttribute attr = b.attributes().get(0);
        assertEquals("bucket", attr.name());
        assertInstanceOf(HclValue.ReferenceValue.class, attr.value());
        HclValue.ReferenceValue ref = (HclValue.ReferenceValue) attr.value();
        assertEquals("google_storage_bucket.assets.name", ref.rawExpression());
        assertEquals(
            List.of("google_storage_bucket", "assets", "name"),
            ref.pathParts());
    }

    @Test
    void var_local_module_references_extract_path_parts() {
        String src = "resource \"r\" \"x\" {\n"
                   + "  region = var.region\n"
                   + "  host = local.db_host\n"
                   + "  vpc = module.network.vpc_id\n"
                   + "}\n";
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        HclBlock b = blocks.get(0);
        assertEquals(3, b.attributes().size());

        HclValue.ReferenceValue regionRef =
            (HclValue.ReferenceValue) b.attributes().get(0).value();
        assertEquals(List.of("var", "region"), regionRef.pathParts());
        assertEquals("var.region", regionRef.rawExpression());

        HclValue.ReferenceValue hostRef =
            (HclValue.ReferenceValue) b.attributes().get(1).value();
        assertEquals(List.of("local", "db_host"), hostRef.pathParts());

        HclValue.ReferenceValue vpcRef =
            (HclValue.ReferenceValue) b.attributes().get(2).value();
        assertEquals(List.of("module", "network", "vpc_id"), vpcRef.pathParts());
    }

    @Test
    void unsupported_expressions_become_raw_value_without_throwing() {
        String src = "resource \"r\" \"x\" {\n"
                   + "  for_each = { for x in y : x.k => x.v }\n"
                   + "  count = length(var.subnets)\n"
                   + "  greeting = \"hello ${var.name}\"\n"
                   + "}\n";
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        HclBlock b = blocks.get(0);

        // for_each -> RawValue (the parser should not throw)
        HclAttribute forEach = b.attributes().get(0);
        assertEquals("for_each", forEach.name());
        assertInstanceOf(HclValue.RawValue.class, forEach.value());
        HclValue.RawValue forEachRaw = (HclValue.RawValue) forEach.value();
        // raw text contains the source slice (verbatim or token-joined fallback)
        assertNotNull(forEachRaw.rawText());
        assertFalse(forEachRaw.rawText().isBlank());

        // count = length(var.subnets) -> RawValue (function call detected)
        HclAttribute count = b.attributes().get(1);
        assertEquals("count", count.name());
        assertInstanceOf(HclValue.RawValue.class, count.value());

        // interpolated string remains a StringValue at the lexer level (it
        // contains "${var.name}" verbatim as part of the unescaped string),
        // which is fine -- the importer downstream surfaces a TODO if it
        // detects "${" in a string used as an attribute value.
        HclAttribute greeting = b.attributes().get(2);
        assertEquals("greeting", greeting.name());
        // Either StringValue with "${...}" embedded OR RawValue -- both are
        // acceptable per the spec ("preserved verbatim as raw evidence").
        boolean acceptableShape =
            greeting.value() instanceof HclValue.StringValue
            || greeting.value() instanceof HclValue.RawValue;
        assertTrue(acceptableShape,
            "interpolated string must be preserved verbatim (StringValue or RawValue)");
    }

    @Test
    void nested_block_inside_resource_is_parsed_as_nested_hcl_block() {
        String src = "resource \"google_compute_instance\" \"vm\" {\n"
                   + "  name = \"vm-1\"\n"
                   + "  lifecycle {\n"
                   + "    create_before_destroy = true\n"
                   + "  }\n"
                   + "}\n";
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        HclBlock outer = blocks.get(0);
        assertEquals(1, outer.attributes().size());
        assertEquals(1, outer.nestedBlocks().size());
        HclBlock lifecycle = outer.nestedBlocks().get(0);
        assertEquals("lifecycle", lifecycle.blockType());
        assertEquals(List.of(), lifecycle.labels());
        assertEquals(1, lifecycle.attributes().size());
        HclAttribute cbd = lifecycle.attributes().get(0);
        assertEquals("create_before_destroy", cbd.name());
        assertInstanceOf(HclValue.BoolValue.class, cbd.value());
        assertTrue(((HclValue.BoolValue) cbd.value()).value());
    }

    @Test
    void preceding_comments_attach_to_immediately_following_block() {
        String src = "# top-level note about the network\n"
                   + "// another note\n"
                   + "resource \"google_compute_network\" \"vpc\" {\n"
                   + "  name = \"main\"\n"
                   + "}\n";
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        HclBlock vpc = blocks.get(0);
        assertEquals(2, vpc.precedingComments().size());
        assertTrue(vpc.precedingComments().get(0).contains("top-level note about the network"));
        assertTrue(vpc.precedingComments().get(1).contains("another note"));
    }

    @Test
    void parses_data_source_block_as_first_class_block_type() {
        // 'data' is treated as a normal block by the parser (downstream
        // classifier decides what to do with it).
        String src = "data \"google_compute_image\" \"deb\" {\n"
                   + "  family = \"debian-11\"\n"
                   + "  project = \"debian-cloud\"\n"
                   + "}\n";
        HclParser parser = new HclParser(new HclLexer(src));
        List<HclBlock> blocks = parser.parse();
        assertEquals(1, blocks.size());
        HclBlock b = blocks.get(0);
        assertEquals("data", b.blockType());
        assertEquals(List.of("google_compute_image", "deb"), b.labels());
        assertEquals(2, b.attributes().size());
    }
}
