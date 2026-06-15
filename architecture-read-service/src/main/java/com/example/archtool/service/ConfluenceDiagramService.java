package com.example.archtool.service;

import com.example.archtool.exception.ConfluenceApiException;
import com.example.archtool.exception.DiagramParsingException;
import com.example.archtool.model.confluence.ConfluenceAttachment;
import com.example.archtool.model.confluence.ConfluencePage;
import com.example.archtool.model.dto.*;
import com.example.archtool.model.internal.DrawioDiagramSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Orchestration service for fetching draw.io diagrams from Confluence.
 *
 * <p>This service coordinates the entire flow of:
 * <ol>
 *   <li>Fetching Confluence pages (including child pages if requested)</li>
 *   <li>Scanning pages for draw.io diagram references</li>
 *   <li>Downloading and parsing draw.io attachment files</li>
 *   <li>Building the complete response with all diagrams and summary statistics</li>
 * </ol>
 *
 * <p>The service implements graceful degradation: individual failures (missing attachments,
 * parsing errors) produce warnings but don't abort the entire request. Other diagrams
 * continue to be processed.</p>
 */
@Service
public class ConfluenceDiagramService {

    private static final Logger log = LoggerFactory.getLogger(ConfluenceDiagramService.class);

    private final ConfluenceClient confluenceClient;
    private final DrawioScanner drawioScanner;
    private final DrawioParser drawioParser;

    /**
     * Creates a new ConfluenceDiagramService with the required dependencies.
     *
     * @param confluenceClient the client for Confluence API communication
     * @param drawioScanner    the scanner for discovering draw.io diagrams on pages
     * @param drawioParser     the parser for draw.io XML content
     */
    public ConfluenceDiagramService(
            ConfluenceClient confluenceClient,
            DrawioScanner drawioScanner,
            DrawioParser drawioParser) {
        this.confluenceClient = confluenceClient;
        this.drawioScanner = drawioScanner;
        this.drawioParser = drawioParser;
    }

    /**
     * Fetches and parses all draw.io diagrams from the specified Confluence page(s).
     *
     * <p>This is the main orchestration method that coordinates all components
     * to build the complete response.</p>
     *
     * @param pageId               the ID of the root Confluence page
     * @param includeAllChildPages whether to include descendant pages in the scan
     * @param maxDepth             maximum depth for child page traversal (only used if includeAllChildPages is true)
     * @return the complete response with all diagrams and summary
     */
    public ConfluenceDiagramResponse fetchDiagrams(
            String pageId,
            boolean includeAllChildPages,
            int maxDepth) {

        log.info("Starting diagram fetch for pageId={}, includeChildPages={}, maxDepth={}",
            pageId, includeAllChildPages, maxDepth);

        // Track warnings throughout processing
        List<String> warnings = new ArrayList<>();

        // Step 1: Collect all pages to process
        List<ConfluencePage> pagesToProcess = collectPages(pageId, includeAllChildPages, maxDepth);
        log.debug("Collected {} pages to process", pagesToProcess.size());

        // The root page is always the first one
        ConfluencePage rootPage = pagesToProcess.get(0);

        // Step 2: Process each page
        List<ConfluencePageDiagramsDto> processedPages = new ArrayList<>();
        int totalDiagrams = 0;
        int totalNodes = 0;
        int totalEdges = 0;

        for (ConfluencePage page : pagesToProcess) {
            log.debug("Processing page: {} ({})", page.id(), page.title());

            ProcessedPageResult result = processPage(page);
            processedPages.add(result.pageDiagrams());
            warnings.addAll(result.warnings());

            // Accumulate counts
            for (DiagramGraphDto diagram : result.pageDiagrams().diagrams()) {
                totalDiagrams++;
                totalNodes += diagram.nodes().size();
                totalEdges += diagram.edges().size();
            }
        }

        // Step 3: Build summary
        ResponseSummaryDto summary = new ResponseSummaryDto(
            processedPages.size(),
            totalDiagrams,
            totalNodes,
            totalEdges,
            warnings
        );

        log.info("Diagram fetch complete: {} pages, {} diagrams, {} nodes, {} edges, {} warnings",
            summary.totalPages(), summary.totalDiagrams(), summary.totalNodes(),
            summary.totalEdges(), warnings.size());

        // Step 4: Build and return response
        return new ConfluenceDiagramResponse(
            rootPage.id(),
            rootPage.title(),
            includeAllChildPages,
            maxDepth,
            processedPages,
            summary
        );
    }

    /**
     * Collects all pages to process, starting with the root page and optionally
     * including child pages up to the specified depth.
     *
     * @param pageId               the root page ID
     * @param includeAllChildPages whether to include child pages
     * @param maxDepth             maximum depth for child page traversal
     * @return list of pages to process, with root page first
     */
    private List<ConfluencePage> collectPages(String pageId, boolean includeAllChildPages, int maxDepth) {
        List<ConfluencePage> pages = new ArrayList<>();

        // Fetch the root page
        log.debug("Fetching root page: {}", pageId);
        ConfluencePage rootPage = confluenceClient.getPage(pageId);
        pages.add(rootPage);

        // Optionally fetch child pages
        if (includeAllChildPages) {
            log.debug("Fetching child pages up to depth {}", maxDepth);
            List<ConfluencePage> childPages = confluenceClient.getChildPages(pageId, maxDepth);
            pages.addAll(childPages);
            log.debug("Found {} child pages", childPages.size());
        }

        return pages;
    }

