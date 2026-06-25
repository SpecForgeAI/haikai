/**
 * Tests for the manifest-artifacts READ proxy (Spec 2026-06-25 follow-up).
 *
 * `registerTargetManifestUploadRoute(router, fetchManifestArtifacts?)` now also
 * attaches a thin GET pass-through so the browser can LIST a target
 * architecture's persisted confirmed manifests:
 *
 *   GET /api/projects/:projectId/target-architectures/:targetArchitectureId/manifest-artifacts
 *
 * The read seam is injectable (defaulting to the real gateway -> AMS client) so
 * these tests stub it — no live AMS. Covered:
 *   (a) returns the AMS snake_case list (round-tripped as-is) on success, and
 *       escapes the path params into the seam call;
 *   (b) FAIL-SOFT — a read throw degrades to 503 (no silent drop), matching the
 *       house `migrationBookOfWork.ts` GET proxy idiom.
 */

import express from 'express';
import request from 'supertest';
import {
  FetchTargetManifestArtifactsSeam,
  registerTargetManifestUploadRoute,
} from '../routes/targetManifestUpload';
import { TargetManifestArtifactWire } from '../services/targetManifestArtifactsClient';

// Mock logger to keep test output clean.
jest.mock('../services/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

function buildApp(fetchManifestArtifacts: FetchTargetManifestArtifactsSeam) {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  // Mount at /api so the full path mirrors the production mount.
  registerTargetManifestUploadRoute(router, fetchManifestArtifacts);
  app.use('/api', router);
  return app;
}

function wireRow(tag: string): TargetManifestArtifactWire {
  return {
    id: `row-${tag}`,
    project_id: 'proj-1',
    target_architecture_id: 'arch-1',
    tag,
    kind: 'pom',
    ecosystem: 'MAVEN',
    manifest_path: 'pom.xml',
    content: '<project/>\n',
    package_lock_content: null,
    resolved_dependencies: [{ name: 'a:b', resolvedVersion: '1.2.3' }],
    is_latest: true,
    created_at: '2026-06-25T00:00:00Z',
  };
}

describe('GET .../manifest-artifacts read proxy', () => {
  it('(a) returns the AMS snake_case list and forwards the (projectId, targetArchitectureId) path params', async () => {
    const rows = [wireRow('orders-service'), wireRow('web-app')];
    const seam = jest.fn().mockResolvedValue(rows);
    const app = buildApp(seam);

    const res = await request(app).get(
      '/api/projects/proj-1/target-architectures/arch-1/manifest-artifacts',
    );

    expect(res.status).toBe(200);
    // The snake_case wire list is round-tripped as-is (verbatim content kept).
    expect(res.body).toEqual(rows);
    expect(res.body[0].manifest_path).toBe('pom.xml');
    expect(res.body[0].content).toBe('<project/>\n');
    // The seam was called with the decoded path params.
    expect(seam).toHaveBeenCalledTimes(1);
    expect(seam).toHaveBeenCalledWith('proj-1', 'arch-1');
  });

  it('(a2) returns an empty list (200) when AMS has no artifacts for the target architecture', async () => {
    const seam = jest.fn().mockResolvedValue([]);
    const app = buildApp(seam);

    const res = await request(app).get(
      '/api/projects/proj-1/target-architectures/arch-1/manifest-artifacts',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('(b) FAIL-SOFT — a read throw (AMS unreachable / non-2xx) degrades to 503, never a 500/throw', async () => {
    const seam = jest
      .fn()
      .mockRejectedValue(new Error('architecture model service manifest-artifacts list failed: HTTP 503'));
    const app = buildApp(seam);

    const res = await request(app).get(
      '/api/projects/proj-1/target-architectures/arch-1/manifest-artifacts',
    );

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Architecture model service unavailable/i);
    // No silent drop: the upstream reason is surfaced in the body details.
    expect(res.body.details).toMatch(/HTTP 503/);
  });
});
