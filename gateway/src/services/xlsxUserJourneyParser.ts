/**
 * XLSX User Journey Parser
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 1: XLSX Parser Module
 *
 * Provides deterministic parsing of .xlsx/.xlsm workbooks containing
 * User Journey data (three required worksheets: "Process Activities",
 * "User Journeys", "Activity Steps") plus optional worksheets (e.g.,
 * "User Journey Links") into delimited CSV-text blocks for LLM consumption.
 *
 * Design note: .xlsm files are accepted and parsed identically to .xlsx.
 * SheetJS does not execute macros, and all macro-related content is
 * completely ignored -- no execution, no inspection, no preservation.
 */

import * as XLSX from 'xlsx';

// ============================================================================
// Types
// ============================================================================

/**
 * Discriminated union return type for the parser.
 * - success: true  => csvText contains the concatenated delimited CSV-text blocks
 * - success: false => error contains a descriptive validation error message
 */
export type ParseResult =
  | { success: true; csvText: string }
  | { success: false; error: string };

// ============================================================================
// Constants
// ============================================================================

/** Required worksheet names in processing order */
const REQUIRED_WORKSHEETS = [
  'Process Activities',
  'User Journeys',
  'Activity Steps',
] as const;

/** Required column headers per worksheet (only required columns; optional columns may be absent) */
const REQUIRED_HEADERS: Record<string, string[]> = {
  'Process Activities': ['Activity Name', 'Parent Business Process'],
  'User Journeys': ['User Journey Name'],
  'Activity Steps': ['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label'],
};

/** Optional worksheet names in processing order */
const OPTIONAL_WORKSHEETS = ['User Journey Links'] as const;

/** Required column headers for optional worksheets (if the sheet is present, these headers must exist) */
const OPTIONAL_HEADERS: Record<string, string[]> = {
  'User Journey Links': ['Source User Journey', 'Target User Journey', 'Relationship Type'],
};

// ============================================================================
// Entry Point
// ============================================================================

/**
 * Parses a base64-encoded .xlsx or .xlsm workbook into delimited CSV-text blocks.
 *
 * Validates that all three required worksheets exist and contain required column
 * headers. Optional worksheets (e.g., "User Journey Links") are processed if
 * present and valid; if absent, they are silently skipped. On any validation
 * failure, returns an error immediately without producing partial output.
 *
 * @param base64 - Base64-encoded contents of the .xlsx or .xlsm file
 * @returns ParseResult with either csvText or error
 */
export function parseUserJourneyWorkbook(base64: string): ParseResult {
  // Decode base64 to Buffer and parse workbook
  const buffer = Buffer.from(base64, 'base64');
  const workbook = XLSX.read(buffer, { type: 'buffer' });

  // ---- Validate required worksheets exist ----
  for (const sheetName of REQUIRED_WORKSHEETS) {
    if (!workbook.SheetNames.includes(sheetName)) {
      return {
        success: false,
        error: `Workbook is missing required worksheet: ${sheetName}`,
      };
    }
  }

  // ---- Validate required column headers in each required worksheet ----
  for (const sheetName of REQUIRED_WORKSHEETS) {
    const sheet = workbook.Sheets[sheetName];
    const headers = getSheetHeaders(sheet);
    const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
    const requiredHeaders = REQUIRED_HEADERS[sheetName];

    for (const requiredHeader of requiredHeaders) {
      if (!normalizedHeaders.includes(requiredHeader.trim().toLowerCase())) {
        return {
          success: false,
          error: `Worksheet "${sheetName}" is missing required column header: ${requiredHeader}`,
        };
      }
    }
  }

  // ---- Validate optional worksheets (if present) ----
  for (const sheetName of OPTIONAL_WORKSHEETS) {
    if (workbook.SheetNames.includes(sheetName)) {
      const sheet = workbook.Sheets[sheetName];
      const headers = getSheetHeaders(sheet);
      const normalizedHeaders = headers.map((h) => h.trim().toLowerCase());
      const requiredHeaders = OPTIONAL_HEADERS[sheetName];

      for (const requiredHeader of requiredHeaders) {
        if (!normalizedHeaders.includes(requiredHeader.trim().toLowerCase())) {
          return {
            success: false,
            error: `Worksheet "${sheetName}" is missing required column header: ${requiredHeader}`,
          };
        }
      }
    }
  }

  // ---- Convert each required worksheet to delimited CSV-text ----
  const blocks: string[] = [];

  for (const sheetName of REQUIRED_WORKSHEETS) {
    const sheet = workbook.Sheets[sheetName];
    const csvText = XLSX.utils.sheet_to_csv(sheet);
    blocks.push(
      `--- Worksheet: ${sheetName} ---\n${csvText}\n--- End Worksheet: ${sheetName} ---`
    );
  }

  // ---- Convert each present optional worksheet to delimited CSV-text ----
  for (const sheetName of OPTIONAL_WORKSHEETS) {
    if (workbook.SheetNames.includes(sheetName)) {
      const sheet = workbook.Sheets[sheetName];
      const csvText = XLSX.utils.sheet_to_csv(sheet);
      blocks.push(
        `--- Worksheet: ${sheetName} ---\n${csvText}\n--- End Worksheet: ${sheetName} ---`
      );
    }
  }

  return {
    success: true,
    csvText: blocks.join('\n'),
  };
}