    /**
     * Processes a single Confluence page: fetches attachments, scans for diagrams,
     * downloads and parses each diagram.
     *
     * @param page the page to process
     * @return the result containing the page's diagrams and any warnings
     */
    private ProcessedPageResult processPage(ConfluencePage page) {
        List<DiagramGraphDto> diagrams = new ArrayList<>();
        List<String> warnings = new ArrayList<>();

        // Fetch attachments for this page
        log.debug("Fetching attachments for page {}", page.id());
        List<ConfluenceAttachment> attachments = confluenceClient.getAttachments(page.id());
        log.debug("Found {} attachments on page {}", attachments.size(), page.id());

        // Build a lookup map for attachments by ID for efficient source matching
        Map<String, ConfluenceAttachment> attachmentMap = attachments.stream()
            .collect(Collectors.toMap(
                ConfluenceAttachment::id,
                Function.identity(),
                (existing, replacement) -> existing
            ));

        // Scan page for draw.io diagram sources
        List<DrawioDiagramSource> diagramSources = drawioScanner.scanPage(page, attachments);
        log.debug("Scanner found {} diagram sources on page {}", diagramSources.size(), page.id());

        // Process each diagram source
        for (DrawioDiagramSource source : diagramSources) {
            processedDiagramResult result = processDiagramSource(page, source, attachmentMap);
            diagrams.addAll(result.diagrams());
            if (result.warning() != null) {
                warnings.add(result.warning());
            }
        }

        ConfluencePageDiagramsDto pageDiagrams = new ConfluencePageDiagramsDto(
            page.id(),
            page.title(),
            diagrams
        );

        return new ProcessedPageResult(pageDiagrams, warnings);
    }

    /**
     * Processes a single diagram source: downloads the attachment and parses it.
     *
     * @param page          the page containing the diagram
     * @param source        the diagram source information
     * @param attachmentMap map of attachment ID to attachment for lookup
     * @return the result containing parsed diagrams or a warning if failed
     */
    private processedDiagramResult processDiagramSource(
            ConfluencePage page,
            DrawioDiagramSource source,
            Map<String, ConfluenceAttachment> attachmentMap) {

        String attachmentId = source.attachmentId();
        String fileName = source.attachmentFileName();

        log.debug("Processing diagram source: {} (attachment: {})", fileName, attachmentId);

        // Find the attachment
        ConfluenceAttachment attachment = attachmentMap.get(attachmentId);
        if (attachment == null) {
            String warning = String.format(
                "Page %s: Attachment '%s' (ID: %s) not found in attachment list",
                page.id(), fileName, attachmentId
            );
            log.warn(warning);
            return new processedDiagramResult(List.of(), warning);
        }

        // Download the attachment content using pageId and attachment
        byte[] content;
        try {
            log.debug("Downloading attachment: {}", fileName);
            content = confluenceClient.downloadAttachment(page.id(), attachment);
        } catch (ConfluenceApiException e) {
            String warning = String.format(
                "Page %s: Failed to download attachment '%s': %s",
                page.id(), fileName, e.getMessage()
            );
            log.warn(warning);
            return new processedDiagramResult(List.of(), warning);
        } catch (Exception e) {
            String warning = String.format(
                "Page %s: Unexpected error downloading attachment '%s': %s",
                page.id(), fileName, e.getMessage()
            );
            log.warn(warning, e);
            return new processedDiagramResult(List.of(), warning);
        }

        // Build the source DTO for traceability
        DiagramSourceDto sourceDto = new DiagramSourceDto(
            DiagramSourceDto.TYPE_CONFLUENCE_DRAWIO_ATTACHMENT,
            page.id(),
            attachmentId,
            fileName
        );

        // Parse the diagram content
        try {
            log.debug("Parsing diagram: {}", fileName);
            List<DiagramGraphDto> parsedDiagrams = drawioParser.parse(content, sourceDto);
            log.debug("Parsed {} tabs from diagram {}", parsedDiagrams.size(), fileName);
            return new processedDiagramResult(parsedDiagrams, null);
        } catch (DiagramParsingException e) {
            String warning = String.format(
                "Page %s: Failed to parse diagram '%s': %s",
                page.id(), fileName, e.getParseError()
            );
            log.warn(warning);
            return new processedDiagramResult(List.of(), warning);
        } catch (Exception e) {
            String warning = String.format(
                "Page %s: Unexpected error parsing diagram '%s': %s",
                page.id(), fileName, e.getMessage()
            );
            log.warn(warning, e);
            return new processedDiagramResult(List.of(), warning);
        }
    }

    /**
     * Internal record for holding the result of processing a single page.
     */
    private record ProcessedPageResult(
        ConfluencePageDiagramsDto pageDiagrams,
        List<String> warnings
    ) {}

    /**
     * Internal record for holding the result of processing a single diagram source.
     */
    private record processedDiagramResult(
        List<DiagramGraphDto> diagrams,
        String warning
    ) {}
}
