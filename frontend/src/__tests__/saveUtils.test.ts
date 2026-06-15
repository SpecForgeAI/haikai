/**
 * Tests for Save Utility Functions
 *
 * Spec 2026-01-05: Auto-Save After Create Project
 * Task Group 1: Tests for the extracted save utility
 *
 * Step 4 of save-validation series (2026-05-08): added cases verifying that a
 * structured `ModelApiError` (carrying `entityType` + `code` + `field`) ends
 * up in `result.validationErrors`, and that a generic `ModelApiError` (only
 * `message`) ends up in `result.error` for the toast path.
 *
 * Spec 2026-05-11 Frontend Architecture-Scoped Save Migration: signature now
 * threads `projectId` and `architectureId` through to `saveModelByFilename`.
 * Tests updated to pass the two new arguments and to assert the underlying
 * mock was called with both ids.
 */

import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { ArchitectureModel } from '../types/model';
import { ValidationError } from '../types/config';
import { emptyModel } from '../config/defaults';
import { ModelApiError } from '../api/types/modelApiError';

// Mock dependencies before importing the module under test
vi.mock('../utils/validation', () => ({
  prepareModelForSave: vi.fn((model) => model),
  validateModel: vi.fn(() => []),
}));

vi.mock('../utils/sanitize', () => ({
  sanitizeModelForBackendSave: vi.fn((model) => model),
}));

vi.mock('../api/modelApi', () => ({
  saveModelByFilename: vi.fn(() => Promise.resolve({ id: 'test-id', filename: 'test-file' })),
}));

// Import mocked modules
import { prepareModelForSave, validateModel } from '../utils/validation';
import { sanitizeModelForBackendSave } from '../utils/sanitize';
import { saveModelByFilename } from '../api/modelApi';
// Import the module under test after mocks are set up
import { saveModelToBackend } from '../utils/saveUtils';

// Spec 2026-05-11: stable fake ids for the architecture-scoped save plumbing.
const PROJECT_ID = 'proj-uuid-001';
const ARCHITECTURE_ID = 'arch-uuid-001';

