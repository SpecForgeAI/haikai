package com.example.archtool.service;

import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import com.example.archtool.model.internal.DrawioDiagramSource;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.parser.Parser;
import org.jsoup.select.Elements;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Service for scanning Confluence pages to discover draw.io diagram sources.
 *
 * <p>This scanner supports two macro formats:</p>
 * <ul>
 *     <li><strong>Legacy structured-macro format:</strong> {@code <ac:structured-macro ac:name="drawio">}
 *         used in Confluence Server and older Confluence Cloud pages</li>
 *     <li><strong>ADF extension format:</strong> {@code <ac:adf-extension>} used by the Forge-based
 *         draw.io Board/Diagram macro in Confluence Cloud</li>
 * </ul>
 *
 * <p>The scanner also discovers orphan draw.io attachments that are not referenced by any macro,
 * including both {@code .drawio} files and attachments with media type {@code application/vnd.jgraph.mxfile}.</p>
 */
@Service
public class DrawioScanner {

    private static final Logger log = LoggerFactory.getLogger(DrawioScanner.class);

    // Existing constants for legacy structured-macro support
    private static final String DRAWIO_EXTENSION = ".drawio";
    private static final String DRAWIO_MACRO_NAME = "drawio";
    private static final String DIAGRAMS_NET_MACRO_NAME = "diagrams.net";

    // New constants for ADF-based Forge draw.io macro support
    /** Migration key used to identify draw.io macros in ADF format */
    private static final String MXGRAPH_MIGRATION_KEY = "com.mxgraph.confluence.plugins.diagramly";

    /** Media type for draw.io mxfile attachments in Confluence Cloud */
    private static final String MXFILE_MEDIA_TYPE = "application/vnd.jgraph.mxfile";

    /** ADF parameter key for diagram display name */
    private static final String ADF_PARAM_DIAGRAM_NAME = "diagram-name";

    /** ADF parameter key for attachment content ID */
    private static final String ADF_PARAM_CONTENT_ID = "cust-content-id";

    /** Keyword to identify draw.io extension keys */
    private static final String ADF_EXTENSION_KEY_DRAWIO = "drawio";

    /**
     * Holds extracted data from ADF (Atlassian Document Format) draw.io macro nodes
     * before matching with attachments.
     *
     * @param attachmentId the Confluence attachment content ID (from {@code cust-content-id} parameter)
     * @param diagramName  the display name of the diagram (from {@code diagram-name} parameter), may be null
     */
    record AdfDiagramRef(String attachmentId, String diagramName) {}

    /**
     * Scans a Confluence page for draw.io diagram sources.
     *
     * <p>This method discovers diagrams in three ways:</p>
     * <ol>
     *     <li>Legacy structured-macro references ({@code <ac:structured-macro ac:name="drawio">})</li>
     *     <li>ADF extension macro references ({@code <ac:adf-extension>} with draw.io parameters)</li>
     *     <li>Orphan .drawio or mxfile attachments not referenced by any macro</li>
     * </ol>
     *
     * @param page        the Confluence page to scan
     * @param attachments the list of attachments on the page
     * @return list of discovered diagram sources, never null
     */
    public List<DrawioDiagramSource> scanPage(ConfluencePage page, List<ConfluenceAttachment> attachments) {
        List<DrawioDiagramSource> sources = new ArrayList<>();
        Set<String> matchedAttachmentNames = new HashSet<>();

        // Build lookup maps for attachments
        Map<String, ConfluenceAttachment> attachmentsByName = attachments.stream()
            .collect(Collectors.toMap(
                att -> att.title().toLowerCase(),
                Function.identity(),
                (existing, replacement) -> existing
            ));

        Map<String, ConfluenceAttachment> attachmentsById = attachments.stream()
            .collect(Collectors.toMap(
                ConfluenceAttachment::id,
                Function.identity(),
                (existing, replacement) -> existing
            ));

        // Track counts for logging
        int structuredMacroCount = 0;
        int adfMatchCount = 0;

        // Step 1: Process legacy structured-macro references
        List<String> macroFilenames = extractMacroFilenames(page.bodyStorage());
        log.debug("Page {}: Found {} legacy structured-macro references", page.id(), macroFilenames.size());

        for (String macroFilename : macroFilenames) {
            String lowerFilename = macroFilename.toLowerCase();
            ConfluenceAttachment attachment = attachmentsByName.get(lowerFilename);

            if (attachment != null) {
                sources.add(DrawioDiagramSource.fromMacroReference(
                    attachment.id(),
                    attachment.title(),
                    attachment.downloadUrl()
                ));
                matchedAttachmentNames.add(lowerFilename);
                structuredMacroCount++;
                log.debug("Page {}: Matched structured-macro '{}' with attachment '{}'",
                    page.id(), macroFilename, attachment.title());
            } else {
                log.warn("Page {}: Structured-macro references '{}' but no matching attachment found",
                    page.id(), macroFilename);
            }
        }

        // Step 2: Process ADF extension macro references
        List<AdfDiagramRef> adfRefs = extractAdfDiagramRefs(page.bodyStorage());
        log.debug("Page {}: Found {} ADF draw.io macro references", page.id(), adfRefs.size());

        for (AdfDiagramRef ref : adfRefs) {
            ConfluenceAttachment attachment = attachmentsById.get(ref.attachmentId());

            if (attachment != null) {
                sources.add(DrawioDiagramSource.fromMacroReference(
                    attachment.id(),
                    attachment.title(),
                    attachment.downloadUrl()
                ));
                matchedAttachmentNames.add(attachment.title().toLowerCase());
                adfMatchCount++;
                log.debug("Page {}: Matched ADF macro '{}' (id={}) with attachment '{}'",
                    page.id(), ref.diagramName(), ref.attachmentId(), attachment.title());
            } else {
                log.warn("Page {}: ADF draw.io macro references attachment id '{}' (diagram '{}') but no matching attachment found",
                    page.id(), ref.attachmentId(), ref.diagramName());
            }
        }

        // Log macro detection summary
        log.debug("Page {}: Macro detection summary - {} structured macros, {} ADF macros",
            page.id(), macroFilenames.size(), adfRefs.size());

        // Step 3: Find orphan draw.io/mxfile attachments
        if (macroFilenames.isEmpty() && adfRefs.isEmpty()) {
            long mxfileCount = attachments.stream()
                .filter(a -> MXFILE_MEDIA_TYPE.equalsIgnoreCase(a.mediaType()))
                .count();
            if (mxfileCount > 0) {
                log.info("Page {}: No macros found, falling back to orphan detection ({} mxfile attachments)",
                    page.id(), mxfileCount);
            }
        }

        List<DrawioDiagramSource> orphanSources = findOrphanDrawioAttachments(attachments, matchedAttachmentNames);
        sources.addAll(orphanSources);

        // Final summary log
        log.info("Page {}: Found {} diagram sources ({} from structured macros, {} from ADF macros, {} orphan)",
            page.id(), sources.size(), structuredMacroCount, adfMatchCount, orphanSources.size());

        return sources;
    }

