/**
 * PaletteDomainSelector Component
 *
 * Task Group 5: Domain selector for Diagram Palette panel.
 * Compact icon-only buttons for switching architecture domains.
 * Positioned at the top of the palette panel, below the header.
 */

import { useArchitecture, useArchitectureDispatch } from '../../contexts/ArchitectureContext';
import {
  ArchitectureDomain,
  ALL_DOMAINS,
  DOMAIN_LABELS,
  DOMAIN_ICONS,
} from '../../types/architectureDomain';
import styles from './PaletteDomainSelector.module.css';

export function PaletteDomainSelector() {
  const state = useArchitecture();
  const dispatch = useArchitectureDispatch();

  const handleDomainClick = (domain: ArchitectureDomain) => {
    if (domain !== state.selectedDomain) {
      dispatch({ type: 'SET_DOMAIN', payload: domain });
    }
  };

  return (
    <div className={styles.domainSelector}>
      {ALL_DOMAINS.map((domain) => {
        const Icon = DOMAIN_ICONS[domain];
        const isSelected = domain === state.selectedDomain;

        return (
          <button
            key={domain}
            className={`${styles.domainButton} ${isSelected ? styles.selected : ''}`}
            onClick={() => handleDomainClick(domain)}
            title={DOMAIN_LABELS[domain]}
          >
            <Icon className={styles.domainIcon} size={14} />
          </button>
        );
      })}
    </div>
  );
}
