/**
 * Dependency Resolver Registry
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 2.
 *
 * Manages registration and lookup of {@link DependencyResolver}s used
 * by the library-discovery walker (Task Group 3) to parse Maven /
 * npm manifests in a cloned repo. Resolvers are registered at
 * startup via the sibling `dependencyResolvers/register.ts`
 * side-effect import; no runtime mutation after startup.
 *
 * Surface mirrors {@link extensionPackRegistry} 1:1:
 *   - `registerDependencyResolver(resolver)` — register at startup.
 *   - `getDependencyResolver(ecosystem)` — lookup by ecosystem id.
 *   - `getRegisteredEcosystems()` — list of all registered ecosystems.
 *   - `clearRegistry()` — reset for tests.
 */

import type { DependencyResolver } from './dependencyResolvers/types';

/**
 * Internal storage for registered dependency resolvers, keyed by
 * `getEcosystem()`. Module-private — not exported.
 */
let resolvers: Map<string, DependencyResolver> = new Map();

/**
 * Registers a dependency resolver. Duplicate ecosystem ids are
 * skipped with a warning so the second `register.ts` import (e.g.
 * during hot-reload in tests) does not throw.
 */
export function registerDependencyResolver(resolver: DependencyResolver): void {
  const ecosystem = resolver.getEcosystem();
  if (resolvers.has(ecosystem)) {
    console.warn(
      `[DependencyResolverRegistry] Resolver for ecosystem '${ecosystem}' is already registered, skipping.`,
    );
    return;
  }
  resolvers.set(ecosystem, resolver);
  console.log(
    `[DependencyResolverRegistry] Registered dependency resolver: ${ecosystem}`,
  );
}

/**
 * Returns the resolver registered for `ecosystem`, or undefined when
 * none matches.
 */
export function getDependencyResolver(
  ecosystem: string,
): DependencyResolver | undefined {
  return resolvers.get(ecosystem);
}

/**
 * Returns the list of registered ecosystem ids in registration order.
 */
export function getRegisteredEcosystems(): string[] {
  return Array.from(resolvers.keys());
}

/**
 * Returns all registered resolvers (registration order).
 */
export function getAllDependencyResolvers(): DependencyResolver[] {
  return Array.from(resolvers.values());
}

/**
 * Clears all registered resolvers. Test-only helper.
 */
export function clearRegistry(): void {
  resolvers = new Map();
}
