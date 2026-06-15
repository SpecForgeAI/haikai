/**
 * Tests for the auto-infer-language-pack-from-framework-pack logic added to
 * `validateResolution` on 2026-04-28.
 *
 * Background: when the LLM is given text-only input (e.g. "AngularJS 1.4")
 * it would return `{ languagePack: null, frameworkPacks: ["angularjs-classic"] }`
 * because it interpreted the user too literally. The runtime then ran
 * tier-B (no language pack) and the language extractor never engaged.
 * Every framework pack declares its language requirement in `when.language`,
 * so the inference is deterministic — no LLM judgment needed.
 */
import { validateResolution } from '../services/techHintsResolver';
import type { RegisteredPackMetadata } from '../services/extensionPackRegistry';

const REGISTRY: RegisteredPackMetadata[] = [
  { id: 'java-lang', kind: 'language', when: { language: 'Java' } },
  { id: 'javascript-lang', kind: 'language', when: { language: 'JavaScript' } },
  { id: 'typescript-lang', kind: 'language', when: { language: 'TypeScript' } },
  { id: 'python-lang', kind: 'language', when: { language: 'Python' } },
  { id: 'java-spring-boot', kind: 'framework', when: { language: 'Java', technology: 'Spring Boot' } },
  { id: 'spring-classic', kind: 'framework', when: { language: 'Java', technology: 'Spring' } },
  { id: 'angularjs-classic', kind: 'framework', when: { language: 'JavaScript', technology: 'AngularJS' } },
  { id: 'react-typescript', kind: 'framework', when: { language: 'TypeScript', technology: 'React' } },
  { id: 'flask', kind: 'framework', when: { language: 'Python', technology: 'Flask' } },
];

function baseRaw(over: Record<string, unknown> = {}) {
  return {
    language: null,
    frameworks: [],
    languagePack: null,
    frameworkPacks: [],
    confirmationSentence: 'Detected.',
    repoCrossCheck: null,
    confidence: 'tech-only',
    ...over,
  };
}

describe('validateResolution — auto-infer languagePack from frameworkPacks', () => {
  it('infers languagePack=javascript-lang from frameworkPacks=[angularjs-classic]', () => {
    const out = validateResolution(
      baseRaw({ frameworkPacks: ['angularjs-classic'] }),
      REGISTRY,
    );
    expect(out).not.toBeNull();
    expect(out!.languagePack).toBe('javascript-lang');
    // Backfills the human-readable language field too so the runtime free-text
    // fallback (techHintsFromResolvedColumns) sees a non-null name.
    expect(out!.language).toEqual({ name: 'JavaScript' });
  });

  it('infers languagePack=java-lang from frameworkPacks=[spring-classic]', () => {
    const out = validateResolution(
      baseRaw({ frameworkPacks: ['spring-classic'] }),
      REGISTRY,
    );
    expect(out!.languagePack).toBe('java-lang');
    expect(out!.language).toEqual({ name: 'Java' });
  });

  it('handles two framework packs implying the same language (still infers)', () => {
    const out = validateResolution(
      baseRaw({ frameworkPacks: ['spring-classic', 'java-spring-boot'] }),
      REGISTRY,
    );
    expect(out!.languagePack).toBe('java-lang');
  });

  it('does NOT infer when framework packs imply different languages (mixed stack)', () => {
    const out = validateResolution(
      baseRaw({ frameworkPacks: ['java-spring-boot', 'react-typescript'] }),
      REGISTRY,
    );
    // Mixed Java + TypeScript → leave null for human review.
    expect(out!.languagePack).toBeNull();
    expect(out!.language).toBeNull();
  });

  it('does NOT overwrite an explicit languagePack even when framework implies a different one', () => {
    const out = validateResolution(
      baseRaw({ languagePack: 'java-lang', frameworkPacks: ['flask'] }),
      REGISTRY,
    );
    // The user/LLM explicitly said java-lang; trust it. (Conflict surfaces
    // elsewhere — likely as a low score / Determinism dock — but the
    // resolver doesn't overwrite explicit values.)
    expect(out!.languagePack).toBe('java-lang');
  });

  it('does NOT overwrite an explicit human-readable language even when inferring the pack', () => {
    const out = validateResolution(
      baseRaw({
        language: { name: 'JavaScript', version: '1.4' },
        frameworkPacks: ['angularjs-classic'],
      }),
      REGISTRY,
    );
    expect(out!.languagePack).toBe('javascript-lang');
    // Version preserved from the explicit input.
    expect(out!.language).toEqual({ name: 'JavaScript', version: '1.4' });
  });

  it('leaves languagePack=null when frameworkPacks=[] (no inference signal)', () => {
    const out = validateResolution(baseRaw({}), REGISTRY);
    expect(out!.languagePack).toBeNull();
  });
});
