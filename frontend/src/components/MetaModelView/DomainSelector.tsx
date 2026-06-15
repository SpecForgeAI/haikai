/**
 * DomainSelector Component
 *
 * Task Group 4: Architecture Domain Selector for Meta-Model View header.
 * Displays a segmented control with domain buttons. Each button shows an icon
 * and label. Selected domain is highlighted.
 *
 * Spec 2026-05-04 Comprehensive Frontend Routing -- Task Group 4
 *
 * Domain selection is now URL-driven. Clicking a domain button calls
 * `useNavigate` to push `/projects/:p/architectures/:a/metamodel/<urlValue>`
 * onto the history. The MetaModelView's URL -> reducer sync effect then
 * dispatches `SET_DOMAIN` so existing grid / palette / relationship
 * consumers (which still read `state.selectedDomain`) keep working.
 *
 * The active-button styling is read from the URL via
 * `useMetaModelDomain()` rather than `state.selectedDomain` so that the
 * highlighted button stays in lockstep with the URL during a back/forward
 * navigation (which Group 4's safety property e exercises).
 */

import { useNavigate } from 'react-router-dom';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import { useProject } from '../../contexts/ProjectContext';
import { internalDomainToUrl, useMetaModelDomain } from '../../hooks/useCurrentView';
import {
  ArchitectureDomain,
  ALL_DOMAINS,
  DOMAIN_LABELS,
  DOMAIN_ICONS,
} from '../../types/architectureDomain';
import styles from './DomainSelector.module.css';

export function DomainSelector() {
  const activeProject = useProject();
  const activeArchitectureId = useActiveArchitectureId();
  const currentDomain = useMetaModelDomain();
  const navigate = useNavigate();

  const handleDomainClick = (domain: ArchitectureDomain) => {
    if (domain === currentDomain) return;
    if (!activeProject?.id || !activeArchitectureId) return;

    const urlToken = internalDomainToUrl(domain);
    navigate(
      `/projects/${activeProject.id}/architectures/${activeArchitectureId}/metamodel/${urlToken}`
    );
  };

  return (
    <div className={styles.domainSelector}>
      {ALL_DOMAINS.map((domain) => {
        const Icon = DOMAIN_ICONS[domain];
        const isSelected = domain === currentDomain;

        return (
          <button
            key={domain}
            className={`${styles.domainButton} ${isSelected ? styles.selected : ''}`}
            onClick={() => handleDomainClick(domain)}
            title={DOMAIN_LABELS[domain]}
          >
            <Icon className={styles.domainIcon} size={16} />
            <span className={styles.domainLabel}>{DOMAIN_LABELS[domain]}</span>
          </button>
        );
      })}
    </div>
  );
}
