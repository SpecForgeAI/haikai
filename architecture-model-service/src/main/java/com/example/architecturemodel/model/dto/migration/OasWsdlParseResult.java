package com.example.architecturemodel.model.dto.migration;

import java.util.List;

/**
 * Per-file result of an OAS or WSDL parse attempt, surfaced by
 * {@code OasWsdlParserService.parse(byte[], ContractFormat)}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>Two terminal statuses: {@link Status#PARSED} (the parser surfaced a
 * service-name hint plus zero-or-more operations) and {@link Status#FAILED}
 * (the parser threw -- the exception message is captured in {@link
 * #failureReason} and surfaced to the user). The parser layer NEVER throws out
 * of its public {@code parse(...)} method -- every exception is caught and
 * funnelled into a {@code FAILED} result so sibling-file failure isolation
 * (Task Group 3.6) works end-to-end.</p>
 *
 * <p>Cross-format invariants:</p>
 * <ul>
 *   <li>{@link #fileName} and {@link #fileSize} mirror the multipart upload
 *       so the controller can echo them back in the response without holding
 *       a reference to the original {@code MultipartFile}.</li>
 *   <li>{@link #format} comes from {@code ContractFormatDetector.detect(...)}
 *       upstream and is passed through unchanged; {@link
 *       ContractFormat#UNKNOWN} only appears on a {@code FAILED} result with
 *       reason text covering {@code unrecognised_contract_format} -- the
 *       parser layer itself never produces {@code UNKNOWN} from a successful
 *       parse.</li>
 *   <li>{@link #suggestedServiceName} -- {@code info.title} for OAS or the
 *       first {@code <service name>} for WSDL, both lowercased + trimmed.
 *       Nullable on {@code FAILED}; nullable on {@code PARSED} when the
 *       source file omits the field (e.g., a malformed-but-tolerated OAS
 *       missing {@code info.title}).</li>
 *   <li>{@link #operations} -- non-null but possibly empty. Empty list
 *       indicates a successfully-parsed file with zero operations (spec:
 *       file-level status {@code parsed}, yellow info-row "No operations
 *       found"). Empty is NOT a failure case.</li>
 *   <li>{@link #failureReason} -- non-null only when {@link #status} is
 *       {@code FAILED}; carries the underlying exception's {@code
 *       getMessage()} verbatim so users see the library's diagnostic.</li>
 * </ul>
 *
 * <p>The parser does NOT compute missing-input keys, intersect with project
 * specs, or evaluate match status -- that is Task Group 3's
 * {@code MissingInputResolutionBulkService.bulkResolveFromParsedFiles(...)}.
 * This DTO is intentionally narrow: per-file parse outcome only.</p>
 *
 * <p>All fields are BOXED reference types per
 * {@code project_primitive_double_dto_overwrite.md} so a future PATCH-style
 * caller cannot silently overwrite a value with a primitive default. {@link
 * #fileSize} is {@link Long} (not primitive {@code long}) for the same
 * reason.</p>
 *
 * @param fileName              original multipart filename (preserved
 *                              verbatim from the upload).
 * @param fileSize              file size in bytes; mirrors the value the
 *                              controller validated against the per-project
 *                              cap.
 * @param format                format the detector reported for these bytes.
 * @param status                terminal parse status.
 * @param failureReason         underlying exception message when {@link
 *                              #status} is {@code FAILED}; null otherwise.
 * @param suggestedServiceName  lowercased + trimmed
 *                              {@code info.title}/{@code <service name>}; may
 *                              be null if the source file omits it.
 * @param operations            non-null but possibly empty list of parsed
 *                              operations.
 */
public record OasWsdlParseResult(
    String fileName,
    Long fileSize,
    ContractFormat format,
    Status status,
    String failureReason,
    String suggestedServiceName,
    List<OasWsdlParsedOperation> operations
) {

    /**
     * Terminal parse statuses surfaced per file. The wider parse-files
     * pipeline layers additional per-operation match statuses
     * ({@code matched} / {@code already_resolved} / {@code no_match}) on top
     * of {@code PARSED} files in Task Group 3.
     */
    public enum Status {
        /** Parser ran cleanly; {@link #operations} populated (may be empty). */
        PARSED,
        /** Parser threw; {@link #failureReason} carries the exception message. */
        FAILED
    }
}
