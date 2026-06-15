/**
 * Tech Hints Types
 * Spec 2026-04-20: Tech Hints LLM Resolution
 *
 * Shared TypeScript types for the save-time LLM-assisted resolution of
 * a service's free-text `core_tech` field into structured language/framework
 * packs. Used by the gatewayClient, TechHintsCell, and pendingResolutionsStore.
 */

/**
 * Frontend-wide confidence enum. Extends the LLM's 4-value enum with
 * `'manual-override'` which the UI applies when the user removes a chip,
 * to record that the row's resolved state was edited by hand and should
 * not be re-resolved unless the raw `core_tech` text changes again.
 */
export type TechHintConfidence =
  | 'high'
  | 'low'
  | 'none'
  | 'tech-only'
  | 'manual-override';

/**
 * Subset of confidence values the LLM can emit directly (server-side).
 * `'manual-override'` is never returned by the backend — the frontend sets it.
 */
export type ServerTechHintConfidence = Exclude<TechHintConfidence, 'manual-override'>;

export interface TechHintLanguage {
  name: string;
  version?: string;
}

export interface TechHintFramework {
  name: string;
  version?: string;
}

export interface TechHintRepoCrossCheck {
  status: 'confirmed' | 'conflict' | 'partial';
  note: string;
}

/**
 * Response shape of `POST /api/v1/discovery/tech-hints/resolve`.
 * Passed through from discovery-service unchanged.
 */
export interface TechHintResolution {
  language: TechHintLanguage | null;
  frameworks: TechHintFramework[];
  languagePack: string | null;
  frameworkPacks: string[];
  confirmationSentence: string;
  repoCrossCheck: TechHintRepoCrossCheck | null;
  confidence: ServerTechHintConfidence;
}

/**
 * Request body for the resolve call.
 */
export interface ResolveTechHintsRequest {
  freeText: string;
  repoLocation?: string;
  repoSubfolder?: string;
}
