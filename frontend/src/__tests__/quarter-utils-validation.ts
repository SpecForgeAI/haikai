/**
 * Task Group 2: Quarter Utility Functions Validation
 * Validates quarter comparison, visibility logic, and navigation helpers
 */

import {
  compareQuarters,
  isEntityVisibleInPeriod,
  isRelationshipVisibleInPeriod,
  addQuarters,
  quarterToHalf,
  quarterToYear,
  getDefaultViewQuarter,
  formatPeriodLabel,
} from '../utils/quarterUtils';
import type { Application, DataMovement } from '../types/model';

// Test 1: compareQuarters with various pairs
function testCompareQuarters() {
  // Same quarter
  if (compareQuarters('2026-Q2', '2026-Q2') !== 0) {
    throw new Error('compareQuarters: Same quarter should return 0');
  }

  // Earlier quarter in same year
  if (compareQuarters('2026-Q1', '2026-Q2') !== -1) {
    throw new Error('compareQuarters: Earlier quarter should return -1');
  }

  // Later quarter in same year
  if (compareQuarters('2026-Q3', '2026-Q2') !== 1) {
    throw new Error('compareQuarters: Later quarter should return 1');
  }

  // Earlier year
  if (compareQuarters('2025-Q4', '2026-Q1') !== -1) {
    throw new Error('compareQuarters: Earlier year should return -1');
  }

  // Later year
  if (compareQuarters('2027-Q1', '2026-Q4') !== 1) {
    throw new Error('compareQuarters: Later year should return 1');
  }

  console.log('Test 1 (compareQuarters): PASSED');
}

// Test 2: isEntityVisibleInPeriod with null and defined validity
function testEntityVisibility() {
  const viewQuarter = '2026-Q3';

  // Timeless entity (no validity fields)
  const timelessApp: Application = {
    id: 'app1',
    name: 'Timeless App',
    description: '',
    app_type: 'Web',
    status: 'Active',
    tags: '',
  };
  if (!isEntityVisibleInPeriod(timelessApp, viewQuarter)) {
    throw new Error('Timeless entity should always be visible');
  }

  // Entity with only valid_from (starts in Q1, no end)
  const appWithStart: Application = {
    ...timelessApp,
    valid_from: '2026-Q1',
  };
  if (!isEntityVisibleInPeriod(appWithStart, viewQuarter)) {
    throw new Error('Entity with valid_from before viewQuarter should be visible');
  }

  // Entity with only valid_to (ends in Q4)
  const appWithEnd: Application = {
    ...timelessApp,
    valid_to: '2026-Q4',
  };
  if (!isEntityVisibleInPeriod(appWithEnd, viewQuarter)) {
    throw new Error('Entity with valid_to after viewQuarter should be visible');
  }

  // Entity with both (valid from Q2 to Q4)
  const appWithBoth: Application = {
    ...timelessApp,
    valid_from: '2026-Q2',
    valid_to: '2026-Q4',
  };
  if (!isEntityVisibleInPeriod(appWithBoth, viewQuarter)) {
    throw new Error('Entity within validity range should be visible');
  }

  // Entity not yet valid (starts in Q4, viewing Q3)
  const appNotYetValid: Application = {
    ...timelessApp,
    valid_from: '2026-Q4',
  };
  if (isEntityVisibleInPeriod(appNotYetValid, viewQuarter)) {
    throw new Error('Entity with valid_from after viewQuarter should not be visible');
  }

  // Entity already decommissioned (ends in Q2, viewing Q3)
  const appDecommissioned: Application = {
    ...timelessApp,
    valid_to: '2026-Q2',
  };
  if (isEntityVisibleInPeriod(appDecommissioned, viewQuarter)) {
    throw new Error('Entity with valid_to at or before viewQuarter should not be visible');
  }

  // Edge case: Entity ending exactly at viewQuarter (exclusive end)
  const appEndingNow: Application = {
    ...timelessApp,
    valid_to: '2026-Q3',
  };
  if (isEntityVisibleInPeriod(appEndingNow, viewQuarter)) {
    throw new Error('Entity with valid_to equal to viewQuarter should not be visible (exclusive end)');
  }

  console.log('Test 2 (isEntityVisibleInPeriod): PASSED');
}

// Test 3: isRelationshipVisibleInPeriod edge cases
function testRelationshipVisibility() {
  const viewQuarter = '2026-Q2';

  // Timeless relationship
  const timelessMovement: DataMovement = {
    id: 'dm1',
    source_application_id: 'app1',
    target_application_id: 'app2',
    data_entity_id: 'lde1',
    movement_type: 'Batch',
    description: '',
    tags: '',
  };
  if (!isRelationshipVisibleInPeriod(timelessMovement, viewQuarter)) {
    throw new Error('Timeless relationship should always be visible');
  }

  // Relationship with validity period covering viewQuarter
  const validMovement: DataMovement = {
    ...timelessMovement,
    valid_from: '2026-Q1',
    valid_to: '2026-Q4',
  };
  if (!isRelationshipVisibleInPeriod(validMovement, viewQuarter)) {
    throw new Error('Relationship within validity range should be visible');
  }

  // Relationship not yet valid
  const futureMovement: DataMovement = {
    ...timelessMovement,
    valid_from: '2026-Q3',
  };
  if (isRelationshipVisibleInPeriod(futureMovement, viewQuarter)) {
    throw new Error('Future relationship should not be visible');
  }

  // Relationship already expired
  const expiredMovement: DataMovement = {
    ...timelessMovement,
    valid_to: '2026-Q1',
  };
  if (isRelationshipVisibleInPeriod(expiredMovement, viewQuarter)) {
    throw new Error('Expired relationship should not be visible');
  }

  console.log('Test 3 (isRelationshipVisibleInPeriod): PASSED');
}

