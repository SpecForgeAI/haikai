/**
 * Barrel export for the V3 extension-pack framework.
 *
 * Spec: V3 Discovery Pipeline Foundation (Task Group 2)
 *
 * Exposes the new `LanguagePack` + `FrameworkPack` type contracts and the
 * IR shape they share. Import from this module rather than from the
 * individual files inside `services/extensionPacks/` so downstream
 * consumers (the pipeline orchestrator, the registry, individual packs,
 * and local harness scripts) have a single V3 entry point.
 *
 * The V2 `ExtensionPack` type, alongside the `<framework>PackV2/`
 * directories, was atomically removed in Task Group 11 of the V3 Pack
 * Migration Batch spec. This barrel is the only V3 entry point.
 */

export type {
  LanguagePack,
  LanguagePackPredicate,
  FrameworkPack,
  FrameworkPackPredicate,
  TechHints,
} from './packTypes';

export type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  FieldIR,
  AnnotationIR,
  ParameterIR,
  ImportIR,
  CallIR,
} from './languageIR';
