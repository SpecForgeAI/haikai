/**
 * DashboardSkeleton
 *
 * Spec 2026-02-18: Dashboard Increment 6 -- Task 1.3
 * Spec 2026-03-06: Dashboard UX Improvements -- Task Group 4 (updated sub-section layout)
 *
 * Full-page loading skeleton for the DashboardView.
 * Mirrors the full dashboard structure:
 * - Header summary bar skeleton
 * - Strategic Foundation section heading + Product (2 cards) + Technical (3 cards)
 * - Scope control bar skeleton
 * - Detailed D&D section heading + Pre-Coding subheading + 3 skeleton cards
 * - Post-Coding subheading + 3 skeleton cards
 *
 * Total: 11 skeleton cards + 1 header bar + 1 scope bar + 4 heading/subheading placeholders
 */
import React from 'react';
import styles from './DashboardView.module.css';

const SkeletonCard: React.FC = () => (
  <div className={styles.skeletonCard}>
    <div className={`${styles.skeletonBar} ${styles.skeletonBarTitle}`}></div>
    <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric1}`}></div>
    <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric2}`}></div>
    <div className={`${styles.skeletonBar} ${styles.skeletonBarMetric3}`}></div>
  </div>
);

export const DashboardSkeleton: React.FC = () => {
  return (
    <div data-testid="dashboard-skeleton">
      {/* Header Summary skeleton */}
      <div className={styles.skeletonHeaderBar} />

      {/* Strategic Foundation heading placeholder */}
      <div className={styles.skeletonSectionHeading} />

      {/* Strategic Foundation: Product sub-section (2 cards) */}
      <div className={styles.subSectionGroup}>
        <span className={styles.subSectionGroupLabel}>Product</span>
        <div className={styles.detailGrid}>
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>

      {/* Strategic Foundation: Technical sub-section (3 cards) */}
      <div className={styles.subSectionGroup}>
        <span className={styles.subSectionGroupLabel}>Technical</span>
        <div className={styles.detailGrid}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>

      {/* Scope control bar skeleton */}
      <div className={styles.skeletonScopeBar} />

      {/* Detailed D&D heading placeholder */}
      <div className={styles.skeletonSectionHeading} />

      {/* Pre-Coding subheading placeholder */}
      <div className={styles.skeletonSectionHeading} />

      {/* Pre-Coding grid: 3 skeleton cards */}
      <div className={styles.detailGrid}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>

      {/* Post-Coding subheading placeholder */}
      <div className={styles.skeletonSectionHeading} />

      {/* Post-Coding grid: 3 skeleton cards */}
      <div className={styles.detailGrid}>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
};