// Test 4: addQuarters navigation
function testAddQuarters() {
  // Add 1 quarter
  if (addQuarters('2026-Q1', 1) !== '2026-Q2') {
    throw new Error('addQuarters: Adding 1 quarter failed');
  }

  // Add quarters across year boundary
  if (addQuarters('2026-Q4', 1) !== '2027-Q1') {
    throw new Error('addQuarters: Adding across year boundary failed');
  }

  // Subtract 1 quarter
  if (addQuarters('2026-Q2', -1) !== '2026-Q1') {
    throw new Error('addQuarters: Subtracting 1 quarter failed');
  }

  // Subtract across year boundary
  if (addQuarters('2027-Q1', -1) !== '2026-Q4') {
    throw new Error('addQuarters: Subtracting across year boundary failed');
  }

  // Add 2 quarters (half)
  if (addQuarters('2026-Q1', 2) !== '2026-Q3') {
    throw new Error('addQuarters: Adding 2 quarters failed');
  }

  // Add 4 quarters (year)
  if (addQuarters('2026-Q1', 4) !== '2027-Q1') {
    throw new Error('addQuarters: Adding 4 quarters failed');
  }

  console.log('Test 4 (addQuarters): PASSED');
}

// Test 5: quarterToHalf conversion
function testQuarterToHalf() {
  // Q1 -> Q2 (H1)
  if (quarterToHalf('2026-Q1') !== '2026-Q2') {
    throw new Error('quarterToHalf: Q1 should convert to Q2');
  }

  // Q2 -> Q2 (H1)
  if (quarterToHalf('2026-Q2') !== '2026-Q2') {
    throw new Error('quarterToHalf: Q2 should stay Q2');
  }

  // Q3 -> Q4 (H2)
  if (quarterToHalf('2026-Q3') !== '2026-Q4') {
    throw new Error('quarterToHalf: Q3 should convert to Q4');
  }

  // Q4 -> Q4 (H2)
  if (quarterToHalf('2026-Q4') !== '2026-Q4') {
    throw new Error('quarterToHalf: Q4 should stay Q4');
  }

  console.log('Test 5 (quarterToHalf): PASSED');
}

// Test 6: quarterToYear conversion
function testQuarterToYear() {
  // All quarters should convert to Q4
  if (quarterToYear('2026-Q1') !== '2026-Q4') {
    throw new Error('quarterToYear: Q1 should convert to Q4');
  }

  if (quarterToYear('2026-Q2') !== '2026-Q4') {
    throw new Error('quarterToYear: Q2 should convert to Q4');
  }

  if (quarterToYear('2026-Q3') !== '2026-Q4') {
    throw new Error('quarterToYear: Q3 should convert to Q4');
  }

  if (quarterToYear('2026-Q4') !== '2026-Q4') {
    throw new Error('quarterToYear: Q4 should stay Q4');
  }

  console.log('Test 6 (quarterToYear): PASSED');
}

// Test 7: formatPeriodLabel
function testFormatPeriodLabel() {
  const quarter = '2026-Q3';

  // Quarter format
  if (formatPeriodLabel(quarter, 'Quarter') !== 'End of Q3 2026') {
    throw new Error('formatPeriodLabel: Quarter format incorrect');
  }

  // Half format (Q3 is H2)
  if (formatPeriodLabel(quarter, 'Half') !== 'End of H2 2026') {
    throw new Error('formatPeriodLabel: Half format incorrect');
  }

  // Year format
  if (formatPeriodLabel(quarter, 'Year') !== 'End of 2026') {
    throw new Error('formatPeriodLabel: Year format incorrect');
  }

  // H1 test
  if (formatPeriodLabel('2026-Q1', 'Half') !== 'End of H1 2026') {
    throw new Error('formatPeriodLabel: H1 format incorrect');
  }

  console.log('Test 7 (formatPeriodLabel): PASSED');
}

// Test 8: getDefaultViewQuarter
function testGetDefaultViewQuarter() {
  const defaultQuarter = getDefaultViewQuarter();
  if (defaultQuarter !== '2026-Q4') {
    throw new Error(`getDefaultViewQuarter: Expected "2026-Q4", got "${defaultQuarter}"`);
  }

  console.log('Test 8 (getDefaultViewQuarter): PASSED');
}

// Run all tests
export function runQuarterUtilsValidation() {
  console.log('=== Task Group 2: Quarter Utils Validation ===');

  try {
    testCompareQuarters();
    testEntityVisibility();
    testRelationshipVisibility();
    testAddQuarters();
    testQuarterToHalf();
    testQuarterToYear();
    testFormatPeriodLabel();
    testGetDefaultViewQuarter();

    console.log('\n✓ All Task Group 2 tests PASSED');
    return true;
  } catch (error) {
    console.error('\n✗ Task Group 2 tests FAILED:', error);
    return false;
  }
}

