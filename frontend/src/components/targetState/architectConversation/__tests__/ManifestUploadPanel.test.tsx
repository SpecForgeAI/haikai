/**
 * Tests — ManifestUploadPanel (target dependency-manifest upload UI)
 * Spec 2026-06-24-target-dependency-manifest-auto-answer (Spec 3), Task Group 5
 * (task 5.1). Focused tests (2-8 max) covering ONLY:
 *
 *   (a) selecting a pom.xml / package.json (+ optional package-lock.json) REQUIRES
 *       a target module/service tag before submit (submit disabled until tagged);
 *   (b) the uploaded-manifests list renders each manifest with its tag + parse
 *       status, and a server-reported DROPPED file is surfaced (not hidden);
 *   (c) an auto-answered decision renders its SOURCE PROVENANCE (manifest file +
 *       chip) and is EDITABLE inline — a manual edit writes through the capture
 *       seam and flips provenance to "manually entered";
 *   (d) a version-unknown answer renders a clear affordance and accepts a
 *       manually-supplied exact version.
 *
 * The upload + capture API calls are injected (no network). Mirrors the
 * fetch/dep-injection style of the sibling architectConversation tests.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

import {
  ManifestUploadPanel,
  type ManifestUploadPanelDeps,
} from '../ManifestUploadPanel';
import type { TargetManifestUploadResponse } from '../../../../api/targetManifestApi';

afterEach(() => cleanup());

const PROJECT = 'proj-1';
const ARCH = 'arch-9';

function pomFile(name = 'pom.xml'): File {
  return new File(['<project/>'], name, { type: 'text/xml' });
}
function pkgFile(name = 'package.json'): File {
  return new File(['{}'], name, { type: 'application/json' });
}

// The draft target architecture's services (the picker option list). The first
// option carries a `repoSubfolder` of 'orders-service', so the derived tag is
// exactly 'orders-service' (FR5) — matching the prior free-text tag value.
const SERVICES = [
  { id: 'svc-orders', name: 'Orders Service', repoSubfolder: 'orders-service' },
  { id: 'svc-web', name: 'Web BFF', repoSubfolder: 'web-bff' },
];

/** Choose the Orders service in the picker for the manifest at `index`. */
function pickOrdersService(index = 0): void {
  fireEvent.change(screen.getByTestId(`manifest-service-select-${index}`), {
    target: { value: 'svc-orders' },
  });
}

function makeResponse(
  overrides: Partial<TargetManifestUploadResponse> = {},
): TargetManifestUploadResponse {
  return {
    parsedManifests: [
      {
        status: 'parsed',
        ecosystem: 'MAVEN',
        kind: 'pom.xml',
        tag: 'orders-service',
        manifestPath: 'services/orders/pom.xml',
        declaredDependencies: [
          {
            name: 'org.springframework.boot:spring-boot-starter-web',
            version: '3.4.1',
            scope: 'compile',
            manifestPath: 'services/orders/pom.xml',
          },
        ],
        rawPomContent: '<project/>',
        packageLockContent: null,
      },
    ],
    droppedManifests: [],
    summary: { parsedCount: 1, droppedCount: 0, totalDeclaredDependencies: 1 },
    autoAnswer: {
      writtenCodes: ['service.framework'],
      rowsWritten: 1,
      partialFailureCodes: [],
      aborted: false,
      failureReason: null,
      skippedManualCodes: [],
      resolvedTargetVersions: [
        {
          decisionCode: 'service.framework',
          framework: 'Spring Boot',
          version: '3.4.1',
          versionUnknown: false,
          provenance: 'manifest',
          sourceFile: 'services/orders/pom.xml',
        },
      ],
      confirmedManifests: [],
    },
    ...overrides,
  };
}

