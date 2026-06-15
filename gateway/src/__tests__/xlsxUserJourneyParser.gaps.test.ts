/**
 * Gap-Fill Tests for XLSX User Journey Parser and ChatV2 Intercept
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 4: Test Review and Gap Analysis
 *
 * Up to 8 additional strategic tests filling critical gaps:
 * 1. End-to-end integration: real parser called from chatV2 with realistic XLSX
 * 2. Empty worksheets (headers only, no data rows) produce valid minimal CSV-text
 * 3. CSV escaping of special characters (commas, quotes, newlines)
 * 4. Correct worksheet order in concatenated output
 * 5. Case sensitivity of worksheet name matching
 * 6. Workbook with all optional + required columns parses correctly
 * 7. Multiple XLSX files in one request are each parsed
 * 8. Parser handles completely empty workbook (no rows at all) with clear error
 */

import * as XLSX from 'xlsx';
import { parseUserJourneyWorkbook } from '../services/xlsxUserJourneyParser';

// ============================================================================
// Helpers
// ============================================================================

function createWorkbookBase64(sheets: Record<string, string[][]>, bookType: XLSX.BookType = 'xlsx'): string {
  const wb = XLSX.utils.book_new();
  for (const [name, data] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
  }
  const buffer = XLSX.write(wb, { type: 'buffer', bookType });
  return Buffer.from(buffer).toString('base64');
}

function createValidSheets(overrides?: Partial<Record<string, string[][]>>): Record<string, string[][]> {
  return {
    'Process Activities': [
      ['Activity Name', 'Parent Business Process'],
      ['Login', 'Authentication'],
    ],
    'User Journeys': [
      ['User Journey Name'],
      ['Customer Onboarding'],
    ],
    'Activity Steps': [
      ['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label'],
      ['Customer Onboarding', 'Login', 'End User', 'Web Portal', 'Login Step', 'Login'],
    ],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('XLSX User Journey Parser - Gap-Fill Tests (Spec 2026-04-03, Task Group 4)', () => {

  // --------------------------------------------------------------------------
  // Gap 1: Empty worksheets (headers only, no data rows)
  // --------------------------------------------------------------------------
  it('should produce valid CSV-text with header rows only when worksheets have no data rows', () => {
    const base64 = createWorkbookBase64({
      'Process Activities': [['Activity Name', 'Parent Business Process']],
      'User Journeys': [['User Journey Name']],
      'Activity Steps': [['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label']],
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Should contain headers but no data rows
    expect(result.csvText).toContain('Activity Name,Parent Business Process');
    expect(result.csvText).toContain('User Journey Name');
    expect(result.csvText).toContain('User Journey Name,Activity Name,Business User Role,Application');

    // All delimiter pairs should still be present
    expect(result.csvText).toContain('--- Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- End Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- End Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- Worksheet: Activity Steps ---');
    expect(result.csvText).toContain('--- End Worksheet: Activity Steps ---');
  });

  // --------------------------------------------------------------------------
  // Gap 2: CSV escaping of special characters
  // --------------------------------------------------------------------------
  it('should correctly CSV-escape cell values containing commas, quotes, and special characters', () => {
    const base64 = createWorkbookBase64(createValidSheets({
      'Process Activities': [
        ['Activity Name', 'Parent Business Process'],
        ['Login, Register', 'Auth "Service"'],
        ['Review & Submit', 'Order Processing'],
      ],
    }));

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // SheetJS CSV output should properly quote fields with commas and quotes
    // A field with a comma should be quoted: "Login, Register"
    expect(result.csvText).toContain('"Login, Register"');
    // A field with quotes should have escaped quotes: "Auth ""Service"""
    expect(result.csvText).toContain('"Auth ""Service"""');
  });

  // --------------------------------------------------------------------------
  // Gap 3: Correct worksheet order in concatenated output
  // --------------------------------------------------------------------------
  it('should output worksheets in the correct order: Process Activities, User Journeys, Activity Steps', () => {
    const base64 = createWorkbookBase64(createValidSheets());

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const paStart = result.csvText.indexOf('--- Worksheet: Process Activities ---');
    const ujStart = result.csvText.indexOf('--- Worksheet: User Journeys ---');
    const asStart = result.csvText.indexOf('--- Worksheet: Activity Steps ---');

    expect(paStart).toBeGreaterThanOrEqual(0);
    expect(ujStart).toBeGreaterThan(paStart);
    expect(asStart).toBeGreaterThan(ujStart);
  });

  // --------------------------------------------------------------------------
  // Gap 4: Case sensitivity of worksheet name matching
  // --------------------------------------------------------------------------
  it('should fail validation when worksheet names have incorrect case (e.g., "process activities" lowercase)', () => {
    const base64 = createWorkbookBase64({
      'process activities': [['Activity Name', 'Parent Business Process']],
      'user journeys': [['User Journey Name']],
      'activity steps': [['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label']],
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('missing required worksheet');
  });

  // --------------------------------------------------------------------------
  // Gap 5: Workbook with all optional + required columns
  // --------------------------------------------------------------------------
  it('should parse correctly when both required and optional columns are present', () => {
    const base64 = createWorkbookBase64(createValidSheets({
      'Process Activities': [
        ['Activity Name', 'Parent Business Process', 'Activity Description', 'Activity Frequency'],
        ['Login', 'Authentication', 'User logs in', 'Daily'],
      ],
      'User Journeys': [
        ['User Journey Name', 'User Journey Description', 'Primary Business User Role'],
        ['Onboarding', 'New user onboarding flow', 'Business Admin'],
      ],
      'Activity Steps': [
        ['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label', 'Activity Step Order', 'Activity Step Description'],
        ['Onboarding', 'Login', 'Admin', 'Portal', 'Open Login', 'Login', '1', 'User opens login page'],
      ],
    }));

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // All columns (required + optional) should appear in the CSV output
    expect(result.csvText).toContain('Activity Description');
    expect(result.csvText).toContain('Activity Step Order');
    expect(result.csvText).toContain('Activity Step Description');
    expect(result.csvText).toContain('Primary Business User Role');
  });

  // --------------------------------------------------------------------------
  // Gap 6: Parser returns error for worksheet with completely empty first row (no headers)
  // --------------------------------------------------------------------------
  it('should return validation error when a required worksheet has no header row', () => {
    const wb = XLSX.utils.book_new();
    // Process Activities has data but User Journeys has an empty sheet
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Activity Name', 'Parent Business Process'], ['Login', 'Auth']]),
      'Process Activities'
    );
    // Empty sheet for User Journeys (no rows at all)
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), 'User Journeys');
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label']]),
      'Activity Steps'
    );

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const base64 = Buffer.from(buffer).toString('base64');

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('User Journey Name');
    expect(result.error).toContain('missing required column header');
  });
});
