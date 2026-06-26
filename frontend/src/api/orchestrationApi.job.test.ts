/**
 * Tests for Orchestration Job API Functions
 *
 * Spec 2026-02-06: Implement-Part Sequencing Workflow
 * Task Group 5: Frontend API Functions and Parts List UI
 * Task 5.1: Write 4-6 focused tests for API functions and UI
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startOrchestrationJob, pollJobStatus, type SpecIntent } from './orchestrationApi';

describe('Orchestration Job API Functions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  describe('startOrchestrationJob', () => {
    it('should POST to /api/v2/jobs/orchestrations and return jobId', async () => {
      const mockResponse = { job_id: 'job-123', status: 'queued' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const specIntent: SpecIntent = { spec_name: 'spec-intent', session_id: 'session-abc' };
      const result = await startOrchestrationJob('test-company', 'test-project', [specIntent]);

      expect(global.fetch).toHaveBeenCalledWith(
        '/api/v2/jobs/orchestrations',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('"company"'),
        })
      );
      expect(result).toEqual({ jobId: 'job-123' });
    });

    it('should throw error when request fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const specIntent: SpecIntent = { spec_name: 'spec-intent', session_id: 'session-abc' };
      await expect(
        startOrchestrationJob('test-company', 'test-project', [specIntent])
      ).rejects.toThrow('Failed to start orchestration job');
    });

    it('should include spec_intents as objects in request body', async () => {
      const mockResponse = { job_id: 'job-456', status: 'queued' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const specIntent: SpecIntent = { spec_name: 'my-spec-intent', session_id: 'session-xyz' };
      await startOrchestrationJob('company', 'project', [specIntent]);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.spec_intents).toEqual([{ spec_name: 'my-spec-intent', session_id: 'session-xyz' }]);
    });

    it('should omit session_id from spec_intents when not provided', async () => {
      const mockResponse = { job_id: 'job-789', status: 'queued' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const specIntent: SpecIntent = { spec_name: 'my-spec-intent' };
      await startOrchestrationJob('company', 'project', [specIntent]);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.spec_intents).toEqual([{ spec_name: 'my-spec-intent' }]);
      expect(body.spec_intents[0]).not.toHaveProperty('session_id');
    });

    // Batch feature (2026-06-26): a non-empty batchName enables multi-spec
    // submissions (coupled batch -> single MR) and is sent as snake_case
    // `batch_name` per the AMS wire convention.
    it('includes batch_name and multiple spec_intents in batch mode', async () => {
      const mockResponse = { job_id: 'job-batch', status: 'queued' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await startOrchestrationJob(
        'company',
        'project',
        [{ spec_name: 'spec-one' }, { spec_name: 'spec-two' }],
        [],
        'checkout-revamp',
      );

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.batch_name).toBe('checkout-revamp');
      expect(body.spec_intents).toHaveLength(2);
    });

    it('omits batch_name when blank/whitespace', async () => {
      const mockResponse = { job_id: 'job-x', status: 'queued' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await startOrchestrationJob('company', 'project', [{ spec_name: 'spec-one' }], [], '   ');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body).not.toHaveProperty('batch_name');
    });
  });

  describe('pollJobStatus', () => {
    it('should GET job status from /api/v2/jobs/{jobId}', async () => {
      const mockResponse = { status: 'running' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pollJobStatus('job-123');

      expect(global.fetch).toHaveBeenCalledWith('/api/v2/jobs/job-123');
      expect(result).toEqual({ status: 'running' });
    });

    it('should return completed status with no error', async () => {
      const mockResponse = { status: 'completed' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pollJobStatus('job-456');

      expect(result.status).toBe('completed');
      expect(result.error).toBeUndefined();
    });

    it('should return failed status with error message', async () => {
      const mockResponse = { status: 'failed', error: 'Task execution failed' };
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pollJobStatus('job-789');

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Task execution failed');
    });

    it('should throw error when request fails', async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(pollJobStatus('nonexistent-job')).rejects.toThrow('Failed to poll job status');
    });

    // Spec 2026-06-12 (Task Group 5): pollJobStatus passes through the full
    // JobDetailResponse instead of discarding everything but status/error.
    it('should pass through progress, result, logs_url and timestamps', async () => {
      const mockResponse = {
        job_id: 'job-full',
        status: 'running',
        progress: {
          current_step: 2,
          total_steps: 5,
          step_description: 'Implementing tasks',
          percentage: 40,
        },
        result: { feature_branch: 'feature/spec-x', pr_url: 'https://git.example/pr/1' },
        logs_url: 'https://logs.example/job-full',
        started_at: '2026-06-12T10:00:00Z',
        completed_at: '2026-06-12T10:05:00Z',
      };
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await pollJobStatus('job-full');

      expect(result.status).toBe('running');
      expect(result.progress).toEqual({
        current_step: 2,
        total_steps: 5,
        step_description: 'Implementing tasks',
        percentage: 40,
      });
      expect(result.result).toEqual({
        feature_branch: 'feature/spec-x',
        pr_url: 'https://git.example/pr/1',
      });
      expect(result.logs_url).toBe('https://logs.example/job-full');
      expect(result.started_at).toBe('2026-06-12T10:00:00Z');
      expect(result.completed_at).toBe('2026-06-12T10:05:00Z');
    });
  });
});
