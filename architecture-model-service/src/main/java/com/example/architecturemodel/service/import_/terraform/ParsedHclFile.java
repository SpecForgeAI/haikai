package com.example.architecturemodel.service.import_.terraform;

import com.example.architecturemodel.service.import_.terraform.hcl.HclBlock;

import java.util.List;

/**
 * Carrier for a single parsed Terraform HCL file inside an import upload.
 *
 * <p>Group 2 retyped {@code blocks} from {@code List<Object>} to
 * {@code List<HclBlock>} once the hand-rolled parser landed. The API
 * remains stable -- only the static type tightens.
 *
 * <p>{@code filePath} is recorded relative to the ZIP root (e.g.
 * {@code "modules/network/main.tf"}) when a ZIP was uploaded, or as the
 * bare filename when individual {@code .tf} files were uploaded. Round-
 * trip stability with the export's golden HCL fixtures depends on this
 * being byte-equal to the upload-side path.
 *
 * <p>Spec: 2026-05-08-infrastructure-terraform-import-gcp -- Task Group 1.5 / 2.x
 */
public record ParsedHclFile(
    String filePath,
    String rawContent,
    List<HclBlock> blocks
) {
    public ParsedHclFile {
        blocks = blocks == null ? List.of() : List.copyOf(blocks);
    }
}
