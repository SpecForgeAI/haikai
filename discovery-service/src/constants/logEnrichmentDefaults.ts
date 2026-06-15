/**
 * Log Enrichment Default Constants
 *
 * Configurable defaults for log-based discovery enrichment (Increment 14).
 * Controls confidence adjustment, size limits, and format detection sampling.
 */

/**
 * Additive confidence boost applied when log evidence corroborates
 * existing code-derived patterns.
 */
export const LOG_CORROBORATION_CONFIDENCE_BOOST = 0.10;

/**
 * Maximum confidence value after log corroboration boost.
 * Prevents confidence from exceeding a reasonable ceiling.
 */
export const LOG_MAX_CONFIDENCE_CAP = 0.98;

/**
 * Maximum allowed size in bytes for inline log content (100 MB).
 * Requests exceeding this limit are rejected with 413.
 */
export const LOG_MAX_CONTENT_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * Maximum allowed number of lines in log content.
 * Requests exceeding this limit are rejected with 413.
 */
export const LOG_MAX_LINE_COUNT = 500_000;

/**
 * Number of lines sampled from the beginning of the log content
 * for automatic format detection.
 */
export const LOG_SAMPLE_LINES_FOR_DETECTION = 20;
