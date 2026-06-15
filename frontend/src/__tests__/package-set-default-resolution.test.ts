/**
 * Tests for Package Set Default Resolution Display
 * Spec: Package Set Standards Import (Iteration 6) - Task Group 6
 *
 * Tests the resolution logic for determining which PackageSet to display
 * when a Service has package_set_id = null ("Default (Auto)" mode).
 */

import { resolveDefaultPackageSetId, PackageSetDefaultRule } from '../types/packageSetStandards';
import { PackageSet } from '../types/model';

describe('Package Set Default Resolution', () => {
  // Sample package sets for testing
  const samplePackageSets: PackageSet[] = [
    { id: 'ps-java-spring', name: 'Java Spring Boot Standard', standard_source: 'COMPANY', standard_key: 'java-spring' },
    { id: 'ps-nodejs', name: 'Node.js Standard', standard_source: 'COMPANY', standard_key: 'nodejs' },
    { id: 'ps-python', name: 'Python Standard', standard_source: 'PROJECT', standard_key: 'python' },
    { id: 'ps-java-api', name: 'Java REST API Project', standard_source: 'PROJECT', standard_key: 'java-api' },
  ];

  // Sample rules sorted by priority descending
  const sampleRules: PackageSetDefaultRule[] = [
    // Priority 3: Very specific rule (PROJECT)
    {
      id: 'rule-1',
      standard_source: 'PROJECT',
      package_set_id: 'ps-java-api',
      core_tech_includes: ['java', 'spring'],
      service_type_includes: ['api'],
      priority: 3,
    },
    // Priority 2: Moderately specific rule (COMPANY)
    {
      id: 'rule-2',
      standard_source: 'COMPANY',
      package_set_id: 'ps-java-spring',
      core_tech_includes: ['java', 'spring'],
      service_type_includes: [],
      priority: 2,
    },
    // Priority 2: Same priority as rule-2 but PROJECT (should win tie-breaker)
    {
      id: 'rule-3',
      standard_source: 'PROJECT',
      package_set_id: 'ps-python',
      core_tech_includes: ['python'],
      service_type_includes: ['backend'],
      priority: 2,
    },
    // Priority 1: Less specific rule (COMPANY)
    {
      id: 'rule-4',
      standard_source: 'COMPANY',
      package_set_id: 'ps-nodejs',
      core_tech_includes: ['node'],
      service_type_includes: [],
      priority: 1,
    },
    // Priority 0: Catch-all rule (matches everything)
    {
      id: 'rule-5',
      standard_source: 'COMPANY',
      package_set_id: 'ps-java-spring',
      core_tech_includes: [],
      service_type_includes: [],
      priority: 0,
    },
  ];

  describe('resolveDefaultPackageSetId', () => {
    it('should select highest priority matching rule', () => {
      const service = {
        core_tech: 'Java, Spring Boot, PostgreSQL',
        service_type: 'REST API',
      };

      // Should match rule-1 (priority 3) because it matches both java+spring and api
      const result = resolveDefaultPackageSetId(service, sampleRules);
      expect(result).toBe('ps-java-api');
    });

    it('should return null when no rules match', () => {
      const service = {
        core_tech: 'Rust',
        service_type: 'CLI Tool',
      };

      // No rules match Rust, but the catch-all rule (priority 0) has empty arrays
      // Empty arrays match trivially, so it should return the catch-all
      const rulesWithoutCatchAll = sampleRules.filter(r => r.priority > 0);
      const result = resolveDefaultPackageSetId(service, rulesWithoutCatchAll);
      expect(result).toBeNull();
    });

    it('should match with case-insensitive comparison', () => {
      const service = {
        core_tech: 'JAVA, SPRING BOOT',
        service_type: 'REST API',
      };

      // Should still match even with uppercase
      const result = resolveDefaultPackageSetId(service, sampleRules);
      expect(result).toBe('ps-java-api');
    });

    it('should handle empty core_tech and service_type', () => {
      const service = {
        core_tech: '',
        service_type: '',
      };

      // Should match the catch-all rule (priority 0, empty arrays)
      const result = resolveDefaultPackageSetId(service, sampleRules);
      expect(result).toBe('ps-java-spring'); // catch-all rule's package set
    });

    it('should handle undefined core_tech and service_type', () => {
      const service = {};

      // Should match the catch-all rule
      const result = resolveDefaultPackageSetId(service, sampleRules);
      expect(result).toBe('ps-java-spring');
    });

    it('should require ALL keywords to be present for a match', () => {
      const service = {
        core_tech: 'Java', // Only Java, no Spring
        service_type: 'REST API',
      };

      // rule-1 requires both 'java' AND 'spring' in core_tech, so it won't match
      // rule-2 requires both 'java' AND 'spring', so it won't match either
      // rule-4 requires 'node', won't match
      // Only catch-all should match
      const result = resolveDefaultPackageSetId(service, sampleRules);
      expect(result).toBe('ps-java-spring'); // catch-all
    });

    it('should match empty arrays trivially (catch-all behavior)', () => {
      const rulesOnlyCatchAll: PackageSetDefaultRule[] = [
        {
          id: 'catch-all',
          standard_source: 'COMPANY',
          package_set_id: 'ps-default',
          core_tech_includes: [],
          service_type_includes: [],
          priority: 0,
        },
      ];

      const service = {
        core_tech: 'Any Technology',
        service_type: 'Any Type',
      };

      const result = resolveDefaultPackageSetId(service, rulesOnlyCatchAll);
      expect(result).toBe('ps-default');
    });
  });

  describe('Rule sorting and priority', () => {
    it('should be processed in order (rules pre-sorted by priority DESC)', () => {
      // Rules are expected to be pre-sorted by backend
      // First matching rule wins
      const service = {
        core_tech: 'Python, Flask',
        service_type: 'Backend Service',
      };

      // Should match rule-3 (priority 2, python + backend)
      const result = resolveDefaultPackageSetId(service, sampleRules);
      expect(result).toBe('ps-python');
    });

    it('should handle tie-breaker: PROJECT source wins over COMPANY for same priority', () => {
      // Create rules where PROJECT and COMPANY have same priority
      const tieBreakRules: PackageSetDefaultRule[] = [
        // PROJECT rule first (should win due to sort order reflecting tie-breaker)
        {
          id: 'project-rule',
          standard_source: 'PROJECT',
          package_set_id: 'ps-project',
          core_tech_includes: ['go'],
          service_type_includes: [],
          priority: 5,
        },
        // COMPANY rule with same priority (should lose)
        {
          id: 'company-rule',
          standard_source: 'COMPANY',
          package_set_id: 'ps-company',
          core_tech_includes: ['go'],
          service_type_includes: [],
          priority: 5,
        },
      ];

      const service = {
        core_tech: 'Go, Gin',
        service_type: 'API',
      };

      // When rules are sorted by priority DESC, then by source (PROJECT > COMPANY),
      // the PROJECT rule should come first and be returned
      const result = resolveDefaultPackageSetId(service, tieBreakRules);
      expect(result).toBe('ps-project');
    });
  });

  describe('Display text formatting', () => {
    /**
     * Helper to format display text based on resolution result.
     * This is the logic that PackageSetCell will use.
     */
    function formatDefaultDisplayText(
      resolvedPackageSetId: string | null,
      packageSets: PackageSet[]
    ): string {
      if (resolvedPackageSetId) {
        const packageSet = packageSets.find(ps => ps.id === resolvedPackageSetId);
        const name = packageSet?.name || 'Unknown';
        return `Default (Auto) -> ${name}`;
      }
      return 'Default (Auto) (no match)';
    }

    it('should show "Default (Auto) -> <Name>" when matched', () => {
      const resolvedId = 'ps-java-spring';
      const displayText = formatDefaultDisplayText(resolvedId, samplePackageSets);
      expect(displayText).toBe('Default (Auto) -> Java Spring Boot Standard');
    });

    it('should show "Default (Auto) (no match)" when unmatched', () => {
      const resolvedId = null;
      const displayText = formatDefaultDisplayText(resolvedId, samplePackageSets);
      expect(displayText).toBe('Default (Auto) (no match)');
    });

    it('should show "Default (Auto) -> Unknown" when package set not found', () => {
      const resolvedId = 'non-existent-id';
      const displayText = formatDefaultDisplayText(resolvedId, samplePackageSets);
      expect(displayText).toBe('Default (Auto) -> Unknown');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty rules array', () => {
      const service = {
        core_tech: 'Java',
        service_type: 'API',
      };

      const result = resolveDefaultPackageSetId(service, []);
      expect(result).toBeNull();
    });

    it('should handle substring matching correctly', () => {
      const rules: PackageSetDefaultRule[] = [
        {
          id: 'rule-java',
          standard_source: 'COMPANY',
          package_set_id: 'ps-java',
          core_tech_includes: ['java'],
          service_type_includes: [],
          priority: 1,
        },
      ];

      // 'javascript' contains 'java', so this should match
      const serviceJs = {
        core_tech: 'JavaScript, Node.js',
        service_type: 'API',
      };
      expect(resolveDefaultPackageSetId(serviceJs, rules)).toBe('ps-java');

      // But searching for 'javascript' shouldn't match 'java'
      const rulesJs: PackageSetDefaultRule[] = [
        {
          id: 'rule-js',
          standard_source: 'COMPANY',
          package_set_id: 'ps-js',
          core_tech_includes: ['javascript'],
          service_type_includes: [],
          priority: 1,
        },
      ];
      const serviceJava = {
        core_tech: 'Java, Spring',
        service_type: 'API',
      };
      expect(resolveDefaultPackageSetId(serviceJava, rulesJs)).toBeNull();
    });
  });
});