describe('saveModelToBackend', () => {
  let mockDispatch: Mock;
  let testModel: ArchitectureModel;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatch = vi.fn();
    testModel = { ...emptyModel };
  });

  it('should call prepare, validate, sanitize in correct order', async () => {
    const callOrder: string[] = [];

    (prepareModelForSave as Mock).mockImplementation((model) => {
      callOrder.push('prepare');
      return model;
    });

    (validateModel as Mock).mockImplementation(() => {
      callOrder.push('validate');
      return [];
    });

    (sanitizeModelForBackendSave as Mock).mockImplementation((model) => {
      callOrder.push('sanitize');
      return model;
    });

    (saveModelByFilename as Mock).mockImplementation(() => {
      callOrder.push('save');
      return Promise.resolve({ id: 'test-id', filename: 'test-file' });
    });

    await saveModelToBackend(testModel, 'test-file', PROJECT_ID, ARCHITECTURE_ID, mockDispatch);

    expect(callOrder).toEqual(['prepare', 'validate', 'sanitize', 'save']);
  });

  it('should return success result with filename on successful save', async () => {
    const filename = 'my-project';
    (validateModel as Mock).mockReturnValue([]);
    (saveModelByFilename as Mock).mockResolvedValue({ id: 'test-id', filename });

    const result = await saveModelToBackend(
      testModel,
      filename,
      PROJECT_ID,
      ARCHITECTURE_ID,
      mockDispatch
    );

    expect(result.success).toBe(true);
    expect(result.filename).toBe(filename);
    expect(result.validationErrors).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  // Spec 2026-05-11: assert that projectId + architectureId are forwarded to
  // saveModelByFilename so the architecture-scoped URL receives both ids.
  it('forwards projectId and architectureId to saveModelByFilename', async () => {
    const filename = 'my-project';
    (validateModel as Mock).mockReturnValue([]);
    (saveModelByFilename as Mock).mockResolvedValue({ id: 'test-id', filename });

    await saveModelToBackend(testModel, filename, PROJECT_ID, ARCHITECTURE_ID, mockDispatch);

    expect(saveModelByFilename).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCHITECTURE_ID,
      filename,
      expect.anything()
    );
  });

  it('should return failure result with validation errors when validation fails', async () => {
    const validationErrors: ValidationError[] = [
      {
        entityType: 'applications',
        entityId: 'app-1',
        field: 'name',
        message: 'Name is required',
        type: 'required',
      },
    ];
    (validateModel as Mock).mockReturnValue(validationErrors);

    const result = await saveModelToBackend(
      testModel,
      'test-file',
      PROJECT_ID,
      ARCHITECTURE_ID,
      mockDispatch
    );

    expect(result.success).toBe(false);
    expect(result.validationErrors).toEqual(validationErrors);
    expect(saveModelByFilename).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should return failure result with error message on API error', async () => {
    const errorMessage = 'Network error: Failed to save';
    (validateModel as Mock).mockReturnValue([]);
    (saveModelByFilename as Mock).mockRejectedValue(new Error(errorMessage));

    const result = await saveModelToBackend(
      testModel,
      'test-file',
      PROJECT_ID,
      ARCHITECTURE_ID,
      mockDispatch
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(errorMessage);
    expect(result.validationErrors).toBeUndefined();
  });

  it('should dispatch LOAD_MODEL action on successful save', async () => {
    const filename = 'my-project';
    const preparedModel = { ...testModel };
    (prepareModelForSave as Mock).mockReturnValue(preparedModel);
    (validateModel as Mock).mockReturnValue([]);
    (saveModelByFilename as Mock).mockResolvedValue({ id: 'test-id', filename });

    await saveModelToBackend(testModel, filename, PROJECT_ID, ARCHITECTURE_ID, mockDispatch);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'LOAD_MODEL',
      payload: preparedModel,
      fileName: filename,
    });
  });

  // -------------------------------------------------------------------
  // Step 4: routing of structured ModelApiError into validationErrors
  // -------------------------------------------------------------------

  describe('Step 4: ModelApiError routing', () => {
    it('routes structured ModelApiError (entityType + code + field) to result.validationErrors', async () => {
      const apiError = new ModelApiError(
        "ApplicationPoint validation failed for id 'ap-1' (name: 'Login'): application_id is required.",
        {
          status: 400,
          message:
            "ApplicationPoint validation failed for id 'ap-1' (name: 'Login'): application_id is required.",
          code: 'application_id_required',
          field: 'application_id',
          entity_type: 'application_points',
          entity_id: 'ap-1',
          entity_name: 'Login',
          error: 'Bad Request',
        }
      );

      (validateModel as Mock).mockReturnValue([]);
      (saveModelByFilename as Mock).mockRejectedValue(apiError);

      const result = await saveModelToBackend(
        testModel,
        'test-file',
        PROJECT_ID,
        ARCHITECTURE_ID,
        mockDispatch
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(result.validationErrors).toHaveLength(1);

      const ve = result.validationErrors![0];
      expect(ve.entityType).toBe('application_points');
      expect(ve.entityId).toBe('ap-1');
      expect(ve.entityName).toBe('Login');
      expect(ve.field).toBe('application_id');
      expect(ve.type).toBe('required');
      expect(ve.message).toContain('application_id is required');

      // Toast path should NOT be triggered when we route inline.
      expect(result.error).toBeUndefined();

      // Structured envelope still attached for callers that want it.
      expect(result.backendError).toBeDefined();
      expect(result.backendError?.entityType).toBe('application_points');
      expect(result.backendError?.code).toBe('application_id_required');
    });

    it('routes generic ModelApiError (no entityType / code) to result.error toast path', async () => {
      const apiError = new ModelApiError('Internal server error', {
        status: 500,
        message: 'Internal server error',
        error: 'Internal Server Error',
      });

      (validateModel as Mock).mockReturnValue([]);
      (saveModelByFilename as Mock).mockRejectedValue(apiError);

      const result = await saveModelToBackend(
        testModel,
        'test-file',
        PROJECT_ID,
        ARCHITECTURE_ID,
        mockDispatch
      );

      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeUndefined();
      expect(result.error).toBe('Internal server error');

      // Backend envelope is still attached, but it carries no `code`/`entityType`.
      expect(result.backendError?.status).toBe(500);
      expect(result.backendError?.code).toBeUndefined();
      expect(result.backendError?.entityType).toBeUndefined();
    });
  });
});
