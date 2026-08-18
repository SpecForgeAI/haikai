/**
 * Canonical row serialization shared by the S0 snapshot writer and the
 * fingerprint recompute (Capture-State Discipline Spec 2). One JSON line per
 * row with SORTED keys — the same adapter renders values identically on both
 * passes, so byte-equal lines <=> value-equal rows, and the sha256 over the
 * line stream is a stable table fingerprint.
 */

import * as crypto from 'crypto';

export function canonicalRowJson(row: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(row).sort()) {
    sorted[key] = row[key] === undefined ? null : row[key];
  }
  return JSON.stringify(sorted);
}

export interface StreamHasher {
  addLine(line: string): void;
  digest(): string;
}

export function createStreamHasher(): StreamHasher {
  const hash = crypto.createHash('sha256');
  return {
    addLine(line: string) {
      hash.update(line);
      hash.update('\n');
    },
    digest() {
      return hash.digest('hex');
    },
  };
}
