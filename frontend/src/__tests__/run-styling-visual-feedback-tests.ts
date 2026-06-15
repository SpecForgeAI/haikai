/**
 * Runner for Styling and Visual Feedback Tests
 *
 * Usage:
 *   npx ts-node src/__tests__/run-styling-visual-feedback-tests.ts
 */

import { runAllTests } from './styling-visual-feedback.test';

console.log('========================================');
console.log('Task Group 5: Styling and Visual Feedback Tests');
console.log('========================================');

try {
  runAllTests();
  console.log('\nAll styling and visual feedback tests passed!');
  process.exit(0);
} catch (error) {
  console.error('\nTest suite failed:', error);
  process.exit(1);
}
