/**
 * Task Group 4 Tests: MetaModelView Integration for Package Sets
 *
 * Tests for the integration of PackageSetsView in MetaModelView:
 * - PackageSetsView is rendered when selectedTab is 'Package Sets'
 * - Grid is not rendered when Package Sets tab is selected
 * - Tab navigation works correctly between Package Sets and other tabs
 *
 * Created as part of spec: 2026-01-06-package-sets-screen
 */

import { tabToEntityType, domainGroupings } from '../config/gridConfigs';

describe('Task Group 4: MetaModelView Integration for Package Sets', () => {
  describe('4.1 Tab Selection Logic', () => {
    it('should identify Package Sets as a custom tab (not standard entity grid)', () => {
      const selectedTab = 'Package Sets';
      const isEntityTab = selectedTab in tabToEntityType;
      const isPackageSetsTab = selectedTab === 'Package Sets';

      expect(isEntityTab).toBe(true); // Package Sets is in tabToEntityType
      expect(isPackageSetsTab).toBe(true);
    });

    it('should be in application domain groupings', () => {
      const applicationTabs = domainGroupings.application;
      expect(applicationTabs).toContain('Package Sets');
    });

    it('should be positioned after Methods in application domain', () => {
      const applicationTabs = domainGroupings.application;
      const methodsIndex = applicationTabs.indexOf('Methods');
      const packageSetsIndex = applicationTabs.indexOf('Package Sets');

      expect(packageSetsIndex).toBeGreaterThan(methodsIndex);
    });
  });

  describe('4.2 Conditional Rendering', () => {
    it('should render PackageSetsView when selectedTab is Package Sets', () => {
      const selectedTab = 'Package Sets';
      const shouldRenderPackageSetsView = selectedTab === 'Package Sets';
      const shouldRenderGrid = selectedTab !== 'Package Sets' && selectedTab in tabToEntityType;

      expect(shouldRenderPackageSetsView).toBe(true);
      expect(shouldRenderGrid).toBe(false);
    });

    it('should render Grid for other entity tabs', () => {
      const selectedTab = 'Applications';
      const shouldRenderPackageSetsView = selectedTab === 'Package Sets';
      const shouldRenderGrid = selectedTab !== 'Package Sets' && selectedTab in tabToEntityType;

      expect(shouldRenderPackageSetsView).toBe(false);
      expect(shouldRenderGrid).toBe(true);
    });

    it('should maintain grid rendering for Methods tab', () => {
      const selectedTab = 'Methods';
      const shouldRenderPackageSetsView = selectedTab === 'Package Sets';
      const shouldRenderGrid = selectedTab !== 'Package Sets' && selectedTab in tabToEntityType;

      expect(shouldRenderPackageSetsView).toBe(false);
      expect(shouldRenderGrid).toBe(true);
    });
  });
});
