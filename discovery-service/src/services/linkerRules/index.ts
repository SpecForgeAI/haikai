/**
 * Linker Rules Barrel Export
 *
 * Exports all linker rule instances and provides a
 * registerAllLinkerRules() function called from
 * initializeLinkerRuleRegistry() at startup.
 */

import { registerLinkerRule } from '../linkerRuleRegistry';
import { containsByPathRule } from './containsByPathRule';
import { importsByPatternRule } from './importsByPatternRule';
import { extendsByPatternRule } from './extendsByPatternRule';
import { referencesBySymbolRule } from './referencesBySymbolRule';

export { containsByPathRule } from './containsByPathRule';
export { importsByPatternRule } from './importsByPatternRule';
export { extendsByPatternRule } from './extendsByPatternRule';
export { referencesBySymbolRule } from './referencesBySymbolRule';

/**
 * Registers all built-in linker rules into the registry.
 * Called by initializeLinkerRuleRegistry() at startup.
 */
export function registerAllLinkerRules(): void {
  registerLinkerRule(containsByPathRule);
  registerLinkerRule(importsByPatternRule);
  registerLinkerRule(extendsByPatternRule);
  registerLinkerRule(referencesBySymbolRule);
}