function makeDeps(
  response: TargetManifestUploadResponse,
): { deps: ManifestUploadPanelDeps; uploadSpy: ReturnType<typeof vi.fn>; captureSpy: ReturnType<typeof vi.fn> } {
  const uploadSpy = vi.fn().mockResolvedValue(response);
  const captureSpy = vi.fn().mockResolvedValue({ outcome: 'captured' });
  return {
    deps: {
      uploadTargetManifests: uploadSpy as unknown as ManifestUploadPanelDeps['uploadTargetManifests'],
      captureAnswer: captureSpy as unknown as ManifestUploadPanelDeps['captureAnswer'],
    },
    uploadSpy,
    captureSpy,
  };
}

describe('ManifestUploadPanel (Spec 3, TG5)', () => {
  it('(a) requires a module/service tag per selected manifest before submit', async () => {
    const { deps, uploadSpy } = makeDeps(makeResponse());
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        deps={deps}
      />,
    );

    const input = screen.getByTestId('manifest-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [pomFile()] } });

    // Selected, but no service chosen yet → submit disabled + a warning shown.
    const submit = screen.getByTestId('manifest-upload-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('manifest-tag-warning')).toBeTruthy();

    // Pick the target service → submit enables.
    pickOrdersService();
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);
    await waitFor(() => expect(uploadSpy).toHaveBeenCalledTimes(1));
    // The upload was given the tagged selection.
    const passedSelection = uploadSpy.mock.calls[0][2];
    expect(passedSelection[0].tag).toBe('orders-service');
  });

  it('(b) lists uploaded manifests with tag + parse status and surfaces dropped files', async () => {
    const response = makeResponse({
      droppedManifests: [
        {
          status: 'unparsed',
          kind: null,
          tag: null,
          manifestPath: 'build.gradle',
          reason: 'Unsupported file — only pom.xml and package.json are accepted.',
        },
      ],
      summary: { parsedCount: 1, droppedCount: 1, totalDeclaredDependencies: 1 },
    });
    const { deps } = makeDeps(response);
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        deps={deps}
      />,
    );

    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile()] },
    });
    pickOrdersService();
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // Parsed manifest row shows its tag + a "parsed" status.
    const parsed = await screen.findByTestId('manifest-status-parsed');
    expect(within(parsed).getByText('orders-service')).toBeTruthy();
    expect(within(parsed).getByText('parsed')).toBeTruthy();

    // Dropped file is surfaced (NOT hidden) with its reason.
    const dropped = screen.getByTestId('manifest-status-dropped');
    expect(within(dropped).getByText('dropped')).toBeTruthy();
    expect(within(dropped).getByText(/Unsupported file/)).toBeTruthy();
  });

  it('(c) renders an auto-answered decision with provenance and edits it inline (manual wins)', async () => {
    const { deps, captureSpy } = makeDeps(makeResponse());
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        sessionId="sess-1"
        deps={deps}
      />,
    );

    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile()] },
    });
    pickOrdersService();
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // The auto-answered decision shows its single resolved chip + manifest provenance.
    const decision = await screen.findByTestId('manifest-decision-service.framework');
    expect(within(decision).getByTestId('manifest-decision-chip').textContent).toBe(
      'Spring Boot 3.4.1',
    );
    expect(within(decision).getByTestId('manifest-decision-provenance').textContent).toBe(
      'from manifest',
    );
    expect(within(decision).getByTestId('manifest-decision-source')).toBeTruthy();

    // Edit inline → a NEW exact version is captured as a MANUAL answer.
    fireEvent.click(within(decision).getByTestId('manifest-decision-edit'));
    fireEvent.change(within(decision).getByTestId('manifest-decision-edit-input'), {
      target: { value: '3.4.5' },
    });
    fireEvent.click(within(decision).getByTestId('manifest-decision-edit-save'));

    await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));
    const captureBody = captureSpy.mock.calls[0][2];
    expect(captureBody.decisionCode).toBe('service.framework');
    // The captured value rides the structured { framework, version } envelope.
    const parsedValue = JSON.parse(captureBody.value);
    expect(parsedValue.value).toEqual({ framework: 'Spring Boot', version: '3.4.5' });

    // Provenance flips to "manually entered" + chip updates optimistically.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('manifest-decision-service.framework')).getByTestId(
          'manifest-decision-provenance',
        ).textContent,
      ).toBe('manually entered'),
    );
    expect(
      within(screen.getByTestId('manifest-decision-service.framework')).getByTestId(
        'manifest-decision-chip',
      ).textContent,
    ).toBe('Spring Boot 3.4.5');
  });

  it('(d) renders a version-unknown decision READ-ONLY as a pending version confirmation (Spec 2026-06-27)', async () => {
    // Spec 2026-06-27-target-manifest-version-unknown-pending-questions: a
    // version-unknown coordinate is NO LONGER editable here. It renders a
    // READ-ONLY "Pending version confirmation -- confirm in the conversation"
    // affordance (no inline edit entry point, no manual capture write).
    const response = makeResponse({
      autoAnswer: {
        writtenCodes: ['service.framework'],
        rowsWritten: 1,
        partialFailureCodes: [],
        aborted: false,
        failureReason: null,
        skippedManualCodes: [],
        resolvedTargetVersions: [
          {
            decisionCode: 'service.framework',
            framework: 'Spring Boot',
            version: 'version-unknown',
            versionUnknown: true,
            provenance: 'manifest',
            sourceFile: 'services/orders/pom.xml',
          },
        ],
        confirmedManifests: [],
      },
    });
    const { deps, captureSpy } = makeDeps(response);
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        sessionId="sess-1"
        deps={deps}
      />,
    );

    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pkgFile()] },
    });
    pickOrdersService();
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));

    // The unknown answer still shows the explicit "(version unknown)" chip, but
    // now as a READ-ONLY pending affordance -- not an editable field.
    const decision = await screen.findByTestId('manifest-decision-service.framework');
    expect(decision.getAttribute('data-version-unknown')).toBe('true');
    expect(within(decision).getByTestId('manifest-decision-chip').textContent).toBe(
      'Spring Boot (version unknown)',
    );
    expect(
      within(decision).getByTestId('manifest-version-pending-note').textContent,
    ).toMatch(/Pending version confirmation/);

    // No inline edit entry point + no manual capture for version-unknown rows.
    expect(within(decision).queryByTestId('manifest-decision-edit')).toBeNull();
    expect(within(decision).queryByTestId('manifest-decision-edit-input')).toBeNull();
    expect(captureSpy).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Spec 2026-06-26 Task Group 9 — inferred/LLM provenance badges + Tier-2 facts
