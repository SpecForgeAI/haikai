/**
 * Test Runner: Process Activity Frequency Feature
 *
 * Run these tests with Vitest:
 *   npx vitest run src/__tests__/process-activity-frequency.test.ts --reporter=verbose
 *
 * Or run in watch mode:
 *   npx vitest src/__tests__/process-activity-frequency.test.ts
 *
 * Test coverage:
 * - Task Group 1: TypeScript Type Definitions (4 tests)
 *   - ProcessActivityFrequency type accepts all 9 valid enum values
 *   - ProcessActivity interface accepts optional frequency field
 *   - ProcessActivity interface type compatibility with existing patterns
 *   - PROCESS_ACTIVITY is in ENTITY_TYPES
 *
 * - Task Group 2: Dropdown Options and Grid Configuration (4 tests)
 *   - processActivityFrequencyOptions contains all 9 enum values
 *   - processActivityFrequencyOptions array order matches spec
 *   - process_activities grid config includes frequency column
 *   - frequency column is at correct index position
 *
 * - Task Group 3: JSON Loading and Migration (4 tests)
 *   - loading JSON with frequency field preserves the value
 *   - loading JSON without frequency field results in undefined
 *   - loading JSON with valid frequency enum value passes through correctly
 *   - migrateProcessActivity function returns object with frequency property
 *
 * - Task Group 4: Additional Strategic Tests (7 tests)
 *   - ProcessActivity with frequency integrates with existing fields correctly
 *   - frequency dropdown column uses correct options array reference
 *   - userInteractionLevelOptions array is separate from frequencyOptions
 *   - loading empty model does not break with missing frequency fields
 *   - loading old format JSON still works with undefined frequency
 *   - ProcessActivity with frequency serializes to JSON correctly
 *   - ProcessActivity without frequency omits field in JSON
 *
 * Total: 19 tests covering the ProcessActivityFrequency feature
 */
