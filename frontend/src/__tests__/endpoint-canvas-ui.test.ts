/**
 * Canvas and UI Layer Tests for Endpoint Entity
 * Task Group 6: Tests for canvas rendering and UI integration
 */

import { ENTITY_TYPES } from '../types/model';
import { shouldRenderAsContract, supportsContractRendering } from '../utils/erdUtils';

describe('Canvas and UI Layer for Endpoint Entity', () => {
  describe('shouldRenderAsContract helper', () => {
    it('should return true for INTERFACE with contract render_style', () => {
      const node = {
        entity_type: ENTITY_TYPES.INTERFACE,
        render_style: 'contract' as const,
      };

      expect(shouldRenderAsContract(node)).toBe(true);
    });

    it('should return false for INTERFACE with standard render_style', () => {
      const node = {
        entity_type: ENTITY_TYPES.INTERFACE,
        render_style: 'standard' as const,
      };

      expect(shouldRenderAsContract(node)).toBe(false);
    });

    it('should return false for non-INTERFACE with contract render_style', () => {
      const node = {
        entity_type: ENTITY_TYPES.SERVICE,
        render_style: 'contract' as const,
      };

      expect(shouldRenderAsContract(node)).toBe(false);
    });

    it('should return false for INTERFACE with undefined render_style', () => {
      const node = {
        entity_type: ENTITY_TYPES.INTERFACE,
      };

      expect(shouldRenderAsContract(node)).toBe(false);
    });
  });

  describe('supportsContractRendering', () => {
    it('should return true for INTERFACE entity type', () => {
      expect(supportsContractRendering(ENTITY_TYPES.INTERFACE)).toBe(true);
    });

    it('should return false for APPLICATION entity type', () => {
      expect(supportsContractRendering(ENTITY_TYPES.APPLICATION)).toBe(false);
    });

    it('should return false for SERVICE entity type', () => {
      expect(supportsContractRendering(ENTITY_TYPES.SERVICE)).toBe(false);
    });

    it('should return false for ENDPOINT entity type', () => {
      expect(supportsContractRendering(ENTITY_TYPES.ENDPOINT)).toBe(false);
    });
  });
});
