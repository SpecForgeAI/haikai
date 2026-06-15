/**
 * Unit tests for the V3 layered prompt utilities:
 *   - services/prompts/composer.ts  (composePrompt across Tier A/B/C)
 *   - services/prompts/injection.ts (pack-output + IR rendering)
 *   - services/prompts/dedup.ts     (normalizeName, dedupKey, dedupLlmCandidates)
 *
 * Spec: V3 Layered Prompt System — Task Group 2 (Task 2.1).
 *
 * The composer reads layer markdown files from disk. Task Group 1 (which
 * authors those files) may not have landed yet when this suite runs, so we
 * stage minimal placeholder content for the layers this spec exercises
 * before the composer tests run, then clean up after. This keeps the tests
 * deterministic regardless of Group 1's delivery state.
 */

import * as fs from 'fs';
import * as path from 'path';

import { composePrompt } from '../services/prompts/composer';
import {
  renderIrInjection,
  renderPackOutputInjection,
  renderInjection,
} from '../services/prompts/injection';
import {
  dedupKey,
  dedupKeyString,
  dedupLlmCandidates,
  normalizeName,
} from '../services/prompts/dedup';

// ----------------------------------------------------------------------------
// Layer-file staging
// ----------------------------------------------------------------------------

const PROMPTS_ROOT = path.join(__dirname, '..', 'services', 'prompts');

/**
 * Files the composer tests reference. Each entry is the layer's relative path
 * and a unique placeholder string — unique so we can assert the placeholder
 * surfaces in the assembled prompt (the "layer marker" check) and so layer
 * hashes differ in the `promptVersion` record.
 */
const LAYER_STUBS: Array<{ rel: string; marker: string }> = [
  { rel: 'base.md', marker: 'MARKER_BASE_LAYER_CONTENT' },
  { rel: 'generic-language.md', marker: 'MARKER_GENERIC_LANGUAGE_LAYER' },
  { rel: 'languages/java.md', marker: 'MARKER_LANGUAGE_JAVA_LAYER' },
  { rel: 'languages/typescript.md', marker: 'MARKER_LANGUAGE_TYPESCRIPT_LAYER' },
  { rel: 'frameworks/spring-classic.md', marker: 'MARKER_FRAMEWORK_SPRING_CLASSIC' },
  { rel: 'frameworks/_no-framework-with-ir.md', marker: 'MARKER_FRAMEWORK_NO_FRAMEWORK_WITH_IR' },
  { rel: 'frameworks/_no-ir.md', marker: 'MARKER_FRAMEWORK_NO_IR' },
];

/**
 * Tracks which layer files WE created so afterAll only deletes ours — if
 * Group 1 has already landed the real content, we leave it untouched.
 */
const createdByUs: string[] = [];

beforeAll(() => {
  for (const layer of LAYER_STUBS) {
    const abs = path.join(PROMPTS_ROOT, layer.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!fs.existsSync(abs)) {
      fs.writeFileSync(abs, layer.marker, 'utf8');
      createdByUs.push(abs);
    }
  }
});

