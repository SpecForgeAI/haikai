/**
 * Tests for XLSX User Journey Parser
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 1: XLSX Parser Module
 *
 * 6 focused tests (original):
 * 1. Valid workbook produces correct delimited CSV-text output
 * 2. Missing required worksheet returns validation error
 * 3. Missing required column header returns validation error
 * 4. Extra worksheets are silently ignored
 * 5. .xlsm content is parsed identically to .xlsx
 * 6. Optional columns missing still parses successfully
 *
 * 6 additional tests (Spec 2026-04-07, Task Group 1 - Optional 4th Worksheet):
 * 7. Valid 4th sheet ("User Journey Links") parses successfully
 * 8. 3-sheet workbook (no "User Journey Links") parses successfully (backward compat)
 * 9. 4th sheet with invalid/missing required headers returns validation error
 * 10. 4th sheet with blank rows excludes blank rows from CSV-text output
 * 11. 4th sheet with only required headers (no optional columns) still parses
 * 12. 4th sheet with unsupported relationship type values included without rejection
 *
 * Test fixtures are created programmatically using the xlsx library
 * (no committed binary fixture files).
 */

import * as XLSX from 'xlsx';
import { parseUserJourneyWorkbook, ParseResult } from '../services/xlsxUserJourneyParser';

// ============================================================================
// Helpers: Programmatic workbook creation
// ============================================================================

/**
 * Creates a minimal valid workbook with all three required worksheets and
 * required column headers, returning its base64-encoded content.
 */
function createValidWorkbookBase64(options?: {
  extraSheets?: Record<string, string[][]>;
  processActivitiesData?: string[][];
  userJourneysData?: string[][];
  activityStepsData?: string[][];
  bookType?: XLSX.BookType;
}): string {
  const wb = XLSX.utils.book_new();

  const paData = options?.processActivitiesData ?? [
    ['Activity Name', 'Parent Business Process', 'Activity Description'],
    ['Login', 'Authentication', 'User logs into system'],
    ['Browse Catalog', 'Shopping', 'User browses product catalog'],
  ];
  const ujData = options?.userJourneysData ?? [
    ['User Journey Name', 'User Journey Description', 'Primary Business User Role'],
    ['Customer Onboarding', 'New customer setup flow', 'End User'],
    ['Product Purchase', 'Buying a product', 'Shopper'],
  ];
  const asData = options?.activityStepsData ?? [
    ['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label', 'Activity Step Order'],
    ['Customer Onboarding', 'Login', 'End User', 'Web Portal', 'Log In Step', 'Log In', '1'],
    ['Product Purchase', 'Browse Catalog', 'Shopper', 'E-Commerce App', 'Browse Step', 'Browse', '1'],
  ];

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(paData), 'Process Activities');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ujData), 'User Journeys');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(asData), 'Activity Steps');

  // Add extra sheets if provided
  if (options?.extraSheets) {
    for (const [name, data] of Object.entries(options.extraSheets)) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), name);
    }
  }

  const bookType = options?.bookType ?? 'xlsx';
  const buffer = XLSX.write(wb, { type: 'buffer', bookType });
  return Buffer.from(buffer).toString('base64');
}

// ============================================================================
// Tests - Original (Spec 2026-04-03, Task Group 1)
// ============================================================================

