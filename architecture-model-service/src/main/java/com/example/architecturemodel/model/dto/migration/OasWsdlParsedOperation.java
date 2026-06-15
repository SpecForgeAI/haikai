package com.example.architecturemodel.model.dto.migration;

/**
 * One parsed operation surfaced from an OAS or WSDL file by
 * {@code OasWsdlParserService}.
 *
 * <p>Spec: Bulk-Resolve OAS/WSDL Parser (2026-05-20) -- Task Group 2.</p>
 *
 * <p>The parser layer surfaces ONLY the raw operation identifier here -- no
 * service name, no missing-input-key hash. Service-name resolution (per-file
 * override vs. auto-suggested {@code info.title} / first {@code <service
 * name>}) and key hashing happen in Task Group 3's
 * {@code MissingInputResolutionBulkService.bulkResolveFromParsedFiles(...)}
 * where the override map is available.</p>
 *
 * <p>Identifier normalisation per spec:</p>
 * <ul>
 *   <li>OAS -- {@code operationId} when present, else
 *       {@code lowercased(method + ' ' + path)}. STRICT case-only
 *       normalisation: no slash collapse, no query strip, no path-parameter
 *       rewrite.</li>
 *   <li>WSDL 1.1 / 2.0 -- {@code <operation name>}, lowercased + trimmed.</li>
 * </ul>
 *
 * <p>Field type is BOXED {@link String} per
 * {@code project_primitive_double_dto_overwrite.md}; a JSON null arrives as a
 * Java null rather than the primitive default. The parse-files response DTO is
 * read-only on the wire so the boxed-vs-primitive distinction is structural
 * here rather than load-bearing.</p>
 *
 * @param identifier  the parsed operation identifier; never null when emitted
 *                    from a successful parse but the type is boxed to permit
 *                    future explicit-null sentinels (e.g., un-normalisable
 *                    operations).
 */
public record OasWsdlParsedOperation(
    String identifier
) {}