afterAll(() => {
  for (const abs of createdByUs) {
    try {
      fs.unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
});

// ----------------------------------------------------------------------------
// composePrompt — Tier A/B/C
// ----------------------------------------------------------------------------

describe('composePrompt', () => {
  test('Tier A assembles base + language(java) + framework(spring-classic) + pack-output + IR + source', () => {
    const { prompt, promptVersion } = composePrompt({
      tier: 'A',
      language: 'java',
      frameworkPackId: 'spring-classic',
      packOutput: [
        { type: 'service', name: 'PatientService', filePath: 'src/main/java/p/PatientService.java' },
      ],
      ir: { classes: ['Patient'], methods: ['save'], imports: ['org.springframework.*'] },
      sourceFile: {
        filePath: 'src/main/java/p/PatientService.java',
        content: 'public class PatientService {}',
      },
    });

    // Layer markers present (either from real Group 1 files or our stubs).
    expect(prompt).toContain('## Tier: A');
    expect(prompt).toContain('## Base');
    expect(prompt).toContain('## Language Layer');
    expect(prompt).toContain('## Framework Layer');
    expect(prompt).toContain('## Pack Output');
    expect(prompt).toContain('## Intermediate Representation');
    expect(prompt).toContain('## Source File: src/main/java/p/PatientService.java');

    // Dynamic injections landed.
    expect(prompt).toContain('```json');
    expect(prompt).toContain('PatientService');
    expect(prompt).toContain('public class PatientService {}');

    // promptVersion shape: four 8-char hex hashes.
    expect(promptVersion.base).toMatch(/^[0-9a-f]{8}$/);
    expect(promptVersion.language).toMatch(/^[0-9a-f]{8}$/);
    expect(promptVersion.framework).toMatch(/^[0-9a-f]{8}$/);
    expect(promptVersion.composed).toMatch(/^[0-9a-f]{8}$/);
  });

  test('Tier B assembles base + language + _no-framework-with-ir + IR + source (no pack-output section)', () => {
    const { prompt } = composePrompt({
      tier: 'B',
      language: 'java',
      packOutput: undefined,
      ir: { classes: ['Foo'], methods: [], imports: [] },
      sourceFile: { filePath: 'src/Foo.java', content: 'class Foo {}' },
    });

    expect(prompt).toContain('## Tier: B');
    expect(prompt).toContain('## Base');
    expect(prompt).toContain('## Language Layer');
    expect(prompt).toContain('## Framework Layer');
    expect(prompt).toContain('## Intermediate Representation');
    expect(prompt).not.toContain('## Pack Output');
    expect(prompt).toContain('## Source File: src/Foo.java');
    expect(prompt).toContain('class Foo {}');
  });

  test('Tier A with frameworkPackId="angularjs-classic" loads the angularjs-classic framework prompt (regression cover for the missing-prompt bug)', () => {
    // Until the angularjs-classic.md framework prompt was authored
    // (2026-04-25), the composer's `readLayer` silently returned `''`
    // for that pack id, leaving the LLM gap-fill stage with no
    // AngularJS-1.x-specific guidance. The result was the LLM treating
    // every `*Ctrl` symbol as a screen-backing controller and emitting
    // 100+ false `ui_screens` in addition to the route-based ones.
    // This test fails loudly if the file is removed or renamed.
    const { prompt, promptVersion } = composePrompt({
      tier: 'A',
      language: 'javascript',
      frameworkPackId: 'angularjs-classic',
      packOutput: [
        {
          type: 'ui_components',
          name: 'MeasureDetailModalCtrl',
          filePath: 'app/controllers/measureDetail.js',
        },
      ],
      ir: { classes: [], methods: [], imports: [] },
      sourceFile: {
        filePath: 'app/controllers/measureDetail.js',
        content: "angular.module('app').controller('MeasureDetailModalCtrl', function(){});",
      },
    });

    // Distinctive heading from the authored prompt — proves the file
    // was found and read into the framework layer.
    expect(prompt).toContain('AngularJS 1.x (classic) framework guidance');
    // Distinctive HARD RULE language — proves the screen-vs-component
    // constraint actually reaches the LLM.
    expect(prompt).toContain('A controller is `ui_screens` ONLY when an explicit route binds');
    expect(prompt).toContain('You may not change a pack candidate\'s TYPE');
    // promptVersion.framework must be a real (non-empty-content) hash —
    // the empty-string fallback would otherwise hash to a stable placeholder.
    expect(promptVersion.framework).toMatch(/^[0-9a-f]{8}$/);
  });

  test('Tier C assembles base + generic-language (when language unknown) + _no-ir + source; no IR/pack sections', () => {
    const { prompt } = composePrompt({
      tier: 'C',
      language: 'cobol', // unknown — should fall back to generic-language
      sourceFile: { filePath: 'legacy/MAIN.COB', content: 'IDENTIFICATION DIVISION.' },
    });

    expect(prompt).toContain('## Tier: C');
    expect(prompt).toContain('## Base');
    expect(prompt).toContain('## Language Layer');
    expect(prompt).toContain('## Framework Layer');
    expect(prompt).not.toContain('## Pack Output');
    expect(prompt).not.toContain('## Intermediate Representation');
    expect(prompt).toContain('## Source File: legacy/MAIN.COB');
    expect(prompt).toContain('IDENTIFICATION DIVISION.');
  });
});

// ----------------------------------------------------------------------------
// dedup — normalizeName + dedupKey + drop behavior
// ----------------------------------------------------------------------------

describe('normalizeName', () => {
  test('covers case, whitespace, underscores, hyphens — all collapse to single space', () => {
    expect(normalizeName('  PATIENT Controller  ')).toBe('patient controller');
    expect(normalizeName('patient_controller')).toBe('patient controller');
    expect(normalizeName('Patient Controller')).toBe('patient controller');
    expect(normalizeName('patient--controller')).toBe('patient controller');
    expect(normalizeName('patient___---   controller')).toBe('patient controller');
    expect(normalizeName('PatientController')).toBe('patientcontroller');
  });
});

describe('dedupKey', () => {
  test('produces identical keys for patient_controller / Patient Controller variants', () => {
    const a = dedupKeyString({
      type: 'class',
      name: 'patient_controller',
      filePath: 'src/PatientController.java',
    });
    const b = dedupKeyString({
      type: 'class',
      name: 'Patient Controller',
      filePath: 'src/PatientController.java',
    });
    const c = dedupKeyString({
      type: 'class',
      name: 'patient-controller',
      filePath: 'src\\PatientController.java', // backslash should normalize to forward slash
    });
    expect(a).toBe(b);
    expect(a).toBe(c);

    // The structured form also agrees.
    const keyA = dedupKey({ type: 'class', name: 'patient_controller', filePath: 'src/X.java' });
    expect(keyA.normalized).toBe('patient controller');
    expect(keyA.filePath).toBe('src/X.java');
    expect(keyA.type).toBe('class');
  });
});

describe('dedupLlmCandidates', () => {
  test('drops LLM candidates whose key matches a pack candidate; returns surviving + dropped count; logs per drop', () => {
    const pack = [
      { type: 'service', name: 'PatientService', filePath: 'src/PatientService.java' },
      { type: 'class', name: 'Patient Controller', filePath: 'src/PatientController.java' },
    ];
    const llm = [
      // Duplicate of pack[0] — same normalized form, same path.
      { type: 'service', name: 'patientservice', filePath: 'src/PatientService.java' },
      // Duplicate of pack[1] under a different surface form.
      { type: 'class', name: 'patient_controller', filePath: 'src\\PatientController.java' },
      // Genuinely new candidate — should survive.
      { type: 'endpoints', name: 'GET /patients', filePath: 'src/PatientController.java' },
    ];

    const logs: string[] = [];
    const result = dedupLlmCandidates(pack, llm, (m) => logs.push(m));

    expect(result.droppedCount).toBe(2);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].name).toBe('GET /patients');
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatch(/dropping LLM candidate/);
  });

  test('type-swap guard drops LLM candidate when a trusted pack adapter classified the same name+path under a different type', () => {
    // Regression cover for the AngularJS-1.x bug observed 2026-04-25 on
    // the Fire UI scan: orphan controllers (no $routeProvider/$stateProvider
    // binding) emitted by the angularjs-classic-adapter as `ui_components`
    // were being re-emitted by the LLM gap-fill stage as `ui_screens`.
    // Same name, same filePath, different type — slipping past the strict
    // (type, name, filePath) dedup. The guard fires only for trusted
    // classifier adapters so legitimate cross-adapter type corrections
    // elsewhere (e.g. Spring) are unaffected.
    const pack = [
      // Trusted adapter — type swap on this candidate must drop.
      {
        type: 'ui_components',
        name: 'MeasureDetailModalCtrl',
        filePath: 'app/controllers/measureDetail.js',
        addedBy: 'angularjs-classic-adapter',
      },
      // Untrusted adapter — type swap on this candidate must NOT drop
      // (the LLM may legitimately re-classify other adapters' output).
      {
        type: 'business_logics',
        name: 'PatientFormatter',
        filePath: 'src/PatientFormatter.java',
        addedBy: 'spring-classic-adapter',
      },
    ];
    const llm = [
      // Type swap against trusted adapter — drop with type-swap log.
      {
        type: 'ui_screens',
        name: 'MeasureDetailModalCtrl',
        filePath: 'app/controllers/measureDetail.js',
      },
      // Type swap against untrusted adapter — kept; the carve-out is
      // deliberately narrow.
      {
        type: 'interfaces',
        name: 'PatientFormatter',
        filePath: 'src/PatientFormatter.java',
      },
      // Same name+path AND same type as a trusted pack candidate — that's
      // the original (type, name, filePath) dedup, not the type-swap guard.
      {
        type: 'ui_components',
        name: 'MeasureDetailModalCtrl',
        filePath: 'app/controllers/measureDetail.js',
      },
    ];

    const logs: string[] = [];
    const result = dedupLlmCandidates(pack, llm, (m) => logs.push(m));

    // Two drops: the strict-key dedup hit, plus the type-swap guard hit.
    expect(result.droppedCount).toBe(2);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].name).toBe('PatientFormatter');
    expect(result.kept[0].type).toBe('interfaces');
    // Type-swap log should mention the swap explicitly so operators can
    // monitor frequency.
    expect(logs.some((m) => /type-swap guard/.test(m))).toBe(true);
    expect(logs.some((m) => /angularjs-classic-adapter/.test(m))).toBe(true);
  });

  test('type-swap guard does NOT fire when name+path match a pack candidate that lacks an addedBy tag', () => {
    // Backwards compatibility: existing pack candidates produced before
    // the addedBy field was wired through must not be treated as trusted
    // by accident. Without an explicit `addedBy: 'angularjs-classic-adapter'`
    // the guard stays silent.
    const pack = [
      { type: 'ui_components', name: 'XCtrl', filePath: 'a.js' }, // no addedBy
    ];
    const llm = [
      { type: 'ui_screens', name: 'XCtrl', filePath: 'a.js' },
    ];
    const result = dedupLlmCandidates(pack, llm);
    expect(result.droppedCount).toBe(0);
    expect(result.kept).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------
// injection — pack-output + IR rendering
// ----------------------------------------------------------------------------

describe('renderPackOutputInjection', () => {
  test('renders non-empty list as fenced json array; renders empty list as fenced []', () => {
    const rendered = renderPackOutputInjection([
      { type: 'service', name: 'A', filePath: 'a.ts', hint: 'a hint' },
      { type: 'class', name: 'B', filePath: 'b.ts' },
    ]);
    expect(rendered.startsWith('```json\n')).toBe(true);
    expect(rendered.endsWith('\n```')).toBe(true);
    // Compact JSON — no pretty-print whitespace inside.
    expect(rendered).toContain('{"type":"service","name":"A","filePath":"a.ts","hint":"a hint"}');
    expect(rendered).toContain('{"type":"class","name":"B","filePath":"b.ts"}');

    const empty = renderPackOutputInjection([]);
    expect(empty).toBe('```json\n[]\n```');

    // Unified renderer entry point routes identically.
    const viaUnified = renderInjection('packOutput', []);
    expect(viaUnified).toBe('```json\n[]\n```');
  });
});

describe('renderIrInjection', () => {
  test('renders compact JSON when IR is provided; renders {} when missing', () => {
    const rendered = renderIrInjection({
      classes: ['A'],
      methods: ['a'],
      imports: ['x'],
    });
    expect(rendered).toBe('{"classes":["A"],"methods":["a"],"imports":["x"]}');

    expect(renderIrInjection(undefined)).toBe('{}');
    expect(renderIrInjection(null)).toBe('{}');
    expect(renderIrInjection({})).toBe('{}');

    // Unified renderer entry point routes identically.
    expect(renderInjection('ir', undefined)).toBe('{}');
  });
});
