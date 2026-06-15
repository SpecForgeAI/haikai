/**
 * OAS Export routes — deterministic OpenAPI contracts from the architecture
 * model (oracle weaknesses #5, direct build 2026-06-11).
 *
 * Mounted at `/api/v1` (see `server.ts`). Read-only: a download is a
 * regeneration, so there is nothing to persist and nothing to go stale.
 *
 * Routes (all under `/projects/:projectId/architectures/:architectureId/oas-export`):
 *
 *   GET  /interfaces                       — list the architecture's interfaces
 *                                            (AMS elements-inventory, scoped).
 *   POST /interfaces/:interfaceId/generate — deterministic OpenAPI 3.0 document
 *                                            + gap report + assembly summary.
 *   GET  /download                         — zip of every interface's contract
 *                                            (one .openapi.json + .gaps.json per
 *                                            interface + manifest.json), built
 *                                            in memory via the shared zip writer.
 *
 * Error conventions follow `dbMigrationPack.ts`: AMS errors round-trip
 * status + body, unreachable upstreams → 503, `[diag-gw]` route logs.
 */

import { Router, Response } from 'express';
import { logger } from '../services/logger';
import { ArchitectureModelHttpError } from '../services/architectureModelClient';
import { buildZipArchive, ZipEntry } from '../services/dbMigrationPack/zip';
import { OasCoverageError, slugifyFilename } from '../services/oasExport/assembleOasDocument';
import {
  generateAllOas,
  generateOasForInterface,
  listExportableInterfaces,
  OasExportUpstreamError,
} from '../services/oasExport/oasExportHandler';

export const oasExportRouter = Router();

const BASE = '/projects/:projectId/architectures/:architectureId/oas-export';

function mapError(
  error: unknown,
  res: Response,
  routeName: string,
  context: Record<string, unknown>
): void {
  if (error instanceof ArchitectureModelHttpError) {
    logger.warn(`oas-export ${routeName}: AMS error round-trip`, {
      ...context,
      status: error.status,
    });
    res.status(error.status).json(
      error.body ?? { error: { code: error.status, message: error.message } }
    );
    return;
  }
  if (error instanceof OasExportUpstreamError) {
    logger.warn(`oas-export ${routeName}: upstream tool error`, {
      ...context,
      status: error.status,
      message: error.message,
    });
    res
      .status(error.status)
      .json({ error: { code: error.status, message: error.message } });
    return;
  }
  if (error instanceof OasCoverageError) {
    logger.error(`oas-export ${routeName}: coverage assertion failed`, {
      ...context,
      message: error.message,
    });
    res.status(500).json({ error: { code: 500, message: error.message } });
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  const unreachable = /ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(message);
  logger.error(`oas-export ${routeName}: unexpected error`, { ...context, message });
  res.status(unreachable ? 503 : 500).json({
    error: {
      code: unreachable ? 503 : 500,
      message: unreachable
        ? 'Upstream service unavailable (architecture model / mcp server).'
        : message,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /interfaces — architecture-scoped interface list
// ---------------------------------------------------------------------------

oasExportRouter.get(`${BASE}/interfaces`, async (req, res) => {
  const { projectId, architectureId } = req.params;
  const start = Date.now();
  try {
    const interfaces = await listExportableInterfaces(projectId, architectureId);
    console.log(
      `[diag-gw] route=oas-export-interfaces status=200 count=${interfaces.length} ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.json({ interfaces });
  } catch (error) {
    mapError(error, res, 'interfaces', { projectId, architectureId });
  }
});

// ---------------------------------------------------------------------------
// POST /interfaces/:interfaceId/generate — single-interface contract
// ---------------------------------------------------------------------------

oasExportRouter.post(`${BASE}/interfaces/:interfaceId/generate`, async (req, res) => {
  const { projectId, architectureId, interfaceId } = req.params;
  const start = Date.now();
  try {
    const result = await generateOasForInterface(interfaceId);
    console.log(
      `[diag-gw] route=oas-export-generate status=200 interface=${interfaceId} ` +
        `mapped=${result.summary.mappedEndpointCount}/${result.summary.endpointCount} ` +
        `elapsed_ms=${Date.now() - start}`
    );
    res.json(result);
  } catch (error) {
    mapError(error, res, 'generate', { projectId, architectureId, interfaceId });
  }
});

// ---------------------------------------------------------------------------
// GET /download — zip of all interface contracts (in-memory, no filesystem)
// ---------------------------------------------------------------------------

oasExportRouter.get(`${BASE}/download`, async (req, res) => {
  const { projectId, architectureId } = req.params;
  const start = Date.now();
  try {
    const entries = await generateAllOas(projectId, architectureId);
    if (entries.length === 0) {
      res.status(404).json({
        error: {
          code: 404,
          message: 'This architecture has no interfaces to export.',
        },
      });
      return;
    }

    const zipEntries: ZipEntry[] = [];
    const usedSlugs = new Set<string>();
    const manifest = {
      architecture_id: architectureId,
      project_id: projectId,
      generator: 'haikai-oas-export',
      interfaces: [] as Array<Record<string, unknown>>,
    };

    for (const entry of entries) {
      let slug = slugifyFilename(entry.interfaceName);
      let suffix = 2;
      while (usedSlugs.has(slug)) {
        slug = `${slugifyFilename(entry.interfaceName)}-${suffix}`;
        suffix += 1;
      }
      usedSlugs.add(slug);

      if (entry.result) {
        zipEntries.push({
          path: `${slug}.openapi.json`,
          content: JSON.stringify(entry.result.document, null, 2),
        });
        zipEntries.push({
          path: `${slug}.gaps.json`,
          content: JSON.stringify(entry.result.gapReport, null, 2),
        });
        manifest.interfaces.push({
          interface_id: entry.interfaceId,
          name: entry.interfaceName,
          status: 'generated',
          file: `${slug}.openapi.json`,
          gaps_file: `${slug}.gaps.json`,
          endpoints_mapped: entry.result.summary.mappedEndpointCount,
          endpoints_total: entry.result.summary.endpointCount,
          gap_counts: entry.result.summary.gapCounts,
        });
      } else {
        manifest.interfaces.push({
          interface_id: entry.interfaceId,
          name: entry.interfaceName,
          status: 'failed',
          error: entry.error ?? 'Unknown error',
        });
      }
    }

    zipEntries.unshift({
      path: 'manifest.json',
      content: JSON.stringify(manifest, null, 2),
    });

    const archive = buildZipArchive(zipEntries);
    const failedCount = entries.filter((e) => !e.result).length;
    console.log(
      `[diag-gw] route=oas-export-download status=200 interfaces=${entries.length} ` +
        `failed=${failedCount} bytes=${archive.length} elapsed_ms=${Date.now() - start}`
    );
    res.status(200);
    res.setHeader('content-type', 'application/zip');
    res.setHeader(
      'content-disposition',
      `attachment; filename="interface-contracts-${architectureId}.zip"`
    );
    res.send(archive);
  } catch (error) {
    mapError(error, res, 'download', { projectId, architectureId });
  }
});