// ===========================================================================

describe('ManifestUploadPanel (Spec 2026-06-26, TG9 provenance + Tier-2 free facts)', () => {
  async function uploadAndSettle(response: TargetManifestUploadResponse) {
    const made = makeDeps(response);
    render(
      <ManifestUploadPanel
        projectId={PROJECT}
        targetArchitectureId={ARCH}
        services={SERVICES}
        sessionId="sess-1"
        deps={made.deps}
      />,
    );
    fireEvent.change(screen.getByTestId('manifest-file-input'), {
      target: { files: [pomFile()] },
    });
    pickOrdersService();
    fireEvent.click(screen.getByTestId('manifest-upload-submit'));
    return made;
  }

  it('(e) renders inferred + LLM-suggested provenance badges naming their source dependency', async () => {
    const response = makeResponse({
      autoAnswer: {
        writtenCodes: ['db.engine', 'validation.framework'],
        rowsWritten: 2,
        partialFailureCodes: [],
        aborted: false,
        failureReason: null,
        skippedManualCodes: [],
        resolvedTargetVersions: [
          {
            decisionCode: 'db.engine',
            framework: 'PostgreSQL',
            version: 'version-unknown',
            versionUnknown: true,
            provenance: 'inferred',
            sourceFile: 'services/orders/pom.xml',
            sourceDependency: 'org.postgresql:postgresql',
          },
          {
            decisionCode: 'validation.framework',
            framework: 'Hibernate Validator',
            version: '8.0.1',
            versionUnknown: false,
            provenance: 'llm',
            sourceFile: 'services/orders/pom.xml',
            sourceDependency: 'org.hibernate.validator:hibernate-validator',
          },
        ],
        confirmedManifests: [],
      },
    });
    await uploadAndSettle(response);

    // inferred -> "inferred from <driver coordinate>".
    const engine = await screen.findByTestId('manifest-decision-db.engine');
    expect(engine.getAttribute('data-provenance')).toBe('inferred');
    expect(
      within(engine).getByTestId('manifest-decision-provenance').textContent,
    ).toBe('inferred from org.postgresql:postgresql');

    // llm -> "LLM-suggested from <coordinate>".
    const validation = screen.getByTestId('manifest-decision-validation.framework');
    expect(validation.getAttribute('data-provenance')).toBe('llm');
    expect(
      within(validation).getByTestId('manifest-decision-provenance').textContent,
    ).toBe('LLM-suggested from org.hibernate.validator:hibernate-validator');

    // No free facts in this response -> the Tier-2 section is omitted entirely.
    expect(screen.queryByTestId('manifest-free-facts-section')).toBeNull();
  });

  it('(f) keeps the existing manifest source-file line + "from manifest" badge intact', async () => {
    // The original closed badge behaviour (manifest -> "from manifest" + source
    // line) is preserved unchanged for a deterministic manifest row.
    await uploadAndSettle(makeResponse());
    const decision = await screen.findByTestId('manifest-decision-service.framework');
    expect(
      within(decision).getByTestId('manifest-decision-provenance').textContent,
    ).toBe('from manifest');
    expect(within(decision).getByTestId('manifest-decision-source')).toBeTruthy();
  });

  it('(g) renders the Tier-2 free-facts section AFTER the decisions list, with remove (informational, never a question)', async () => {
    const MCP = 'MCP SDK \u2014 io.modelcontextprotocol.sdk';
    const SPRING_AI = 'Spring AI / LLM client \u2014 spring-ai-openai';
    const base = makeResponse().autoAnswer!;
    const response = makeResponse({
      autoAnswer: { ...base, freeFacts: [MCP, SPRING_AI] },
    });
    const { captureSpy } = await uploadAndSettle(response);

    const section = await screen.findByTestId('manifest-free-facts-section');
    // Clearly informational (a "Lower-level details" heading), not a question.
    expect(
      within(section).getByTestId('manifest-free-facts-heading').textContent,
    ).toMatch(/Lower-level details/i);

    const items = within(section).getAllByTestId('manifest-free-fact-item');
    expect(items).toHaveLength(2);
    expect(
      within(items[0]).getByTestId('manifest-free-fact-label').textContent,
    ).toBe(MCP);

    // Slotted AFTER the "Auto-answered decisions" list.
    const decisionsHeading = screen.getByTestId('manifest-decisions-heading');
    expect(
      decisionsHeading.compareDocumentPosition(section) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Remove one fact -> it disappears; NO captured-decision write (informational).
    fireEvent.click(within(items[0]).getByTestId('manifest-free-fact-remove'));
    await waitFor(() =>
      expect(within(section).getAllByTestId('manifest-free-fact-item')).toHaveLength(1),
    );
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('(h) lets the user edit a free-fact label inline without capturing an answer', async () => {
    const base = makeResponse().autoAnswer!;
    const response = makeResponse({
      autoAnswer: {
        ...base,
        freeFacts: ['MCP SDK \u2014 io.modelcontextprotocol.sdk'],
      },
    });
    const { captureSpy } = await uploadAndSettle(response);

    const item = await screen.findByTestId('manifest-free-fact-item');
    fireEvent.click(within(item).getByTestId('manifest-free-fact-edit'));
    fireEvent.change(within(item).getByTestId('manifest-free-fact-input'), {
      target: { value: 'Model Context Protocol SDK' },
    });
    fireEvent.click(within(item).getByTestId('manifest-free-fact-save'));

    await waitFor(() =>
      expect(
        within(screen.getByTestId('manifest-free-fact-item')).getByTestId(
          'manifest-free-fact-label',
        ).textContent,
      ).toBe('Model Context Protocol SDK'),
    );
    // An informational free fact is never a captured decision.
    expect(captureSpy).not.toHaveBeenCalled();
  });
});