    /**
     * Extracts diagram filenames from legacy structured-macro elements in page body.
     *
     * <p>Looks for both {@code drawio} and {@code diagrams.net} macro names.</p>
     *
     * @param bodyStorage the page body in Confluence storage format
     * @return list of diagram filenames referenced by macros
     */
    List<String> extractMacroFilenames(String bodyStorage) {
        List<String> filenames = new ArrayList<>();

        if (bodyStorage == null || bodyStorage.isBlank()) {
            return filenames;
        }

        try {
            Document doc = Jsoup.parse(bodyStorage, "", Parser.xmlParser());

            // Select all structured-macro elements (handle both namespaced and non-namespaced)
            Elements macros = doc.select("ac|structured-macro, structured-macro");

            for (Element macro : macros) {
                // Get macro name (try both namespaced and non-namespaced attributes)
                String macroName = macro.attr("ac:name");
                if (macroName.isEmpty()) {
                    macroName = macro.attr("name");
                }

                // Check if this is a draw.io macro
                if (DRAWIO_MACRO_NAME.equalsIgnoreCase(macroName) ||
                    DIAGRAMS_NET_MACRO_NAME.equalsIgnoreCase(macroName)) {

                    // Find the diagramName parameter
                    Elements params = macro.select("ac|parameter, parameter");
                    for (Element param : params) {
                        String paramName = param.attr("ac:name");
                        if (paramName.isEmpty()) {
                            paramName = param.attr("name");
                        }

                        if ("diagramName".equalsIgnoreCase(paramName)) {
                            String diagramName = param.text().trim();
                            if (!diagramName.isEmpty()) {
                                filenames.add(diagramName);
                                log.debug("Extracted diagramName '{}' from {} macro", diagramName, macroName);
                            }
                            break;
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Error parsing page body for structured macros: {}", e.getMessage());
        }

        return filenames;
    }

    /**
     * Extracts diagram references from ADF (Atlassian Document Format) draw.io macros.
     *
     * <p>ADF-based draw.io macros use a different structure than legacy structured-macros.
     * They are identified by:</p>
     * <ul>
     *     <li>{@code extension-key} containing "drawio"</li>
     *     <li>{@code migration-key} parameter with value {@code com.mxgraph.confluence.plugins.diagramly}</li>
     * </ul>
     *
     * @param bodyStorage the page body in Confluence storage format
     * @return list of ADF diagram references with attachment IDs
     */
    List<AdfDiagramRef> extractAdfDiagramRefs(String bodyStorage) {
        List<AdfDiagramRef> refs = new ArrayList<>();

        if (bodyStorage == null || bodyStorage.isBlank()) {
            return refs;
        }

        try {
            Document doc = Jsoup.parse(bodyStorage, "", Parser.xmlParser());

            // Select ADF extension nodes
            // Try multiple selector patterns for robustness
            Elements adfExtensions = doc.select("ac|adf-extension, adf-extension");

            for (Element extension : adfExtensions) {
                // Find adf-node elements with type="extension"
                Elements extensionNodes = extension.select("ac|adf-node[type=extension], adf-node[type=extension]");

                for (Element node : extensionNodes) {
                    if (isAdfDrawioMacro(node)) {
                        AdfDiagramRef ref = extractAdfDiagramRef(node);
                        if (ref != null) {
                            refs.add(ref);
                            log.debug("Found ADF draw.io macro: diagramName='{}', attachmentId='{}'",
                                ref.diagramName(), ref.attachmentId());
                        }
                    }
                }
            }

            log.debug("Extracted {} ADF diagram references from body storage", refs.size());

        } catch (Exception e) {
            log.warn("Error parsing page body for ADF macros: {}", e.getMessage());
        }

        return refs;
    }

    /**
     * Checks if an ADF node represents a draw.io macro.
     *
     * @param node the ADF node element to check
     * @return true if this is a draw.io macro
     */
    private boolean isAdfDrawioMacro(Element node) {
        // Check extension-key attribute for "drawio"
        Elements extensionKeyAttrs = node.select("ac|adf-attribute[key=extension-key], adf-attribute[key=extension-key]");
        for (Element attr : extensionKeyAttrs) {
            String value = attr.text().toLowerCase();
            if (value.contains(ADF_EXTENSION_KEY_DRAWIO) || value.contains("draw.io")) {
                return true;
            }
        }

        // Check extension-title attribute for "drawio"
        Elements extensionTitleAttrs = node.select("ac|adf-attribute[key=extension-title], adf-attribute[key=extension-title]");
        for (Element attr : extensionTitleAttrs) {
            String value = attr.text().toLowerCase();
            if (value.contains(ADF_EXTENSION_KEY_DRAWIO) || value.contains("draw.io")) {
                return true;
            }
        }

        // Check migration-key parameter
        Elements migrationKeyParams = node.select(
            "ac|adf-node[type=extension-properties] ac|adf-parameter[key=migration-key], " +
            "adf-node[type=extension-properties] adf-parameter[key=migration-key]"
        );
        for (Element param : migrationKeyParams) {
            if (MXGRAPH_MIGRATION_KEY.equals(param.text().trim())) {
                return true;
            }
        }

        return false;
    }

    /**
     * Extracts diagram reference data from an ADF draw.io macro node.
     *
     * @param node the ADF node element
     * @return the extracted reference, or null if cust-content-id is missing
     */
    private AdfDiagramRef extractAdfDiagramRef(Element node) {
        String diagramName = null;
        String attachmentId = null;

        // Find guest-params section
        Elements guestParams = node.select(
            "ac|adf-node[type=guest-params], adf-node[type=guest-params]"
        );

        for (Element guestParamsNode : guestParams) {
            // Extract diagram-name
            Elements diagramNameParams = guestParamsNode.select(
                "ac|adf-parameter[key=" + ADF_PARAM_DIAGRAM_NAME + "], " +
                "adf-parameter[key=" + ADF_PARAM_DIAGRAM_NAME + "]"
            );
            for (Element param : diagramNameParams) {
                diagramName = param.text().trim();
                break;
            }

            // Extract cust-content-id
            Elements contentIdParams = guestParamsNode.select(
                "ac|adf-parameter[key=" + ADF_PARAM_CONTENT_ID + "], " +
                "adf-parameter[key=" + ADF_PARAM_CONTENT_ID + "]"
            );
            for (Element param : contentIdParams) {
                attachmentId = param.text().trim();
                break;
            }
        }

        // cust-content-id is required
        if (attachmentId == null || attachmentId.isBlank()) {
            log.debug("Skipping ADF draw.io macro: missing or blank cust-content-id");
            return null;
        }

        return new AdfDiagramRef(attachmentId, diagramName);
    }

    /**
     * Finds draw.io attachments that are not referenced by any macro.
     *
     * <p>An attachment is considered a candidate diagram if:</p>
     * <ul>
     *     <li>Its title ends with {@code .drawio}, OR</li>
     *     <li>Its media type is {@code application/vnd.jgraph.mxfile}</li>
     * </ul>
     *
     * @param attachments            all attachments on the page
     * @param matchedAttachmentNames names of attachments already matched to macros (lowercase)
     * @return list of orphan diagram sources
     */
    private List<DrawioDiagramSource> findOrphanDrawioAttachments(
            List<ConfluenceAttachment> attachments,
            Set<String> matchedAttachmentNames) {

        List<DrawioDiagramSource> orphans = new ArrayList<>();

        for (ConfluenceAttachment attachment : attachments) {
            String lowerTitle = attachment.title().toLowerCase();
            boolean isDrawioFile = lowerTitle.endsWith(DRAWIO_EXTENSION);
            boolean isMxfileType = MXFILE_MEDIA_TYPE.equalsIgnoreCase(attachment.mediaType());

            if ((isDrawioFile || isMxfileType) && !matchedAttachmentNames.contains(lowerTitle)) {
                orphans.add(DrawioDiagramSource.fromOrphanAttachment(
                    attachment.id(),
                    attachment.title(),
                    attachment.downloadUrl()
                ));
                log.debug("Found orphan {} attachment: {}",
                    isDrawioFile ? ".drawio" : "mxfile", attachment.title());
            }
        }

        return orphans;
    }
}