// ============================================================================
// Deterministic Process Activities extraction from CSV text blocks
// ============================================================================

/** Column header → JSON field name mapping for Process Activities */
const PA_HEADER_MAP: Record<string, string> = {
  'activity name': 'name',
  'parent business process': 'parent_business_process_name',
  'activity description': 'description',
  'activity frequency': 'frequency',
  'activity user interaction level': 'user_interaction_level',
};

export interface ExtractedProcessActivity {
  name: string;
  parent_business_process_name?: string;
  description?: string;
  frequency?: string;
  user_interaction_level?: string;
}

/**
 * Extracts process activities deterministically from the CSV text blocks
 * found in the conversation transcript. Parses the "Process Activities"
 * worksheet block and returns structured objects with all column values.
 *
 * @param conversationText - Full conversation transcript text containing CSV blocks
 * @returns Array of extracted process activities, empty if no block found
 */
export function extractProcessActivitiesFromTranscript(conversationText: string): ExtractedProcessActivity[] {
  // Find the Process Activities CSV block
  const blockRegex = /--- Worksheet: Process Activities ---\n([\s\S]*?)\n--- End Worksheet: Process Activities ---/;
  const match = conversationText.match(blockRegex);
  if (!match) return [];

  const csvBlock = match[1].trim();
  const lines = csvBlock.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return []; // Need at least header + 1 data row

  // Parse header row to get column indices
  const headers = parseCSVLine(lines[0]);
  const columnIndices: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    const normalized = headers[i].trim().toLowerCase();
    if (PA_HEADER_MAP[normalized]) {
      columnIndices[PA_HEADER_MAP[normalized]] = i;
    }
  }

  // Must have at least the 'name' column
  if (columnIndices['name'] === undefined) return [];

  // Parse data rows
  const results: ExtractedProcessActivity[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const name = values[columnIndices['name']]?.trim();
    if (!name) continue; // Skip empty rows

    const pa: ExtractedProcessActivity = { name };
    if (columnIndices['parent_business_process_name'] !== undefined) {
      const val = values[columnIndices['parent_business_process_name']]?.trim();
      if (val) pa.parent_business_process_name = val;
    }
    if (columnIndices['description'] !== undefined) {
      const val = values[columnIndices['description']]?.trim();
      if (val) pa.description = val;
    }
    if (columnIndices['frequency'] !== undefined) {
      const val = values[columnIndices['frequency']]?.trim();
      if (val) pa.frequency = val;
    }
    if (columnIndices['user_interaction_level'] !== undefined) {
      const val = values[columnIndices['user_interaction_level']]?.trim();
      if (val) pa.user_interaction_level = val;
    }
    results.push(pa);
  }

  return results;
}

/**
 * Simple CSV line parser that handles quoted fields with commas.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Extracts column header strings from the first row of a worksheet.
 * Returns an array of header values (as strings).
 */
function getSheetHeaders(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
  if (rows.length === 0) {
    return [];
  }
  // First row contains headers; convert all values to strings
  return rows[0].map((cell) => (cell != null ? String(cell) : ''));
}
