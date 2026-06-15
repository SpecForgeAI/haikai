/**
 * Linker Rule Registry
 *
 * Follows the analyzerRegistry.ts pattern.
 * Maintains an in-memory Map of linker rules keyed by their id.
 * Initialized at startup with built-in linker rules via
 * registerAllLinkerRules(); additional rules can be registered
 * via registerLinkerRule().
 */

import { LinkerRule } from '../types';
import { registerAllLinkerRules } from './linkerRules';

/**
 * In-memory registry mapping linker rule IDs to LinkerRule implementations.
 */
let linkerRuleRegistry: Map<string, LinkerRule> = new Map();

/**
 * Initializes the linker rule registry with built-in linker rules.
 * Creates a fresh Map and registers all 4 built-in rules.
 */
export function initializeLinkerRuleRegistry(): void {
  linkerRuleRegistry = new Map();

  // Register all built-in linker rules
  registerAllLinkerRules();

  console.log(`[Discovery] Linker rule registry initialized with ${linkerRuleRegistry.size} rules`);
}

/**
 * Returns the linker rule registry.
 *
 * @returns Map of linker rule IDs to LinkerRule implementations
 */
export function getLinkerRuleRegistry(): Map<string, LinkerRule> {
  return linkerRuleRegistry;
}

/**
 * Registers a new linker rule in the registry.
 *
 * @param rule - The linker rule to register
 */
export function registerLinkerRule(rule: LinkerRule): void {
  linkerRuleRegistry.set(rule.id, rule);
}
