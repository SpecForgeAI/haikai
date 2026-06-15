package com.example.archtool.model.internal;

/**
 * Internal model representing a draw.io diagram source discovered on a Confluence page.
 *
 * <p>This model is used internally by the DrawioScanner to track diagram sources
 * that need to be downloaded and processed. It correlates macro references in the
 * page body with actual attachment files.</p>
 *
 * @param attachmentId       the Confluence attachment ID
 * @param attachmentFileName the filename of the attachment (e.g., "diagram.drawio")
 * @param downloadUrl        the URL to download the attachment content
 * @param referencedByMacro  true if this attachment is referenced by a draw.io macro in the page body,
 *                           false if it's an orphan .drawio attachment discovered via attachments list
 */
public record DrawioDiagramSource(
    String attachmentId,
    String attachmentFileName,
    String downloadUrl,
    boolean referencedByMacro
) {
    /**
     * Creates a DrawioDiagramSource that is referenced by a macro.
     *
     * @param attachmentId       the attachment ID
     * @param attachmentFileName the attachment filename
     * @param downloadUrl        the download URL
     * @return a new DrawioDiagramSource with referencedByMacro set to true
     */
    public static DrawioDiagramSource fromMacroReference(
            String attachmentId,
            String attachmentFileName,
            String downloadUrl) {
        return new DrawioDiagramSource(attachmentId, attachmentFileName, downloadUrl, true);
    }

    /**
     * Creates a DrawioDiagramSource for an orphan attachment (not referenced by any macro).
     *
     * @param attachmentId       the attachment ID
     * @param attachmentFileName the attachment filename
     * @param downloadUrl        the download URL
     * @return a new DrawioDiagramSource with referencedByMacro set to false
     */
    public static DrawioDiagramSource fromOrphanAttachment(
            String attachmentId,
            String attachmentFileName,
            String downloadUrl) {
        return new DrawioDiagramSource(attachmentId, attachmentFileName, downloadUrl, false);
    }
}