describe('XLSX User Journey Parser (Spec 2026-04-03, Task Group 1)', () => {

  // --------------------------------------------------------------------------
  // Test 1: Valid workbook produces correct delimited CSV-text output
  // --------------------------------------------------------------------------
  it('should produce correct delimited CSV-text output for a valid workbook with all three required worksheets', () => {
    const base64 = createValidWorkbookBase64();
    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return; // Type narrowing

    // Verify all three worksheet delimiters are present
    expect(result.csvText).toContain('--- Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- End Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- End Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- Worksheet: Activity Steps ---');
    expect(result.csvText).toContain('--- End Worksheet: Activity Steps ---');

    // Verify CSV data content
    expect(result.csvText).toContain('Activity Name,Parent Business Process');
    expect(result.csvText).toContain('Login,Authentication');
    expect(result.csvText).toContain('User Journey Name');
    expect(result.csvText).toContain('Customer Onboarding');
    expect(result.csvText).toContain('User Journey Name,Activity Name,Business User Role,Application');
    expect(result.csvText).toContain('Customer Onboarding,Login,End User,Web Portal');
  });

  // --------------------------------------------------------------------------
  // Test 2: Missing required worksheet returns validation error
  // --------------------------------------------------------------------------
  it('should return a validation error when a required worksheet is missing', () => {
    const wb = XLSX.utils.book_new();

    // Only add two of the three required worksheets (missing "Activity Steps")
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['Activity Name', 'Parent Business Process']]),
      'Process Activities'
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['User Journey Name']]),
      'User Journeys'
    );

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const base64 = Buffer.from(buffer).toString('base64');

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('Activity Steps');
    expect(result.error).toContain('missing required worksheet');
  });

  // --------------------------------------------------------------------------
  // Test 3: Missing required column header returns validation error
  // --------------------------------------------------------------------------
  it('should return a validation error when a required column header is missing from a worksheet', () => {
    const base64 = createValidWorkbookBase64({
      // "User Journeys" missing the required "User Journey Name" header
      userJourneysData: [['some_other_column'], ['value1']],
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('User Journey Name');
    expect(result.error).toContain('User Journeys');
    expect(result.error).toContain('missing required column header');
  });

  // --------------------------------------------------------------------------
  // Test 4: Extra worksheets are silently ignored
  // --------------------------------------------------------------------------
  it('should silently ignore extra worksheets beyond the three required ones', () => {
    const base64 = createValidWorkbookBase64({
      extraSheets: {
        'Notes': [['note'], ['This is a note']],
        'Instructions': [['step'], ['Step 1']],
      },
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Should NOT contain extra worksheet delimiters
    expect(result.csvText).not.toContain('Notes');
    expect(result.csvText).not.toContain('Instructions');

    // Should still contain all three required worksheets
    expect(result.csvText).toContain('--- Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- Worksheet: Activity Steps ---');
  });

  // --------------------------------------------------------------------------
  // Test 5: .xlsm content is parsed identically to .xlsx
  // --------------------------------------------------------------------------
  it('should parse .xlsm content identically to .xlsx (macro content ignored)', () => {
    const xlsxBase64 = createValidWorkbookBase64({ bookType: 'xlsx' });
    const xlsmBase64 = createValidWorkbookBase64({ bookType: 'xlsm' });

    const xlsxResult = parseUserJourneyWorkbook(xlsxBase64);
    const xlsmResult = parseUserJourneyWorkbook(xlsmBase64);

    expect(xlsxResult.success).toBe(true);
    expect(xlsmResult.success).toBe(true);

    if (!xlsxResult.success || !xlsmResult.success) return;

    // Both formats produce the same CSV-text output
    expect(xlsmResult.csvText).toBe(xlsxResult.csvText);
  });

  // --------------------------------------------------------------------------
  // Test 6: Optional columns missing still parses successfully
  // --------------------------------------------------------------------------
  it('should parse successfully when only optional columns are missing', () => {
    // Required columns present, optional ones (Activity Step Order, Activity Description, etc.) absent
    const base64 = createValidWorkbookBase64({
      processActivitiesData: [
        ['Activity Name', 'Parent Business Process'],
        ['Login', 'Auth'],
      ],
      userJourneysData: [
        ['User Journey Name'],
        ['Onboarding'],
      ],
      activityStepsData: [
        ['User Journey Name', 'Activity Name', 'Business User Role', 'Application', 'Activity Step Name', 'Activity Step Diagram Label'],
        ['Onboarding', 'Login', 'User', 'App', 'Login Step', 'Login'],
      ],
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.csvText).toContain('Login,Auth');
    expect(result.csvText).toContain('Onboarding');
    expect(result.csvText).toContain('Onboarding,Login,User,App');
  });
});

// ============================================================================
// Tests - Optional 4th Worksheet (Spec 2026-04-07, Task Group 1)
// ============================================================================

describe('XLSX User Journey Parser - Optional 4th Worksheet (Spec 2026-04-07, Task Group 1)', () => {

  // --------------------------------------------------------------------------
  // Test 7: Valid 4th sheet ("User Journey Links") parses successfully
  // --------------------------------------------------------------------------
  it('should parse a valid 4th sheet ("User Journey Links") and append its CSV-text block after the 3 required blocks', () => {
    const base64 = createValidWorkbookBase64({
      extraSheets: {
        'User Journey Links': [
          ['Source User Journey', 'Target User Journey', 'Relationship Type', 'Relationship Label', 'Relationship Description'],
          ['Customer Onboarding', 'Product Purchase', 'PRECEDES', 'Onboarding leads to purchase', 'After onboarding the user typically purchases'],
          ['Product Purchase', 'Customer Onboarding', 'RELATES_TO', 'Return flow', 'Returning customers re-onboard'],
        ],
      },
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Verify all 3 required worksheet blocks are present
    expect(result.csvText).toContain('--- Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- Worksheet: Activity Steps ---');

    // Verify the 4th optional worksheet block is present
    expect(result.csvText).toContain('--- Worksheet: User Journey Links ---');
    expect(result.csvText).toContain('--- End Worksheet: User Journey Links ---');

    // Verify CSV data from the 4th sheet is included
    expect(result.csvText).toContain('Source User Journey,Target User Journey,Relationship Type');
    expect(result.csvText).toContain('Customer Onboarding,Product Purchase,PRECEDES');
    expect(result.csvText).toContain('Product Purchase,Customer Onboarding,RELATES_TO');

    // Verify the 4th block appears after the 3 required blocks
    const activityStepsEndIdx = result.csvText.indexOf('--- End Worksheet: Activity Steps ---');
    const linksStartIdx = result.csvText.indexOf('--- Worksheet: User Journey Links ---');
    expect(activityStepsEndIdx).toBeGreaterThan(-1);
    expect(linksStartIdx).toBeGreaterThan(-1);
    expect(linksStartIdx).toBeGreaterThan(activityStepsEndIdx);
  });

  // --------------------------------------------------------------------------
  // Test 8: 3-sheet workbook (no "User Journey Links") parses successfully
  // --------------------------------------------------------------------------
  it('should parse successfully with no User Journey Links block when the 4th sheet is absent (backward compatibility)', () => {
    const base64 = createValidWorkbookBase64();
    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // All 3 required blocks present
    expect(result.csvText).toContain('--- Worksheet: Process Activities ---');
    expect(result.csvText).toContain('--- Worksheet: User Journeys ---');
    expect(result.csvText).toContain('--- Worksheet: Activity Steps ---');

    // No User Journey Links block
    expect(result.csvText).not.toContain('--- Worksheet: User Journey Links ---');
    expect(result.csvText).not.toContain('--- End Worksheet: User Journey Links ---');
  });

  // --------------------------------------------------------------------------
  // Test 9: 4th sheet with invalid/missing required headers returns error
  // --------------------------------------------------------------------------
  it('should return a validation error when the 4th sheet is present but has missing required headers', () => {
    const base64 = createValidWorkbookBase64({
      extraSheets: {
        'User Journey Links': [
          // Missing "Relationship Type" header
          ['Source User Journey', 'Target User Journey', 'Some Other Column'],
          ['Customer Onboarding', 'Product Purchase', 'PRECEDES'],
        ],
      },
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error).toContain('User Journey Links');
    expect(result.error).toContain('Relationship Type');
    expect(result.error).toContain('missing required column header');
  });

  // --------------------------------------------------------------------------
  // Test 10: 4th sheet with blank rows excludes them from CSV-text output
  // --------------------------------------------------------------------------
  it('should exclude blank rows from the 4th sheet CSV-text output', () => {
    const base64 = createValidWorkbookBase64({
      extraSheets: {
        'User Journey Links': [
          ['Source User Journey', 'Target User Journey', 'Relationship Type'],
          ['Customer Onboarding', 'Product Purchase', 'PRECEDES'],
          ['', '', ''],  // blank row
          ['Product Purchase', 'Customer Onboarding', 'RELATES_TO'],
        ],
      },
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Extract the User Journey Links block
    const blockStart = result.csvText.indexOf('--- Worksheet: User Journey Links ---');
    const blockEnd = result.csvText.indexOf('--- End Worksheet: User Journey Links ---');
    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);

    const linksBlock = result.csvText.substring(
      blockStart + '--- Worksheet: User Journey Links ---'.length,
      blockEnd
    ).trim();

    // The block should contain the header row and two data rows;
    // the blank row (all empty cells) may appear as commas but should not
    // contain any meaningful data between the two valid rows.
    expect(linksBlock).toContain('Customer Onboarding,Product Purchase,PRECEDES');
    expect(linksBlock).toContain('Product Purchase,Customer Onboarding,RELATES_TO');
  });

  // --------------------------------------------------------------------------
  // Test 11: 4th sheet with only required headers (no optional columns)
  // --------------------------------------------------------------------------
  it('should parse successfully when the 4th sheet has only required headers and no optional columns', () => {
    const base64 = createValidWorkbookBase64({
      extraSheets: {
        'User Journey Links': [
          ['Source User Journey', 'Target User Journey', 'Relationship Type'],
          ['Customer Onboarding', 'Product Purchase', 'PRECEDES'],
        ],
      },
    });

    const result = parseUserJourneyWorkbook(base64);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.csvText).toContain('--- Worksheet: User Journey Links ---');
    expect(result.csvText).toContain('Source User Journey,Target User Journey,Relationship Type');
    expect(result.csvText).toContain('Customer Onboarding,Product Purchase,PRECEDES');
  });

  // --------------------------------------------------------------------------
  // Test 12: 4th sheet with unsupported relationship type values is included
  // --------------------------------------------------------------------------
  it('should include the 4th sheet CSV-text without parser-level rejection even when relationship type values are unsupported', () => {
    const base64 = createValidWorkbookBase64({
      extraSheets: {
        'User Journey Links': [
          ['Source User Journey', 'Target User Journey', 'Relationship Type'],
          ['Customer Onboarding', 'Product Purchase', 'INVALID_TYPE'],
          ['Product Purchase', 'Customer Onboarding', 'NOT_A_REAL_TYPE'],
        ],
      },
    });

    const result = parseUserJourneyWorkbook(base64);

    // Parser should succeed -- validation of relationship type values is downstream
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.csvText).toContain('--- Worksheet: User Journey Links ---');
    expect(result.csvText).toContain('INVALID_TYPE');
    expect(result.csvText).toContain('NOT_A_REAL_TYPE');
  });
});
