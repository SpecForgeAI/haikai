/**
 * Utility for generating unique, prefixed IDs for architecture model entities.
 *
 * ID pattern: {prefix}{base36Timestamp}-{5charRandomAlphanumeric}
 * Example: svc-mk8r1ccg-bd7tv
 *
 * Supported prefixes:
 *   svc-   (services)
 *   ifc-   (interfaces)
 *   ep-    (endpoints)
 *   lde-   (logical data entities)
 *   pde-   (physical data entities)
 *   bl-    (business logic)
 *   dm-    (data movements)
 *   app-   (applications)
 *   comp-  (app components)
 *   ile-   (interface_logical_entities)
 *   ldepe- (logical_data_entity_physical_data_entities)
 *   apbl-  (application_point_business_logics)
 */

/**
 * Characters used for the random suffix portion of the ID.
 */
const ALPHANUMERIC_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Length of the random suffix appended after the timestamp.
 */
const RANDOM_SUFFIX_LENGTH = 5;

/**
 * Generates a unique, prefixed ID for an architecture model entity.
 *
 * @param prefix - The entity type prefix (e.g., 'svc-', 'ifc-', 'ep-')
 * @returns A unique ID string in the format {prefix}{base36Timestamp}-{randomSuffix}
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const suffix = generateRandomSuffix(RANDOM_SUFFIX_LENGTH);
  return `${prefix}${timestamp}-${suffix}`;
}

/**
 * Generates a random alphanumeric string of the given length.
 *
 * @param length - Number of random characters to generate
 * @returns Random alphanumeric string
 */
function generateRandomSuffix(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * ALPHANUMERIC_CHARS.length);
    result += ALPHANUMERIC_CHARS[randomIndex];
  }
  return result;
}
