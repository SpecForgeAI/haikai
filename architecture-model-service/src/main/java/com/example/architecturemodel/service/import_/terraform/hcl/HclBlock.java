package com.example.architecturemodel.service.import_.terraform.hcl;

import java.util.List;

/**
 * Single parsed HCL block: {@code blockType label1 ... &#123; body &#125;}.
 *
 * <p>Components:
 * <ul>
 *   <li>{@code blockType} -- one of {@code resource}, {@code module},
 *       {@code variable}, {@code output}, {@code locals}, {@code provider},
 *       {@code data}, {@code terraform}, plus any unsupported top-level
 *       keyword the parser tolerated.</li>
 *   <li>{@code labels} -- positional STRING / IDENT labels in source order
 *       (e.g. {@code resource "google_compute_network" "vpc"} →
 *       {@code ["google_compute_network", "vpc"]}).</li>
 *   <li>{@code attributes} -- {@code name = value} pairs in source order,
 *       carrying their line numbers for evidence provenance.</li>
 *   <li>{@code nestedBlocks} -- nested block bodies (e.g.
 *       {@code lifecycle &#123; ... &#125;}, {@code node_pool &#123; ... &#125;}).</li>
 *   <li>{@code startLine} / {@code endLine} -- 1-indexed source line span
 *       for the block (LBRACE line through RBRACE line). Drives
 *       {@code IaCResourceBinding.start_line} / {@code end_line} -- the
 *       round-trip stability contract requires these to be accurate.</li>
 *   <li>{@code precedingComments} -- list of comment text lines that
 *       appeared immediately before the block in source order. {@code #},
 *       {@code //}, and {@code /* *&#47;} are all funnelled into this list
 *       (with the comment markers stripped). Used as evidence and for
 *       round-trip context preservation.</li>
 * </ul>
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 2.2
 */
public record HclBlock(
    String blockType,
    List<String> labels,
    List<HclAttribute> attributes,
    List<HclBlock> nestedBlocks,
    int startLine,
    int endLine,
    List<String> precedingComments
) {
    public HclBlock {
        if (blockType == null) {
            throw new IllegalArgumentException("blockType must not be null");
        }
        labels = labels == null ? List.of() : List.copyOf(labels);
        attributes = attributes == null ? List.of() : List.copyOf(attributes);
        nestedBlocks = nestedBlocks == null ? List.of() : List.copyOf(nestedBlocks);
        precedingComments = precedingComments == null ? List.of() : List.copyOf(precedingComments);
    }
}
