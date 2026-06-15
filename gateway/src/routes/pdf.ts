/**
 * PDF Export Route
 *
 * POST /generate - Generates a multi-page PDF from pre-enriched diagram data
 *   sent by the frontend. Returns the PDF as a binary download.
 *
 * GET /generate/:projectId - Standalone PDF generation from a projectId alone.
 *   Fetches all diagrams and meta-model data from the architecture-model-service,
 *   performs enrichment server-side, and returns the PDF as a binary download.
 *   Useful for regenerating PDFs without the frontend UI.
 */

import { Router, Request, Response } from 'express';
import fs from 'fs';

import { fetchProjectFolder } from '../services/architectureModelClient';
import { generatePdf } from '../services/pdf/pdfGenerator';
import { buildPdfRequestFromProject } from '../services/pdf/pdfDataFetcher';
import { logger } from '../services/logger';

import type { PdfGenerationRequest } from '../services/pdf/types';

export const pdfRouter = Router();

pdfRouter.post('/generate', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';

  try {
    // Validate request body
    const body = req.body as PdfGenerationRequest;
    if (!body.projectId || typeof body.projectId !== 'string' || body.projectId.trim() === '') {
      return res.status(400).json({ error: 'projectId is required' });
    }
    if (!body.groups || !Array.isArray(body.groups) || body.groups.length === 0) {
      return res.status(400).json({ error: 'groups array is required and must not be empty' });
    }
    if (!body.projectName || typeof body.projectName !== 'string') {
      return res.status(400).json({ error: 'projectName is required' });
    }

    logger.info('PDF generation requested', {
      requestId,
      projectId: body.projectId,
      groupCount: body.groups.length,
      diagramCount: body.groups.reduce((sum, g) => sum + g.diagrams.length, 0),
    });

    // Resolve project folder for output
    const projectFolder = await fetchProjectFolder(body.projectId);
    if (!projectFolder) {
      return res.status(404).json({ error: 'Could not resolve project folder for the given projectId' });
    }

    const outputDir = `${projectFolder}/exports`;

    // Generate PDF
    const result = await generatePdf(body, outputDir);

    if (!result.success || !result.filePath) {
      return res.status(500).json({ error: result.error || 'PDF generation failed' });
    }

    logger.info('PDF generated, sending as download', { requestId, filePath: result.filePath });

    // Send the PDF as a binary download response
    const pdfBuffer = await fs.promises.readFile(result.filePath);
    const filename = result.filePath.split(/[/\\]/).pop() || 'User Journey Diagrams.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Pdf-File-Path', result.filePath);
    res.send(pdfBuffer);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('PDF generation route error', { requestId, error: errorMsg });
    res.status(500).json({ error: `PDF generation failed: ${errorMsg}` });
  }
});

/**
 * GET /generate/:projectId
 *
 * Standalone PDF generation. Fetches all journey diagrams and meta-model data
 * from the architecture-model-service, enriches them server-side, generates
 * the PDF, and returns it as a binary download.
 *
 * No frontend or pre-enriched data needed — just the projectId.
 */
pdfRouter.get('/generate/:projectId', async (req: Request, res: Response) => {
  const requestId = (req as any).requestId || 'unknown';
  const { projectId } = req.params;

  try {
    if (!projectId || projectId.trim() === '') {
      return res.status(400).json({ error: 'projectId is required' });
    }

    logger.info('Standalone PDF generation requested', { requestId, projectId });

    const assembled = await buildPdfRequestFromProject(projectId);
    if (!assembled) {
      return res.status(404).json({ error: 'Could not assemble PDF data. Check that the project exists and has User Journey diagrams.' });
    }

    const { request, outputDir } = assembled;

    logger.info('PDF data assembled, generating', {
      requestId,
      projectId,
      groupCount: request.groups.length,
      diagramCount: request.groups.reduce((sum, g) => sum + g.diagrams.length, 0),
    });

    const result = await generatePdf(request, outputDir);

    if (!result.success || !result.filePath) {
      return res.status(500).json({ error: result.error || 'PDF generation failed' });
    }

    logger.info('Standalone PDF generated', { requestId, filePath: result.filePath });

    const pdfBuffer = await fs.promises.readFile(result.filePath);
    const filename = result.filePath.split(/[/\\]/).pop() || 'User Journey Diagrams.pdf';

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Pdf-File-Path', result.filePath);
    res.send(pdfBuffer);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('Standalone PDF generation route error', { requestId, error: errorMsg });
    res.status(500).json({ error: `PDF generation failed: ${errorMsg}` });
  }
});
