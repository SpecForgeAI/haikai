# C++ language guidance

## Idioms to recognize

- **RAII (Resource Acquisition Is Initialization).** Construction
  acquires; destruction releases. C++ leans on this for memory,
  file handles, locks, network sockets, every kind of disposable
  resource. Recognising RAII wrappers (`std::unique_ptr`,
  `std::shared_ptr`, `std::lock_guard`, `std::scoped_lock`,
  `std::ifstream`/`std::ofstream`, `wxFile`, every framework's
  custom `Scoped*` / `Auto*` type) is how you find the lifetime
  boundaries that exception-handling and ownership-transfer rely
  on. A class with a non-trivial destructor + deleted copy
  constructor is almost always an RAII guard.
- **Templates + SFINAE.** Templates are compile-time generic
  programming with full Turing-complete type metaprogramming.
  Modern code uses `if constexpr`, `std::enable_if`, concepts
  (C++20), or `requires` clauses to constrain instantiations.
  Tree-sitter sees templates as generic syntactic shapes — the
  actual specialization graph is invisible until link time. A
  function or class declared `template <typename T>` may have
  zero, one, or hundreds of instantiations across a translation
  unit; the compiler picks. Surface template parameters by name
  but do NOT assume any specific specialization is in use unless
  there is an explicit `template <> class Foo<int>` specialization
  visible.
