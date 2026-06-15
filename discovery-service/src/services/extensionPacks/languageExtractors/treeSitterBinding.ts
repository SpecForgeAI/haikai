/**
 * Process-scoped tree-sitter binding cache.
 *
 * node-tree-sitter is NOT safe to `require` more than once per process. Its JS
 * entry point re-initialises a module-level "transfer buffer" that is shared
 * with the single, process-cached native addon. A second `require` rebuilds
 * that buffer and desyncs it from the native side, after which EVERY subsequent
 * parse returns a Tree whose `rootNode` is `undefined` -- surfacing downstream
 * as `TypeError: Cannot read properties of undefined (reading 'type')` in the
 * AST walkers.
 *
 * This bites under Jest, which resets its module registry per test FILE: the
 * 2nd and later parse-heavy suites in a worker would each re-`require` the
 * runtime and corrupt the parser for the rest of that worker's run (every such
 * suite passes in isolation but fails in combination). Caching the runtime and
 * each grammar on `process` -- which survives Jest's per-file module resets --
 * guarantees each native module is evaluated exactly ONCE per worker process.
 * In production (no module-registry resets) this is an ordinary lazy singleton
 * with identical behaviour.
 *
 * Every language parser MUST obtain its `Parser` class and grammar through these
 * helpers rather than calling `require('tree-sitter')` / `require('tree-sitter-*')`
 * at module scope.
 */

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

/**
 * Shape of the worker-singleton binding injected by the custom Jest environment
 * (`jest/treeSitterEnvironment.cjs`). Present only under Jest; `undefined` in
 * production, where modules are never re-evaluated.
 */
interface InjectedTreeSitter {
  Parser: any;
  loadGrammar: (moduleName: string) => any;
}

function injectedBinding(): InjectedTreeSitter | null {
  const g = globalThis as unknown as {
    __HAIKAI_TREE_SITTER__?: InjectedTreeSitter;
  };
  return g.__HAIKAI_TREE_SITTER__ || null;
}

const RUNTIME_KEY = '__haikaiTreeSitterRuntime__';
const GRAMMAR_KEY = '__haikaiTreeSitterGrammars__';

type ProcessBindingCache = Record<string, any>;

/**
 * Returns the `tree-sitter` runtime constructor, evaluating the native module
 * at most once per process.
 *
 * Under Jest, returns the worker-singleton injected by the custom environment
 * (the module is NEVER re-evaluated inside the per-file sandbox, which is what
 * would corrupt the native transfer buffer). In production, requires it once
 * and caches on `process`.
 */
export function loadTreeSitter(): any {
  const injected = injectedBinding();
  if (injected) {
    return injected.Parser;
  }
  const proc = process as unknown as ProcessBindingCache;
  if (!proc[RUNTIME_KEY]) {
    proc[RUNTIME_KEY] = require('tree-sitter');
  }
  return proc[RUNTIME_KEY];
}

/**
 * Returns a tree-sitter grammar, evaluating the native module at most once per
 * process. `cacheKey` identifies the grammar (use the package name); `load` is a
 * thunk that performs the actual `require`, so the module specifier stays a
 * static string literal at each call site and only executes on a cache miss.
 *
 * Under Jest, resolves through the custom environment's worker-singleton loader;
 * in production, requires it once and caches on `process`.
 */
export function loadTreeSitterGrammar(cacheKey: string, load: () => any): any {
  const injected = injectedBinding();
  if (injected) {
    return injected.loadGrammar(cacheKey);
  }
  const proc = process as unknown as ProcessBindingCache;
  const grammars: Record<string, any> =
    proc[GRAMMAR_KEY] || (proc[GRAMMAR_KEY] = {});
  if (!(cacheKey in grammars)) {
    grammars[cacheKey] = load();
  }
  return grammars[cacheKey];
}
