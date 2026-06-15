# Language Pack Inventory (Planning)

Source: `C:\Users\gazwa\OneDrive\Documents\SDD_App\discovery_packs.xlsx` sheet "Language Packs". This is the **planning
inventory** — the language packs the project intends to support, sized
by estimated share of real-world codebase coverage.

> **Important:** the `Language Pack Name` column here uses *aspirational*
> names (e.g. `java-modern`, `python-3`, `javascript-modern`). The
> **canonical registered pack IDs** in the discovery service codebase
> are simpler — `java-lang`, `python-lang`, `javascript-lang`, etc.
> When wiring services for runs, use the canonical IDs from
> [`test-repos-projects.md`](./test-repos-projects.md) and the
> registered packs in
> `discovery-service/src/services/extensionPacks/languagePacks/`.
> The `Estimated %` figures in this sheet are still useful as rough
> coverage targets, even though several entries are not yet implemented.

| Language | Versions | Language Pack Name | Estimated % |
|---|---|---|---|
| Java | 5+ (incl. 8, 11, 17, 21) | java-modern | 12 |
| Python | 3.x | python-3 | 10 |
| JavaScript | ES6 / ES2015+ | javascript-modern | 9.5 |
| C | C89 / C99 | c-classic | 6 |
| TypeScript | all (1.x–5.x) | typescript | 4 |
| C# | 6+ (.NET Core / 5+) | csharp-modern | 4 |
| PHP | 7+ / 8+ | php-modern | 4 |
| JavaScript | ES5 and earlier | javascript-es5 | 3 |
| C++ | C++98 / C++03 | cpp-legacy | 3 |
| C++ | C++11 / 14 / 17 | cpp-modern | 3 |
| C# | 1–5 (.NET Framework era) | csharp-netfx | 3 |
| COBOL | 74 / 85 / 2002 / 2014 | cobol | 2.5 |
| C | C11 / C17 / C23 | c-modern | 2 |
| PHP | 4 / 5 | php-legacy | 2 |
| Ruby | 1.9 / 2.x / 3.x | ruby-modern | 2 |
| Go | all (1.0+) | go | 2 |
| ANSI SQL / PostgreSQL / MySQL | standard | sql-standard | 2 |
| Shell (Bash / POSIX / Zsh) | all | shell-bash | 2 |
| Java | 1.0–1.4 | java-legacy | 1.5 |
| Kotlin | all | kotlin | 1.5 |
| Objective-C | all | objective-c | 1.5 |
| Perl | 5.x | perl | 1.5 |
| Visual Basic | 6 / VBA / Classic | vb-classic | 1.5 |
| ABAP (SAP) | all (incl. ABAP OO) | abap | 1.5 |
| Swift | 4+ | swift-modern | 1.2 |
| Other / long tail |  |  | 1.2 |
| Python | 2.x | python-2 | 1 |
| C++ | C++20 / C++23 | cpp-contemporary | 1 |
| PL/SQL (Oracle) | all | sql-plsql | 1 |
| T-SQL (SQL Server) | all | sql-tsql | 1 |
| Delphi / Object Pascal | all | delphi-pascal | 0.8 |
| Rust | all (editions 2015/18/21) | rust | 0.7 |
| Visual Basic | VB.NET | vb-net | 0.7 |
| PowerShell | all | powershell | 0.7 |
| Ruby | 1.8 | ruby-legacy | 0.5 |
| Scala | 2.x | scala-2 | 0.5 |
| Fortran | 77 / 90 / 2003+ | fortran | 0.5 |
| RPG (IBM i) | RPG III / IV / free-form | rpg | 0.5 |
| R | all | r | 0.5 |
| Dart | all (Flutter 2+) | dart | 0.5 |
| Lua | all | lua | 0.4 |
| Swift | 1–3 | swift-legacy | 0.3 |
| Groovy | all | groovy | 0.3 |
| MATLAB | all | matlab | 0.3 |
| HCL (Terraform) | all | hcl-terraform | 0.3 |
| Elixir | all | elixir | 0.2 |
| Erlang | all | erlang | 0.2 |
| Scala | 3 (Dotty) | scala-3 | 0.1 |
| Clojure | all | clojure | 0.1 |
| F# | all | fsharp | 0.1 |
| Haskell | all | haskell | 0.1 |
| Solidity | all (0.5+) | solidity | 0.1 |
| Ada | 83 / 95 / 2012 | ada | 0.1 |
| Julia | all | julia | 0.1 |
