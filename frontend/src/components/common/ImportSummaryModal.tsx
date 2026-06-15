/**
 * ImportSummaryModal Component
 *
 * Displays import results after Excel meta-model import.
 * Shows per-worksheet summary with counts and validation errors.
 *
 * Spec 2026-01-11: Redesign Import as XLSX for Architecture Meta-Model
 * - Added support for rowsUpdated count in worksheet results
 * - Added totalRowsUpdated to overall summary
 * - Enhanced validation error display with row number, field name, unresolved value
 * - Mode-specific display: show Updated column only in Overwrite mode
 */

import { Modal } from './Modal';
import { ImportResult, WorksheetImportResult } from '../../utils/excelOperations';
import styles from './ImportSummaryModal.module.css';

interface ImportSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  importResult: ImportResult | null;
}

/**
 * Get status indicator based on results
 *
 * Spec 2026-01-11: Updated to consider rowsUpdated
 */
function getStatusIndicator(result: WorksheetImportResult): { color: string; text: string } {
  if (result.errors.length > 0) {
    return { color: '#d32f2f', text: 'Has Errors' };
  }
  if (result.rowsImported > 0 || (result.rowsUpdated || 0) > 0) {
    return { color: '#2e7d32', text: 'Success' };
  }
  return { color: '#666', text: 'No Data' };
}

/**
 * Calculate total counts across all worksheets
 *
 * Spec 2026-01-11: Added totalUpdated calculation
 */
function calculateTotals(results: WorksheetImportResult[]): {
  totalImported: number;
  totalSkipped: number;
  totalUpdated: number;
  totalErrors: number;
} {
  return results.reduce(
    (acc, r) => ({
      totalImported: acc.totalImported + r.rowsImported,
      totalSkipped: acc.totalSkipped + r.rowsSkipped,
      totalUpdated: acc.totalUpdated + (r.rowsUpdated || 0),
      totalErrors: acc.totalErrors + r.errors.length,
    }),
    { totalImported: 0, totalSkipped: 0, totalUpdated: 0, totalErrors: 0 }
  );
}

export function ImportSummaryModal({ isOpen, onClose, importResult }: ImportSummaryModalProps) {
  if (!importResult) {
    return null;
  }

  const { worksheetResults, ignoredWorksheets, success, mode } = importResult;
  const totals = calculateTotals(worksheetResults);

  // Spec 2026-01-11: Determine if we should show the Updated column (only in Overwrite mode)
  const showUpdatedColumn = mode === 'overwrite';

  // Filter for worksheets that have actual results
  const entityResults = worksheetResults.filter((r) => !r.isRelationship && r.entityType);
  const relationshipResults = worksheetResults.filter((r) => r.isRelationship && r.entityType);

  // Collect all errors grouped by worksheet
  const worksheetsWithErrors = worksheetResults.filter((r) => r.errors.length > 0);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Summary">
      <div className={styles.container}>
        {/* Overall Status */}
        <div className={styles.overallStatus}>
          {success ? (
            <span className={styles.successBadge}>Import Complete</span>
          ) : (
            <span className={styles.errorBadge}>Import Failed</span>
          )}
        </div>

        {/* Summary Counts */}
        <div className={styles.summaryRow}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryCount}>{totals.totalImported}</span>
            <span className={styles.summaryLabel}>Rows Imported</span>
          </div>
          {/* Spec 2026-01-11: Show Updated count only in Overwrite mode */}
          {showUpdatedColumn && (
            <div className={styles.summaryItem}>
              <span className={styles.summaryCount}>{totals.totalUpdated}</span>
              <span className={styles.summaryLabel}>Rows Updated</span>
            </div>
          )}
          <div className={styles.summaryItem}>
            <span className={styles.summaryCount}>{totals.totalSkipped}</span>
            <span className={styles.summaryLabel}>Rows Skipped</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryCount}>{totals.totalErrors}</span>
            <span className={styles.summaryLabel}>Errors</span>
          </div>
        </div>

        {/* Entity Worksheets */}
        {entityResults.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Entities</h3>
            <table className={styles.resultsTable}>
              <thead>
                <tr>
                  <th>Worksheet</th>
                  <th>Imported</th>
                  {showUpdatedColumn && <th>Updated</th>}
                  <th>Skipped</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {entityResults.map((result) => {
                  const status = getStatusIndicator(result);
                  return (
                    <tr key={result.worksheetName}>
                      <td>{result.worksheetName}</td>
                      <td className={styles.countCell}>{result.rowsImported}</td>
                      {showUpdatedColumn && (
                        <td className={styles.countCell}>{result.rowsUpdated || 0}</td>
                      )}
                      <td className={styles.countCell}>{result.rowsSkipped}</td>
                      <td>
                        <span style={{ color: status.color }}>{status.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Relationship Worksheets */}
        {relationshipResults.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Relationships</h3>
            <table className={styles.resultsTable}>
              <thead>
                <tr>
                  <th>Worksheet</th>
                  <th>Imported</th>
                  {showUpdatedColumn && <th>Updated</th>}
                  <th>Skipped</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {relationshipResults.map((result) => {
                  const status = getStatusIndicator(result);
                  return (
                    <tr key={result.worksheetName}>
                      <td>{result.worksheetName}</td>
                      <td className={styles.countCell}>{result.rowsImported}</td>
                      {showUpdatedColumn && (
                        <td className={styles.countCell}>{result.rowsUpdated || 0}</td>
                      )}
                      <td className={styles.countCell}>{result.rowsSkipped}</td>
                      <td>
                        <span style={{ color: status.color }}>{status.text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Ignored Worksheets */}
        {ignoredWorksheets.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Ignored Worksheets</h3>
            <p className={styles.ignoredNote}>
              The following worksheets were not recognized and skipped:
            </p>
            <ul className={styles.ignoredList}>
              {ignoredWorksheets.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Error Details */}
        {/* Spec 2026-01-11: Enhanced validation error display */}
        {worksheetsWithErrors.length > 0 && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Validation Errors</h3>
            {worksheetsWithErrors.map((result) => (
              <div key={result.worksheetName} className={styles.errorGroup}>
                <h4 className={styles.errorGroupTitle}>{result.worksheetName}</h4>
                <ul className={styles.errorList}>
                  {result.errors.map((error, index) => (
                    <li key={index} className={styles.errorItem}>
                      <span className={styles.errorRow}>Row {error.row}:</span>
                      {error.field && (
                        <span className={styles.errorField}>[{error.field}]</span>
                      )}
                      <span className={styles.errorMessage}>{error.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
