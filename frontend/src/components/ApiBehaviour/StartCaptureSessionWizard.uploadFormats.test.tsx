/**
 * StartCaptureSessionWizard -- step-1 contract-upload acceptance.
 *
 * Spec: 2026-06-03 OAS-YAML + WADL/XSD Contract Support for the API Behaviour
 * capture harness, Task Group 5 (frontend wizard).
 *
 * The step-1 source upload now accepts OAS (.json/.yaml/.yml) AND a WADL with
 * one-or-more sibling XSD grammar files, so the file input must:
 *   - widen `accept` to `.json,.yaml,.yml,.wadl,.xsd` (still allowing
 *     `application/json`), and
 *   - be `multiple` (a WADL + its XSD grammars are selected together).
 *
 * Harness mirrors `StartCaptureSessionWizard.test.tsx`: Vitest + a mocked
 * `useArchitecture` + a mocked api client so nothing reaches the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    createCaptureSession: vi.fn(),
    submitSecrets: vi.fn(),
    parseOas: vi.fn(),
    startCaptureSession: vi.fn(),
    updateCaptureSession: vi.fn(),
    updateOperation: vi.fn(),
    listOperations: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: vi.fn(),
}));

import { useArchitecture } from '../../contexts/ArchitectureContext';
import { StartCaptureSessionWizard } from './StartCaptureSessionWizard';

const PROJECT_ID = 'proj-uuid-aaa';
const ARCH_ID = 'arch-uuid-bbb';

function mockArchitectureModel() {
  return {
    model: {
      metaModel: {
        entities: { interfaces: [] },
      },
    },
  } as unknown as ReturnType<typeof useArchitecture>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useArchitecture).mockReturnValue(mockArchitectureModel());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StartCaptureSessionWizard -- step-1 contract upload accept + multiple', () => {
  it('the step-1 file input accepts OAS YAML/JSON and WADL+XSD and allows multiple files', () => {
    render(
      <StartCaptureSessionWizard
        open={true}
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByTestId(
      'start-capture-session-wizard-oas-file',
    ) as HTMLInputElement;

    expect(input.type).toBe('file');
    // Multi-file selection (a WADL + its XSD grammars together).
    expect(input.multiple).toBe(true);

    const accept = input.getAttribute('accept') ?? '';
    const acceptTokens = accept.split(',').map((s) => s.trim());
    // OAS (both JSON + YAML) AND the WADL contract + its XSD grammar.
    expect(acceptTokens).toContain('.json');
    expect(acceptTokens).toContain('.yaml');
    expect(acceptTokens).toContain('.yml');
    expect(acceptTokens).toContain('.wadl');
    expect(acceptTokens).toContain('.xsd');
    // A `.wsdl` must NOT be offered -- SOAP capture is a planned follow-on.
    expect(acceptTokens).not.toContain('.wsdl');
  });
});
