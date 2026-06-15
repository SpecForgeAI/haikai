/**
 * Custom Jest test environment: tree-sitter loaded ONCE per worker process.
 *
 * node-tree-sitter is NOT safe to evaluate more than once per process. Its JS
 * entry point registers a module-level "transfer buffer" with the single,
 * process-cached native addon; the addon latches the FIRST buffer and ignores
 * every later registration. So once the module is evaluated a second time, the
 * new JS buffer is desynced from the native side and EVERY subsequent parse
 * returns a Tree whose `rootNode` is `undefined` -- surfacing as
 * `TypeError: Cannot read properties of undefined (reading 'type')` in the AST
 * walkers.
 *
 * Jest resets its module registry per test FILE, so the default `node`
 * environment re-evaluates `tree-sitter` for every parse-heavy suite in a
 * worker and corrupts the 2nd-and-later suites: each passes in isolation but
 * fails in combination (and worse under `--runInBand`, where one worker runs
 * them all). Neither `process` nor `globalThis` custom properties survive
 * Jest's per-file sandbox teardown, so an in-test cache cannot fix this.
 *
 * This module, however, is required by jest-runner in the worker's REAL module
 * context -- NOT the per-file sandbox -- so its top-level `require('tree-sitter')`
 * runs exactly once per worker and the buffer registration sticks for the
 * worker's lifetime. `setup()` (per file) only copies the already-initialised
 * references onto that file's sandbox global as `__HAIKAI_TREE_SITTER__`.
 *
 * `src/services/extensionPacks/languageExtractors/treeSitterBinding.ts` reads
 * that injected global when present (the test path) and otherwise requires the
 * binding directly (the production path, where modules are never re-evaluated).
 */
const { TestEnvironment: NodeEnvironment } = require('jest-environment-node');

// Evaluated ONCE per worker process (real require cache -- survives Jest's
// per-file module-registry resets). The native transfer buffer is registered
// here, a single time, and remains valid for every test file the worker runs.
const Parser = require('tree-sitter');

// Grammars are larger and language-specific; load each lazily the first time a
// suite needs it, cached for the rest of the worker's life.
const grammarCache = Object.create(null);
function loadGrammar(moduleName) {
  if (!grammarCache[moduleName]) {
    grammarCache[moduleName] = require(moduleName);
  }
  return grammarCache[moduleName];
}

class TreeSitterEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();
    // Hand the per-file sandbox the worker-singleton runtime + grammar loader.
    this.global.__HAIKAI_TREE_SITTER__ = { Parser, loadGrammar };
  }
}

module.exports = TreeSitterEnvironment;
module.exports.default = TreeSitterEnvironment;
module.exports.TestEnvironment = TreeSitterEnvironment;
