/**
 * ProjectConfigModal Vitest coverage.
 *
 * Spec 2026-05-20: Cross-Story Context Injection -- Task Group 9
 * Spec 2026-05-20: Bulk-Resolve OAS/WSDL Parser -- Task Group 7
 *
 * Task 9.1 calls for one frontend test that "the project config screen edits
 * and saves the three new fields". This test asserts that:
 *   1. The modal seeds its three inputs from the project's stored values
 *      (or from documented defaults when the stored value is null);
 *   2. Editing all three and clicking Save calls updateProjectConfig with the
 *      changed fields as a PATCH body and invokes onSaveSuccess with the
 *      updated DTO returned by the API.
 *
 * One assertion verifies the "omit unchanged fields" delta posture so the
 * frontend honours the same null-guarded PATCH contract as the backend.
 *
 * Task 7.1 (Bulk-Resolve OAS/WSDL Parser) adds three further assertions on
 * the new "Max contract file size (MB)" field:
 *   1. The new field renders inside the Uploads section with the documented
 *      default of 10 MB when the project DTO carries null.
 *   2. Editing the field and saving calls updateProjectConfig with the new
 *      value via the boxed-typed `maxContractUploadFileSizeMb` PATCH key.
 *   3. The new field falls under the same null-guarded delta rule: leaving
 *      it untouched omits it from the PATCH body.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('../api/projectsApi', async () => {
  const actual = await vi.importActual<typeof import('../api/projectsApi')>(
    '../api/projectsApi'
  );
  return {
    ...actual,
    updateProjectConfig: vi.fn(),
  };
});

import { updateProjectConfig, ProjectDto } from '../api/projectsApi';
import {
  ProjectConfigModal,
  DEFAULT_PER_STORY_CAP,
  DEFAULT_CROSS_STORY_CAP,
  DEFAULT_AUTO_RUN_PASS_2,
  DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB,
} from '../components/Project/ProjectConfigModal';

const mockUpdateProjectConfig =
  updateProjectConfig as unknown as ReturnType<typeof vi.fn>;

function buildProject(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    name: 'test-project',
    projectParentFolder: '/tmp/test',
    projectHierarchy: null,
    organisationId: null,
    repoUrl: null,
    isActive: true,
    createdAt: '2026-05-20T00:00:00Z',
    updatedAt: '2026-05-20T00:00:00Z',
    perStoryContextTokenCap: null,
    crossStoryContextTokenCap: null,
    autoRunPass2: null,
    maxContractUploadFileSizeMb: null,
    ...overrides,
  };
}

describe('ProjectConfigModal (Task Group 9)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('seeds inputs with documented defaults when project values are null', () => {
    const project = buildProject({
      perStoryContextTokenCap: null,
      crossStoryContextTokenCap: null,
      autoRunPass2: null,
    });

    render(
      <ProjectConfigModal isOpen={true} project={project} onClose={() => undefined} />
    );

    const perStory = screen.getByTestId('per-story-cap-input') as HTMLInputElement;
    const crossStory = screen.getByTestId('cross-story-cap-input') as HTMLInputElement;
    const autoRun = screen.getByTestId('auto-run-pass-2-input') as HTMLInputElement;

    expect(perStory.value).toBe(String(DEFAULT_PER_STORY_CAP));
    expect(crossStory.value).toBe(String(DEFAULT_CROSS_STORY_CAP));
    expect(autoRun.checked).toBe(DEFAULT_AUTO_RUN_PASS_2);
  });

  it('edits all three fields and PATCHes them via updateProjectConfig on Save', async () => {
    const project = buildProject({
      perStoryContextTokenCap: 24000,
      crossStoryContextTokenCap: 12000,
      autoRunPass2: true,
    });
    const updatedDto = buildProject({
      perStoryContextTokenCap: 40000,
      crossStoryContextTokenCap: 8000,
      autoRunPass2: false,
    });
    mockUpdateProjectConfig.mockResolvedValueOnce(updatedDto);

    const onSaveSuccess = vi.fn();
    const onClose = vi.fn();

    render(
      <ProjectConfigModal
        isOpen={true}
        project={project}
        onClose={onClose}
        onSaveSuccess={onSaveSuccess}
      />
    );

    fireEvent.change(screen.getByTestId('per-story-cap-input'), {
      target: { value: '40000' },
    });
    fireEvent.change(screen.getByTestId('cross-story-cap-input'), {
      target: { value: '8000' },
    });
    fireEvent.click(screen.getByTestId('auto-run-pass-2-input'));

    fireEvent.click(screen.getByTestId('project-config-modal-save'));

    await waitFor(() => {
      expect(mockUpdateProjectConfig).toHaveBeenCalledTimes(1);
    });

    expect(mockUpdateProjectConfig).toHaveBeenCalledWith(project.id, {
      perStoryContextTokenCap: 40000,
      crossStoryContextTokenCap: 8000,
      autoRunPass2: false,
    });
    expect(onSaveSuccess).toHaveBeenCalledWith(updatedDto);
    expect(onClose).toHaveBeenCalled();
  });

  it('omits unchanged fields from the PATCH body (null-guarded delta)', async () => {
    const project = buildProject({
      perStoryContextTokenCap: 24000,
      crossStoryContextTokenCap: 12000,
      autoRunPass2: true,
    });
    mockUpdateProjectConfig.mockResolvedValueOnce(project);

    render(
      <ProjectConfigModal
        isOpen={true}
        project={project}
        onClose={() => undefined}
      />
    );

    // Only change auto-run; leave the two caps untouched.
    fireEvent.click(screen.getByTestId('auto-run-pass-2-input'));
    fireEvent.click(screen.getByTestId('project-config-modal-save'));

    await waitFor(() => {
      expect(mockUpdateProjectConfig).toHaveBeenCalledTimes(1);
    });

    // The PATCH must contain ONLY autoRunPass2 -- the unchanged caps should
    // not be in the body, so the backend's null-guard preserves them.
    expect(mockUpdateProjectConfig).toHaveBeenCalledWith(project.id, {
      autoRunPass2: false,
    });
  });
});

// ============================================================================
// Spec 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 7
// ============================================================================
describe('ProjectConfigModal (Task Group 7 -- Uploads section)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "Max contract file size (MB)" input with default 10 when the DTO is null', () => {
    const project = buildProject({ maxContractUploadFileSizeMb: null });

    render(
      <ProjectConfigModal
        isOpen={true}
        project={project}
        onClose={() => undefined}
      />,
    );

    const input = screen.getByTestId(
      'max-contract-upload-file-size-mb-input',
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('200');
    expect(input.value).toBe(String(DEFAULT_MAX_CONTRACT_UPLOAD_FILE_SIZE_MB));
  });

  it('editing the max contract file size and saving calls updateProjectConfig with the new value', async () => {
    const project = buildProject({ maxContractUploadFileSizeMb: 10 });
    mockUpdateProjectConfig.mockResolvedValueOnce(
      buildProject({ maxContractUploadFileSizeMb: 50 }),
    );

    render(
      <ProjectConfigModal
        isOpen={true}
        project={project}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(
      screen.getByTestId('max-contract-upload-file-size-mb-input'),
      { target: { value: '50' } },
    );
    fireEvent.click(screen.getByTestId('project-config-modal-save'));

    await waitFor(() => {
      expect(mockUpdateProjectConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateProjectConfig).toHaveBeenCalledWith(project.id, {
      maxContractUploadFileSizeMb: 50,
    });
  });

  it('leaving the max contract file size untouched omits it from the PATCH body', async () => {
    const project = buildProject({
      maxContractUploadFileSizeMb: 25,
      autoRunPass2: true,
    });
    mockUpdateProjectConfig.mockResolvedValueOnce(project);

    render(
      <ProjectConfigModal
        isOpen={true}
        project={project}
        onClose={() => undefined}
      />,
    );

    // Edit only autoRunPass2; leave the contract file size untouched.
    fireEvent.click(screen.getByTestId('auto-run-pass-2-input'));
    fireEvent.click(screen.getByTestId('project-config-modal-save'));

    await waitFor(() => {
      expect(mockUpdateProjectConfig).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdateProjectConfig).toHaveBeenCalledWith(project.id, {
      autoRunPass2: false,
    });
  });
});
