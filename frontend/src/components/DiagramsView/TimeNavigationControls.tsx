/**
 * TimeNavigationControls Component
 * Provides time navigation with period selector and previous/next buttons
 */

import { useState } from 'react';
import { PeriodSelector, PeriodType } from './PeriodSelector';
import { addQuarters, formatPeriodLabel, quarterToHalf, quarterToYear } from '../../utils/quarterUtils';
import styles from './DiagramsView.module.css';

interface TimeNavigationControlsProps {
  currentQuarter: string;
  onNavigate: (newQuarter: string) => void;
}

export function TimeNavigationControls({ currentQuarter, onNavigate }: TimeNavigationControlsProps) {
  const [periodType, setPeriodType] = useState<PeriodType>('Quarter');

  /**
   * Calculate the navigation delta based on period type
   * Quarter: 1 quarter, Half: 2 quarters, Year: 4 quarters
   */
  const getNavigationDelta = (): number => {
    switch (periodType) {
      case 'Quarter':
        return 1;
      case 'Half':
        return 2;
      case 'Year':
        return 4;
      default:
        return 1;
    }
  };

  /**
   * Navigate to previous period
   */
  const handlePrevious = () => {
    const delta = getNavigationDelta();
    const newQuarter = addQuarters(currentQuarter, -delta);
    onNavigate(newQuarter);
  };

  /**
   * Navigate to next period
   */
  const handleNext = () => {
    const delta = getNavigationDelta();
    const newQuarter = addQuarters(currentQuarter, delta);
    onNavigate(newQuarter);
  };

  /**
   * Handle period type change
   * When switching period types, adjust the current quarter to align with the new period
   */
  const handlePeriodTypeChange = (newPeriodType: PeriodType) => {
    setPeriodType(newPeriodType);

    // Adjust current quarter to align with new period type
    let adjustedQuarter = currentQuarter;
    try {
      if (newPeriodType === 'Half') {
        adjustedQuarter = quarterToHalf(currentQuarter);
      } else if (newPeriodType === 'Year') {
        adjustedQuarter = quarterToYear(currentQuarter);
      }

      // Only update if the quarter changed
      if (adjustedQuarter !== currentQuarter) {
        onNavigate(adjustedQuarter);
      }
    } catch (error) {
      console.error('Error adjusting quarter for new period type:', error);
    }
  };

  // Format the label based on current period type
  const periodLabel = formatPeriodLabel(currentQuarter, periodType);

  return (
    <div className={styles.timeNavigationControls}>
      <label className={styles.selectorLabel}>Period:</label>
      <PeriodSelector value={periodType} onChange={handlePeriodTypeChange} />
      <button
        className={styles.timeNavButton}
        onClick={handlePrevious}
        aria-label="Previous period"
        title="Previous period"
      >
        &lt;
      </button>
      <span className={styles.periodLabel}>{periodLabel}</span>
      <button
        className={styles.timeNavButton}
        onClick={handleNext}
        aria-label="Next period"
        title="Next period"
      >
        &gt;
      </button>
    </div>
  );
}
