/**
 * Test Setup
 *
 * Configures the test environment for React component testing.
 */
import '@testing-library/jest-dom';

// jsdom does not implement URL.createObjectURL / revokeObjectURL (used by
// download/export flows such as SVG diagram export). Provide stable stubs so
// component code that creates blob URLs can run under tests.
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:vitest-stub';
}
if (typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}