- **Macros (`#define`) as a parallel evaluation tier.** The
  preprocessor runs before the C++ parser ever sees the source.
  Macros can declare classes, generate methods, expand to whole
  function bodies, or rewrite type names. Tree-sitter-cpp does
  NOT expand macros — it sees them as opaque `function_invocation`-
  shaped tokens. Heavy-macro frameworks (Qt's `Q_OBJECT` /
  `signals:` / `slots:`, wxWidgets' event tables
  `BEGIN_EVENT_TABLE` / `EVT_BUTTON`, MFC's
  `DECLARE_DYNCREATE` / `BEGIN_MESSAGE_MAP`, Oatpp's
  `ENDPOINT(...)`, Boost.Test's `BOOST_AUTO_TEST_CASE`) are
  effectively invisible to AST-level analysis. Either fall back
  to raw-source regex (as the Oatpp adapter does for ENDPOINT
  detection) or surface the missed declarations textually. When
  a class body contains macro tokens, every method "declared" by
  those macros is unrecoverable from IR alone.
- **Header / source split.** Declarations live in `.h` / `.hpp`;
  definitions live in `.cpp` / `.cc`. The same logical class is
  spread across two files; method definitions in the .cpp use
  the qualified form `void Foo::bar() {}`. When walking source-
  level analysis output, the IR for a `.cpp` will contain
  function definitions that are members of a class declared
  elsewhere — link them by qualified-name. Inline / template /
  constexpr methods break the rule and live entirely in the
  header. Header-only libraries (Boost.Beast, fmt, range-v3,
  Catch2) put everything in `.h` / `.hpp`.
- **C++ ABI vs C ABI (`extern "C"`).** A function declared
  `extern "C"` uses the C calling convention and C name-mangling
  (i.e. none). Used at every C ABI boundary: shared-library
  exports, plugin systems, OS API wrappers, FFI to other
  languages. A block of `extern "C" { ... }` is a strong signal
  the contained declarations are an integration boundary —
  treat them like Java's JNI surface or C# P/Invoke
  declarations.
- **Pimpl (pointer-to-implementation) idiom.** Public class
  declares a `class Impl;` forward declaration plus a
  `std::unique_ptr<Impl> pImpl;` member; all real state lives
  in the impl class defined in the .cpp. Used to hide private
  members from header consumers and stabilise the binary
  interface. When you see `class Foo { ... private:
  std::unique_ptr<Impl> pImpl; };` in a header, the actual
  state and method implementations are entirely in the
  corresponding .cpp — the IR for the header will show only
  the public surface.
- **Rule of five (or three, or zero).** A class managing a
  resource needs to define five special member functions:
  destructor, copy constructor, copy-assignment operator, move
  constructor, move-assignment operator. Modern code aims for
  the "rule of zero" — let RAII members handle it. The
  presence of all five (or `= delete` for copy + `= default`
  for move) is a strong signal the class owns a non-trivial
  resource. The presence of `= delete` on copy ctor + copy-
  assign typically means "non-copyable resource holder" —
  e.g. file handle, socket, mutex, GUI window, database
  connection.
- **Multiple inheritance + virtual inheritance.** C++ permits
  inheriting from multiple base classes simultaneously, with
  the diamond-problem solved by `virtual` inheritance:
  `class Derived : public virtual Base { ... }`. Mix-in style
  is common in framework code (UI: `wxFrame` + `wxClientData`;
  Qt: many internal multi-base hierarchies). Tree-sitter-cpp
  captures the base-class clause but the IR shape stores only
  the "main" extends as a single string — `implements` is
  used loosely to capture additional bases. Inspect every
  `class X : public A, public B, ...` declaration carefully.
- **`virtual` / `override` / `final` method modifiers.**
  `virtual` opts a method into the v-table (runtime dispatch);
  `override` (C++11) asserts at compile time that the method
  overrides a base; `final` prevents further overriding. A
  pure virtual method (`virtual void foo() = 0;`) makes the
  class abstract. Recognising the pure-virtual + protected-
  destructor pattern marks an interface base class — treat
  it like a Java interface even though C++ has no dedicated
  `interface` keyword. Look for "I-prefix" or "Abstract"-
  prefix conventions when surfacing `interfaces` candidates.
- **Namespaces.** `namespace foo::bar {}` (C++17 nested
  namespace shorthand) groups declarations. `using
  namespace foo;` imports them into the current scope — most
  style guides ban `using namespace std;` in headers because
  it pollutes every consumer. Anonymous namespaces (`namespace
  {}`) provide internal linkage, equivalent to file-static.
  Surface qualified names with their namespace; the IR's
  `packageOrNamespace` field captures the file-level
  `namespace ... { }` wrapper.
- **`constexpr` / `consteval` / `constinit`.** Compile-time
  evaluation. A `constexpr` function is evaluable at compile
  time; `consteval` (C++20) requires it; `constinit` (C++20)
  forces compile-time initialisation. Heavily used in modern
  C++ for type traits, template metaprogramming, and zero-
  cost abstraction. Surface as regular functions but flag the
  modifier when present — they are guaranteed to have no
  runtime side effects in their compile-time use sites.
- **`auto` and type inference.** `auto x = expr;` infers `x`'s
  type from the RHS. Trailing return types `auto foo() ->
  ReturnType` invert the declaration order. `decltype(expr)`
  yields the expression's static type. Heavy use of `auto`
  in modern code makes static-analysis-by-source-text harder —
  the actual type may be invisible without compiler-level
  inference.

## Tree-sitter extraction nuances

- **The parser bails on macro bodies.** Tree-sitter-cpp's
  grammar covers C++17 (with partial C++20 support) but does
  NOT expand macros. When a macro body contains commas,
  parentheses, or nested macros (e.g. Oatpp's
  `ENDPOINT("GET", "/users/{id}", getUser, PATH(Int32, id))`,
  Qt's `Q_PROPERTY(int x READ getX WRITE setX)`), the parser
  often emits an `ERROR` node for the surrounding
  `class_specifier` and the entire class becomes invisible to
  IR-based detection. The `cpp-lang` pack works around this
  by:
    - Returning `null` from `extractCppIR` for files where the
      parse tree has no detectable classes.
    - Exposing a side-channel raw-source cache
      (`cppLangPack.getCppRawSources()`) so framework packs
      that need to fall back to regex (currently only the
      Oatpp pack) can do so without re-reading from disk.
- **`class_specifier` vs `struct_specifier`.** C++ treats
  `class` and `struct` almost identically — only the default
  member access differs (`private` for class, `public` for
  struct). Tree-sitter emits two separate node types. The IR
  extractor walks BOTH and merges them into the `classes`
  array, deduplicating by name (anonymous structs are skipped
  to avoid `(unnamed)` noise).
- **Base-class-clause walking.** A base specifier can be a
  bare `type_identifier` or a `qualified_identifier`
  (`namespace::Base`). The IR extractor takes the LAST
  `type_identifier` in the qualified chain so the recorded
  base name is `Base` rather than `namespace::Base`.
  Framework adapters that match against base-name regex
  (`SCREEN_BASE_RE`, `COMPONENT_BASE_RE`) therefore see the
  unqualified form.
- **Field declaration vs method declaration.** A
  `field_declaration` node in tree-sitter-cpp covers BOTH
  member variables AND method declarations (without bodies).
  Distinguish via the declarator: `function_declarator` →
  method declaration; `field_identifier` / `identifier` →
  member field. Method definitions WITH bodies are
  `function_definition` nodes inside the class body.
- **Top-level function definitions.** Functions declared at
  file scope (not inside a class) are extracted into the IR's
  `functions` array. Method definitions defined out-of-line
  with the qualified `void Foo::bar()` form ARE
  `function_definition` nodes at file scope — the extractor
  walks up the parent chain to detect whether the function is
  inside a class body, and skips it if so (the in-class walk
  already captured it).

## What to surface vs what the pack already catches

- The C++ language pack (`cpp-lang`) emits a `SourceFileIR` per
  parseable file. Framework packs consume the IR; the pack
  itself does not emit candidates. When a file fails to parse
  (e.g. heavy-macro Oatpp ENDPOINT-laden file), the IR is
  omitted and the framework adapter falls back to whatever its
  framework-specific raw-source detection supports.
- **Surface what tree-sitter cannot see** — anything inside a
  macro body, `Q_PROPERTY` declarations, MFC message maps,
  custom DECLARE/DEFINE pattern macros, header-only template
  bodies that span hundreds of `enable_if` paths.
- **Surface header / source linkage** when the framework adapter
  emits candidates from the .cpp but the public interface lives
  in the .h. The .h-only declarations reach the IR but methods
  have no body; combining the IR for both files reveals the full
  class shape.

## File-skip rules

- The cpp file filter accepts `.cpp` / `.cc` / `.cxx` / `.c++` /
  `.h` / `.hpp` / `.hh` / `.hxx` and rejects everything else.
  Test files are NOT auto-skipped because the V2 packs counted
  test-file class definitions in their candidate baselines and
  the per-pack 98% gate is calibrated against those numbers.
  The `isCppTestFile` helper is exported for callers that want
  to post-filter, but `cppLangPack.extract` does not invoke it.
- Generated files (`*.pb.h` from protobuf, `moc_*.cpp` from
  Qt's MOC, `ui_*.h` from Qt Designer) are NOT detected by
  filename heuristics — they are just regular C++ files to the
  filter. Surfacing them is fine; framework adapters typically
  produce noise candidates for these but the noise is benign.
