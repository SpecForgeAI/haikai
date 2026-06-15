/**
 * Kotlin Language Extractor — STUB.
 *
 * Blocked: tree-sitter-kotlin requires Visual Studio C++ build tools to
 * compile its native binding on Windows, and no prebuilt binaries are
 * published for our target Node version. Left as a stub so the pack
 * registry compiles; production use requires:
 *
 *   1. Install Visual Studio 2022 Build Tools (or full VS) on the host, OR
 *   2. Switch to a different Kotlin parser (e.g. an in-process JVM
 *      invocation of the Kotlin compiler's PSI API), OR
 *   3. Use a prebuilt tree-sitter-kotlin binary.
 *
 * Until one of those is done, `extractKotlinIR` returns null for every file
 * and the android-jetpack pack will emit zero candidates.
 */
import type { SourceFileIR } from '../../languageIR';

export function extractKotlinIR(_filePath: string, _sourceCode: string): SourceFileIR | null {
  return null;
}
