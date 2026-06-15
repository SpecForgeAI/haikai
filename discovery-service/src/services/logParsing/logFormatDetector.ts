/**
 * Log Format Detector
 *
 * Samples the first N lines of a log and determines which format
 * the content most likely follows. Returns one of six format labels:
 *   - 'json_lines'        -- each line is a valid JSON object
 *   - 'syslog'            -- RFC 3164-style syslog messages
 *   - 'framework_pattern' -- Log4j / Logback / similar "%d [%t] %p %c - %m" style
 *   - 'clf_combined'      -- Apache/Nginx Combined Log Format (Common + referrer + user-agent)
 *   - 'clf_common'        -- Apache/Nginx Common Log Format
 *   - 'unknown'           -- none of the above matched
 *
 * Detection is rule-based and deterministic; no LLM involvement.
 */

/**
 * Default number of lines sampled for format auto-detection.
 * Overridable via the constant in logEnrichmentDefaults.ts, but
 * this module uses its own default to remain self-contained.
 */
const DEFAULT_SAMPLE_LINES = 20;

/** Format label union returned by the detector. */
export type LogFormat =
  | 'json_lines'
  | 'syslog'
  | 'framework_pattern'
  | 'clf_combined'
  | 'clf_common'
  | 'unknown';

/**
 * Syslog regex -- matches lines like:
 *   Jan 15 10:30:45 myhost myapp[1234]: some message
 *   2024-01-15T10:30:45Z myhost myapp[1234]: some message
 *
 * Accepts both traditional BSD-style timestamps and ISO-8601 timestamps
 * followed by hostname, optional process[pid], and message.
 */
const SYSLOG_REGEX =
  /^(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*)\s+\S+\s+\S+(?:\[\d+\])?:\s+.+/;

/**
 * Framework pattern regex -- matches lines like:
 *   2024-01-15 10:30:45.123 [main] INFO com.example.App - Starting up
 *   2024-01-15 10:30:45,123 [http-nio-8080-exec-1] DEBUG c.e.SomeClass - handling request
 *
 * Expects: date time [thread] LEVEL logger - message
 */
const FRAMEWORK_PATTERN_REGEX =
  /^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[.,]\d{3}\s+\[.+?\]\s+(?:TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+\S+\s+-\s+.*/;

/**
 * Apache/Nginx Common Log Format regex -- matches lines like:
 *   127.0.0.1 - frank [10/Oct/2026:13:55:36 +0000] "GET /apache_pb.gif HTTP/1.0" 200 2326
 *
 * Captures: host ident authuser [date] "method path proto" status bytes
 *
 * The trailing portion intentionally stops at the bytes field so that
 * Combined Log Format lines (which add `"referrer" "user-agent"`)
 * can be distinguished by a separate, stricter regex.
 */
const CLF_COMMON_REGEX =
  /^\S+\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[A-Z]+\s+\S+\s+\S+"\s+\d{3}\s+(?:\d+|-)\s*$/;

/**
 * Apache/Nginx Combined Log Format regex -- Common Log Format extended
 * with two trailing quoted fields: referrer and user-agent.
 *
 *   127.0.0.1 - frank [10/Oct/2026:13:55:36 +0000] "GET /apache_pb.gif HTTP/1.0" 200 2326 "http://example.com/" "Mozilla/5.0 ..."
 */
const CLF_COMBINED_REGEX =
  /^\S+\s+\S+\s+\S+\s+\[[^\]]+\]\s+"[A-Z]+\s+\S+\s+\S+"\s+\d{3}\s+(?:\d+|-)\s+"[^"]*"\s+"[^"]*"\s*$/;

/**
 * Tries to parse a string as a JSON object.
 * Returns true only if the result is a non-null object (not an array or primitive).
 */
function isJsonObject(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

/**
 * Detects the log format of the provided lines by sampling the first N
 * non-empty lines and checking each format in priority order.
 *
 * Priority: JSON lines > syslog > framework pattern > CLF combined > CLF common > unknown
 *
 * (CLF combined is checked before CLF common because every combined
 * line is also a valid common-line prefix; the stricter combined match
 * must win.)
 *
 * A format "wins" if a majority (> 50%) of the sampled lines match.
 *
 * @param lines - Array of raw log lines (typically the full file split by newline)
 * @param sampleSize - Number of lines to sample (default 20)
 * @returns The detected LogFormat
 */
export function detectLogFormat(
  lines: string[],
  sampleSize: number = DEFAULT_SAMPLE_LINES
): LogFormat {
  // Filter to non-empty lines and take the sample
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const sample = nonEmptyLines.slice(0, sampleSize);

  if (sample.length === 0) {
    return 'unknown';
  }

  // Count matches for each format
  let jsonCount = 0;
  let syslogCount = 0;
  let frameworkCount = 0;
  let clfCombinedCount = 0;
  let clfCommonCount = 0;

  for (const line of sample) {
    if (isJsonObject(line)) jsonCount++;
    if (SYSLOG_REGEX.test(line)) syslogCount++;
    if (FRAMEWORK_PATTERN_REGEX.test(line)) frameworkCount++;
    if (CLF_COMBINED_REGEX.test(line)) {
      clfCombinedCount++;
    } else if (CLF_COMMON_REGEX.test(line)) {
      // Only count as common if it did NOT also match combined
      // (combined is a strict superset; common-only is the residual).
      clfCommonCount++;
    }
  }

  const majority = sample.length / 2;

  // Check in priority order: JSON > syslog > framework > clf_combined > clf_common
  if (jsonCount > majority) return 'json_lines';
  if (syslogCount > majority) return 'syslog';
  if (frameworkCount > majority) return 'framework_pattern';
  if (clfCombinedCount > majority) return 'clf_combined';
  if (clfCommonCount > majority) return 'clf_common';

  return 'unknown';
}
