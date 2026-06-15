/**
 * Evidence Atom Types (Layer 1a)
 *
 * Defines the core evidence atom interface and type-specific data shapes
 * produced by Phase 1a universal extraction.
 *
 * Data flow position: **1a atoms** -> 1b relationships -> LLM file analysis -> candidates
 *
 * Each evidence atom represents a single piece of language-agnostic evidence
 * extracted from a repository: file structure metadata, a ctags symbol,
 * a regex string/pattern match, an LLM file-level analysis result, or
 * an extension pack analysis result.
 */

import type { CandidateType } from './candidate';

/**
 * The types of evidence atoms produced by extraction and analysis steps.
 *
 * This union is extensible -- future increments may add new atom types
 * (e.g., dependency manifest entries, configuration file entries) as
 * the extraction pipeline evolves. New types will be added as additional
 * union members without breaking existing consumers.
 *
 * - `file_structure`: File metadata from the file structure sub-extractor
 * - `symbol`: Symbol data from the ctags symbol sub-extractor
 * - `string_pattern`: Pattern match from the string/pattern sub-extractor
 * - `llm_file_analysis`: LLM-driven file-level architectural analysis result
 * - `extension_pack_analysis`: Deterministic analysis result from an extension pack
 */
export type EvidenceAtomType = 'file_structure' | 'symbol' | 'string_pattern' | 'llm_file_analysis' | 'extension_pack_analysis';

/**
 * Data payload for a file_structure evidence atom.
 * Produced by the file structure sub-extractor.
 */
export interface FileStructureData {
  relativePath: string;
  extension: string;
  sizeBytes: number;
  lineCount: number;
}

/**
 * Data payload for a symbol evidence atom.
 * Produced by the ctags symbol sub-extractor.
 */
export interface SymbolData {
  name: string;
  kind: string;
  line: number;
  scope: string | null;
  language: string;
}

/**
 * Data payload for a string_pattern evidence atom.
 * Produced by the string/pattern sub-extractor.
 */
export interface StringPatternData {
  patternName: string;
  matchedText: string;
  line: number;
  contextSnippet: string;
}

/**
 * Entity extracted by LLM file-level analysis.
 */
export interface LlmFileAnalysisEntity {
  entityType: CandidateType;
  name: string;
  confidence: number;
  filePath: string;
  lineRange?: [number, number];
  parentEntityName?: string;
  metadata: Record<string, unknown>;
}

/**
 * Relationship between entities identified by LLM file-level analysis.
 */
export interface LlmFileAnalysisRelationship {
  sourceEntityName: string;
  targetEntityName: string;
  relationshipType: string;
  detail?: string;
}

/**
 * Data payload for an llm_file_analysis evidence atom.
 *
 * Persists the intermediate result of LLM-driven file-level architectural
 * analysis. Each atom represents the analysis of a single source file,
 * including the entities and relationships identified by the LLM, the
 * raw LLM response for auditability, and the analysis timestamp.
 */
export interface LlmFileAnalysisData {
  filePath: string;
  entities: LlmFileAnalysisEntity[];
  relationships: LlmFileAnalysisRelationship[];
  rawLlmResponse: string;
  analyzedAt: string;
}

/**
 * Individual finding within an extension pack analysis atom.
 *
 * Each finding represents a single deterministic observation (annotation,
 * declaration, pattern) detected by an extension pack's parser.
 */
export interface ExtensionPackFinding {
  /** Type of finding (e.g., 'jpa_entity', 'spring_controller', 'endpoint', 'field_column') */
  findingType: string;
  /** Name of the entity/class/method this finding relates to */
  entityName: string;
  /** Annotation or pattern type that was detected (e.g., '@Entity', '@RestController') */
  annotationType: string;
  /** Additional metadata specific to the finding type */
  metadata: Record<string, unknown>;
  /** Line number in the source file where the finding was detected */
  lineNumber: number;
}

/**
 * Data payload for an extension_pack_analysis evidence atom.
 *
 * Produced by Extension Pack deterministic analysis passes (e.g.,
 * Java/Spring Boot annotation parsing via tree-sitter). Each atom
 * represents the analysis of a single source file by a specific pack,
 * containing all findings from that file.
 *
 * Spec: Java/Spring Boot Extension Pack
 * - FR17: New Evidence Atom Type for Pack Findings
 */
export interface ExtensionPackAnalysisData {
  /** Extension pack ID that produced this atom (e.g., 'java-spring-boot') */
  packId: string;
  /** Path of the source file analyzed */
  filePath: string;
  /** Array of findings detected in the file */
  findings: ExtensionPackFinding[];
  /** ISO timestamp of when the analysis was performed */
  analysisTimestamp: string;
}

/**
 * Union of all type-specific evidence atom data payloads.
 */
export type EvidenceAtomData = FileStructureData | SymbolData | StringPatternData | LlmFileAnalysisData | ExtensionPackAnalysisData;

/**
 * Log origin metadata for log-derived evidence atoms.
 *
 * Tracks the source log file, the line range where the evidence was found,
 * an optional timestamp from the log entry, and an occurrence count
 * when multiple log lines contribute to the same aggregated atom.
 */
export interface LogOrigin {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  timestamp?: string;
  occurrenceCount?: number;
}

/**
 * Q&A origin metadata for human_qa-derived evidence atoms.
 *
 * Tracks the hypothesis that was answered, the user's verdict,
 * optional free-text notes providing additional context, and
 * the timestamp when the answer was provided.
 */
export interface QaOrigin {
  hypothesisId: string;
  verdict: string;
  freeTextNotes?: string;
  answeredAt: string;
}

/**
 * Core evidence atom interface.
 *
 * Each atom is traceable to a specific run, repository, file, and extraction type.
 * The `id` is a deterministic hash ensuring idempotency.
 *
 * The optional `source` field distinguishes code-derived atoms from log-derived
 * and human_qa-derived atoms. Existing atoms without the field are treated as
 * code-sourced (backward compatible). The optional `logOrigin` and `qaOrigin`
 * fields provide traceability metadata for their respective source types.
 */
export interface EvidenceAtom {
  id: string;
  runId: string;
  repoUrl: string;
  filePath: string;
  type: EvidenceAtomType;
  data: EvidenceAtomData;
  extractedAt: string;

  /**
   * Source of the evidence atom.
   * - 'code': Extracted from source code analysis (default when absent)
   * - 'log': Extracted from application log files
   * - 'human_qa': Created from user answers during hypothesis Q&A validation
   *
   * Existing atoms without this field are treated as code-sourced.
   */
  source?: 'code' | 'log' | 'human_qa';

  /**
   * Log origin metadata, present only for log-derived atoms (source: 'log').
   * Provides traceability back to the original log file and line range.
   */
  logOrigin?: LogOrigin;

  /**
   * Q&A origin metadata, present only for human_qa-derived atoms (source: 'human_qa').
   * Provides traceability back to the hypothesis and user verdict.
   */
  qaOrigin?: QaOrigin;
}
