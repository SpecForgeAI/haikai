# Specification: Compiled Code Analysis (Future)

## Summary

Extend structural analysis to compiled/bundled artifacts — extracting symbols, call graphs, imports, and dependency information from bytecode, object files, and bundled outputs rather than (or in addition to) source code.

**Status:** Placeholder spec. Not yet designed in detail.

---

## Problem

Source code isn't always available or representative of what actually runs:

- **Java/Kotlin** → `.class` files, `.jar` archives (bytecode may include obfuscated or generated code not in source)
- **C/C++/Rust** → `.o` object files, `.so`/`.dll` shared libraries, ELF binaries (symbols, linking info)
- **C#/.NET** → `.dll` assemblies, IL bytecode (may be the only artifact available for third-party libs)
- **JavaScript/TypeScript** → Webpack/Vite/esbuild bundles, minified output, source maps
- **Python** → `.pyc` bytecode, compiled wheels (`.whl`) with C extensions
- **Go** → statically linked binaries (limited, but `go tool nm` extracts symbols)

Analyzing compiled output gives visibility into:
1. Third-party dependencies where only binaries are available
2. Build-time code generation (protobuf, gRPC stubs, annotation processors)
3. Actual linking/bundling behavior vs declared dependencies
4. Minified/bundled JS where source structure is lost

---

## Scope by Language

| Language | Artifact | Tool/Approach | What We Get |
|----------|----------|--------------|-------------|
| Java/Kotlin | `.class`, `.jar` | `javap -c`, ASM library, or `cfr` decompiler | Classes, methods, field refs, invocations, inheritance |
| C#/.NET | `.dll`, `.exe` | `ildasm`, `dnSpy`, `System.Reflection.Metadata` | Types, methods, IL call sites, assembly refs |
| C/C++ | `.o`, `.so`, `.a` | `nm`, `objdump`, `readelf`, `llvm-objdump` | Symbol tables, relocations, dynamic linking |
| Rust | `.rlib`, ELF | `nm`, `rustfilt` (demangling) | Mangled symbols → demangled function names |
| JavaScript | Webpack/Vite bundles | Source maps + AST, or `webpack-bundle-analyzer` | Module graph, chunk composition, import chains |
| Python | `.pyc`, `.whl` | `dis` module, `uncompyle6` | Bytecode ops, function calls, imports |
| Go | ELF binary | `go tool nm`, `go tool objdump` | Symbol names, package refs |

---

## Design Considerations

1. **Complement, not replace** — compiled analysis augments source analysis, doesn't replace it
2. **Provider pattern** — new `CompiledProvider` alongside `CtagsProvider` and `TreeSitterProvider`
3. **Same output model** — produce `StructuralAnalysis` objects, same as source providers
4. **Artifact discovery** — need to locate compiled output (build dirs, dist/, target/, node_modules/.cache)
5. **Source map correlation** — for JS bundles, map bundled code back to source files
6. **Demangling** — C++/Rust symbols are mangled; need language-specific demangling

---

## Open Questions

- Priority order: which artifact types are most valuable first?
- Should this run as part of the main pipeline or as a separate analysis mode?
- How to handle obfuscated code (ProGuard, minification)?
- Source map support: parse `.map` files to correlate bundle → source?
- Binary analysis depth: just symbol tables, or full disassembly?

---

## Out of Scope (for initial version)

- Full decompilation/reverse engineering
- Malware analysis
- Binary diffing across versions
- Runtime analysis (profiling, tracing)
- Container image analysis (though interesting — layers, installed packages)
