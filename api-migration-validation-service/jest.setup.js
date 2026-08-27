/**
 * Global test env defaults (2026-08-27). S0_SNAPSHOT_DIR must NEVER default
 * to the real service tree during tests — the pre-rec write-surface snapshot
 * (Item #7) runs inside orchestrator/replay harnesses and would otherwise
 * write dump files into the repo. Suites that need their OWN dir (the s0
 * tests) still override BEFORE requiring the config-dependent modules; this
 * default only covers suites that never think about snapshots.
 */
const os = require('os');
const path = require('path');

if (!process.env.S0_SNAPSHOT_DIR) {
  process.env.S0_SNAPSHOT_DIR = path.join(
    os.tmpdir(),
    `haikai-amvs-tests-s0-${process.pid}`,
  );
}
