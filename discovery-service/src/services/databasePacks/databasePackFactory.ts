/**
 * Database discovery pack factory.
 *
 * Spec: 2026-05-16 Database Discovery Packs -- Task Group 2 / 3 / 4.
 *
 * Group 3 wired `'postgres'` to {@link PostgresDiscoveryPack}.
 * Group 4 wires `'sybase'` to {@link SybaseDiscoveryPack} (HTTP client
 * over the JVM sidecar at `SYBASE_SIDECAR_URL`).
 *
 * Unknown engine keys do NOT throw -- they return `null` with a warning log.
 * The orchestrator surfaces a `db_pack_warning` finding when the factory
 * returns `null`, so a misconfigured run does not crash the discovery
 * service.
 */

import type { DatabaseDiscoveryPack } from './DatabaseDiscoveryPack';
import { isDatabaseEngine, DATABASE_ENGINE_CHOICES, type DatabaseEngine } from './types';
import { PostgresDiscoveryPack } from './postgres/PostgresDiscoveryPack';
import { SybaseDiscoveryPack } from './sybase/SybaseDiscoveryPack';

/**
 * Constructor signature each engine pack module exports. v1 packs are
 * stateless WRT factory creation; per-run state lives on the
 * `DatabaseDiscoveryPackContext`.
 */
export type DatabaseDiscoveryPackConstructor = new () => DatabaseDiscoveryPack;

/**
 * Mutable registry. Engine packs register themselves at module-load time
 * via {@link registerDatabasePack}. The registry is keyed by engine string
 * so unknown engines fall through to the `null` return.
 */
const REGISTRY = new Map<DatabaseEngine, DatabaseDiscoveryPackConstructor>();

// Group 3: register the PostgreSQL pack at module-load time.
REGISTRY.set('postgres', PostgresDiscoveryPack);
// Group 4: register the Sybase pack at module-load time.
REGISTRY.set('sybase', SybaseDiscoveryPack);

/**
 * Register a pack constructor for an engine. Called by the pack module at
 * import time (Group 3 / Group 4). Re-registering the same engine replaces
 * the prior entry (useful in tests).
 */
export function registerDatabasePack(
  engineKey: DatabaseEngine,
  ctor: DatabaseDiscoveryPackConstructor,
): void {
  REGISTRY.set(engineKey, ctor);
}

/**
 * Look up an engine pack by key. Returns `null` (with a warning log) when
 * the engine is not registered -- the orchestrator handles this gracefully.
 */
export function getDatabasePack(
  engineKey: string,
): DatabaseDiscoveryPack | null {
  if (!isDatabaseEngine(engineKey)) {
    console.warn(
      `[databasePackFactory] Unknown engine key '${engineKey}'. ` +
        `Expected one of ${DATABASE_ENGINE_CHOICES}.`,
    );
    return null;
  }
  const ctor = REGISTRY.get(engineKey);
  if (!ctor) {
    console.warn(
      `[databasePackFactory] No pack registered for engine '${engineKey}' ` +
        `(registered: ${Array.from(REGISTRY.keys()).join(', ')}).`,
    );
    return null;
  }
  return new ctor();
}

/**
 * TEST-ONLY: clear the registry. Production code never resets the registry.
 */
export function resetDatabasePackRegistryForTests(): void {
  REGISTRY.clear();
}

/**
 * TEST-ONLY: enumerate the engine keys currently registered.
 */
export function listRegisteredEnginesForTests(): DatabaseEngine[] {
  return Array.from(REGISTRY.keys());
}

/**
 * TEST-ONLY: re-register the v1 default packs (postgres + sybase).
 * Use after `resetDatabasePackRegistryForTests` when a test wants the
 * factory back to its post-module-load state.
 */
export function restoreDefaultDatabasePacksForTests(): void {
  REGISTRY.set('postgres', PostgresDiscoveryPack);
  REGISTRY.set('sybase', SybaseDiscoveryPack);
}
