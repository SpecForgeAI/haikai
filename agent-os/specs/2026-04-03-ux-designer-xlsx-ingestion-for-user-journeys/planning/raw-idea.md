# Raw Idea: UX Designer XLSX Ingestion for User Journeys

## Summary
Add native .xlsx workbook ingestion to the UX Designer "Define User Journeys" flow so users can upload a single Excel file containing the three agreed worksheets ("Process Activities", "User Journeys", "Activity Steps") instead of providing CSVs or pasted tabular text.

## Motivation
- Increments 1-9 establish the full meta-model, save, diagram, and sync pipeline
- The remaining gap is input UX: business users naturally work in Excel workbooks
- Increment 10 upgrades the ingestion path without changing core architecture

## Scope
- Upload single .xlsx workbook with three required worksheets
- Deterministic code-based parsing (not LLM)
- Normalize into structured payload for existing conversation flow
- Preserve CSV/paste fallback

## Out of Scope
- Macro execution, write-back, template generation, arbitrary formats
- XLS legacy format, OCR, general-purpose XLSX for other personas
- Changes to meta-model, save pipeline, or diagram rendering/sync
