/**
 * Type barrel export for discovery-service types.
 *
 * Dead type files removed as part of Spec 2026-04-07, Task Group 12:
 *   - candidateGenerationRule.ts (CandidateGenerationRule, CandidateProposal)
 *   - clusteringRule.ts (ClusteringRule, CandidateCluster)
 *
 * cluster.ts is deprecated but retained for historical data compatibility.
 */
export {
  AnalyzerFinding,
  AnalyzerInput,
  AnalyzerResult,
  AnalyzerPack,
} from './analyzerPack';

export {
  CandidateType,
  CandidateStatus,
  LogEnrichmentMetadata,
  DiscoveryCandidate,
} from './candidate';

/**
 * @deprecated Cluster types retained for historical data compatibility.
 * No new clusters are produced by the current pipeline.
 */
export {
  ClusterType,
  ClusterMemberType,
  ClusterMember,
  EvidenceCluster,
} from './cluster';

export {
  DecisionTaskType,
  DecisionTaskStatus,
  ConfirmRelationshipInput,
  CompetingTarget,
  ResolveCompetingInput,
  DecisionTaskInput,
  ConfirmRelationshipOutput,
  ResolveCompetingOutput,
  DecisionTaskOutput,
  DecisionTask,
} from './decisionTask';

export {
  EvidenceAtomType,
  FileStructureData,
  SymbolData,
  StringPatternData,
  LlmFileAnalysisEntity,
  LlmFileAnalysisRelationship,
  LlmFileAnalysisData,
  ExtensionPackFinding,
  ExtensionPackAnalysisData,
  EvidenceAtomData,
  LogOrigin,
  QaOrigin,
  EvidenceAtom,
} from './evidenceAtom';

export {
  Hypothesis,
  HypothesisAnswer,
  HypothesisCategory,
  HypothesisStatus,
  HypothesisVerdict,
} from './hypothesis';

export {
  LinkerRule,
  CandidateRelationship,
} from './linkerRule';

export {
  ParsedLogEntry,
} from './logParsing';

export {
  DiscoveryProjectContext,
  DiscoveryRequest,
  DiscoveryConfigPayload,
} from './projectContext';

export {
  RelationshipType,
  ImportsRelationshipData,
  CallsRelationshipData,
  ExtendsRelationshipData,
  ContainsRelationshipData,
  UsesDataRelationshipData,
  DefinesRelationshipData,
  ReferencesRelationshipData,
  RelationshipData,
  EvidenceRelationship,
} from './relationship';
