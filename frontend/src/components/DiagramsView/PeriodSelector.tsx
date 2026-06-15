/**
 * PeriodSelector Component
 * Dropdown to select period type (Quarter, Half, Year) for time navigation
 */

import React from 'react';
import styles from './DiagramsView.module.css';

export type PeriodType = 'Quarter' | 'Half' | 'Year';

interface PeriodSelectorProps {
  value: PeriodType;
  onChange: (value: PeriodType) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(event.target.value as PeriodType);
  };

  return (
    <select
      className={styles.selector}
      value={value}
      onChange={handleChange}
      aria-label="Period type"
    >
      <option value="Quarter">Quarter</option>
      <option value="Half">Half</option>
      <option value="Year">Year</option>
    </select>
  );
}
