/**
 * Tests for XLSX/XLSM File Type Additions to fileUploadUtils
 *
 * Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
 * Task Group 3: Accepted File Types Update
 *
 * 3 focused tests:
 * 1. ACCEPTED_EXTENSIONS includes .xlsx and .xlsm
 * 2. ACCEPTED_MIME_TYPES includes both XLSX and XLSM MIME types
 * 3. validateFiles() accepts .xlsx and rejects .xls (legacy)
 */

import { describe, it, expect } from 'vitest';
import {
  ACCEPTED_EXTENSIONS,
  ACCEPTED_MIME_TYPES,
  validateFiles,
} from '../fileUploadUtils';

describe('File Upload Utils - XLSX/XLSM Type Additions (Spec 2026-04-03, Task Group 3)', () => {

  // --------------------------------------------------------------------------
  // Test 1: ACCEPTED_EXTENSIONS includes .xlsx and .xlsm
  // --------------------------------------------------------------------------
  it('should include .xlsx and .xlsm in ACCEPTED_EXTENSIONS', () => {
    expect(ACCEPTED_EXTENSIONS).toContain('.xlsx');
    expect(ACCEPTED_EXTENSIONS).toContain('.xlsm');
  });

  // --------------------------------------------------------------------------
  // Test 2: ACCEPTED_MIME_TYPES includes both XLSX and XLSM MIME types
  // --------------------------------------------------------------------------
  it('should include XLSX and XLSM MIME types in ACCEPTED_MIME_TYPES', () => {
    expect(ACCEPTED_MIME_TYPES).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(ACCEPTED_MIME_TYPES).toContain(
      'application/vnd.ms-excel.sheet.macroEnabled.12'
    );
  });

  // --------------------------------------------------------------------------
  // Test 3: validateFiles() accepts .xlsx and rejects .xls (legacy)
  // --------------------------------------------------------------------------
  it('should accept .xlsx files and reject .xls (legacy) files', () => {
    // Create mock File objects
    const xlsxFile = new File(['content'], 'data.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const xlsFile = new File(['content'], 'data.xls', {
      type: 'application/vnd.ms-excel',
    });

    // .xlsx should be accepted
    const xlsxResult = validateFiles([], [xlsxFile]);
    expect(xlsxResult.valid).toBe(true);

    // .xls (legacy) should be rejected
    const xlsResult = validateFiles([], [xlsFile]);
    expect(xlsResult.valid).toBe(false);
    expect(xlsResult.error).toContain('Unsupported file type');
  });
});
