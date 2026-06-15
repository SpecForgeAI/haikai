/**
 * csharp-netfx language extractor — reuses csharp-modern.
 * .NET Framework C# syntax is a subset of modern C# for our extraction purposes.
 */
import { extractCSharpIR } from '../csharp';
import type { SourceFileIR } from '../../languageIR';

export function extractCSharpNetFxIR(filePath: string, source: string): SourceFileIR | null {
  const ir = extractCSharpIR(filePath, source);
  if (!ir) return null;
  return { ...ir, language: 'csharp-netfx' };
}
