/**
 * Dead Code Removal Verification Tests
 *
 * Spec 2026-04-07: Extension Pack Framework & LLM File Analysis
 * Task Group 12: Dead Code Removal
 * Task 12.1: Verification tests that dead code is gone
 */

import fs from 'fs';
import path from 'path';

const SERVICES_DIR = path.resolve(__dirname, '..', 'services');
const TYPES_DIR = path.resolve(__dirname, '..', 'types');

describe('Dead Code Removal Verification', () => {

  test('removed clustering and candidate generation module files do not exist on disk', () => {
    // Clustering modules
    const removedFiles = [
      path.join(SERVICES_DIR, 'clusteringEngine.ts'),
      path.join(SERVICES_DIR, 'clusteringRuleRegistry.ts'),
      path.join(SERVICES_DIR, 'clusterTriageEngine.ts'),
      path.join(SERVICES_DIR, 'candidateGenerationEngine.ts'),
      path.join(SERVICES_DIR, 'candidateGenerationRuleRegistry.ts'),
      path.join(SERVICES_DIR, 'candidateTriageEngine.ts'),
      // Type files
      path.join(TYPES_DIR, 'clusteringRule.ts'),
      path.join(TYPES_DIR, 'candidateGenerationRule.ts'),
    ];

    // Clustering rules directory
    const removedDirs = [
      path.join(SERVICES_DIR, 'clusteringRules'),
      path.join(SERVICES_DIR, 'candidateGenerationRules'),
    ];

    for (const filePath of removedFiles) {
      expect(fs.existsSync(filePath)).toBe(false);
    }

    for (const dirPath of removedDirs) {
      expect(fs.existsSync(dirPath)).toBe(false);
    }
  });

  test('DecisionTaskTypeString union in gateway contains only 1b types and file_analysis', () => {
    // We verify this by importing the type and checking the PROMPT_TEMPLATE_FILES map keys
    // Since we can't directly introspect a TypeScript union at runtime, we verify
    // that the prompt template map contains only the expected entries.
    //
    // The PROMPT_TEMPLATE_FILES map is a const in discoveryDecisionTaskPrompts.ts.
    // We verify by reading the file content and checking no dead types appear.

    const promptsFilePath = path.resolve(
      __dirname, '..', '..', '..', 'gateway', 'src', 'routes', 'discoveryDecisionTaskPrompts.ts'
    );

    const content = fs.readFileSync(promptsFilePath, 'utf-8');

    // Dead 1c/1d types that should NOT appear in the DecisionTaskTypeString union
    const deadTypes = [
      'cluster_merge_decision',
      'cluster_type_classification',
      'cluster_anchor_assignment',
      'cluster_noise_decision',
      'candidate_type_classification',
      'candidate_parent_assignment',
      'candidate_name_refinement',
      'candidate_merge_decision',
      'candidate_rejection_review',
    ];

    for (const deadType of deadTypes) {
      // Check that the dead type does not appear as a union member (e.g., | 'cluster_merge_decision')
      const unionPattern = new RegExp(`'${deadType}'`, 'g');
      const matches = content.match(unionPattern);
      expect(matches).toBeNull();
    }

    // Verify the kept types ARE present
    expect(content).toContain("'confirm_relationship'");
    expect(content).toContain("'resolve_competing_relationships'");
  });
});
