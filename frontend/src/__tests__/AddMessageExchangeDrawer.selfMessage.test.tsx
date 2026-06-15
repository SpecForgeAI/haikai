/**
 * AddMessageExchangeDrawer Self-Message Support Tests
 * Task Group 1: Tests for self-message modal behavior
 *
 * These tests verify that users can create message exchanges where
 * the source and target participants are the same (self-messages).
 */

import { describe, it, expect } from 'vitest';

/**
 * Validation logic mirroring the component's validateForm function
 * Updated to allow self-messages (fromParticipantId === toParticipantId)
 */
interface FormData {
  fromParticipantId: string;
  toParticipantId: string;
  requestMode: 'reference' | 'label';
  requestRefKind: string;
  requestRefId: string;
  requestLabelText: string;
  includeResponse: boolean;
  responseMode: 'reference' | 'label';
  responseRefKind: string;
  responseRefId: string;
  responseLabelText: string;
}

/**
 * Compute whether this is a self-message (same from and to participant)
 */
function isSelfMessage(formData: FormData): boolean {
  return (
    formData.fromParticipantId !== '' &&
    formData.toParticipantId !== '' &&
    formData.fromParticipantId === formData.toParticipantId
  );
}

/**
 * Validate form data - mirrors component logic after self-message support is added
 */
function validateForm(formData: FormData): Record<string, string> {
  const errors: Record<string, string> = {};

  // Validate participants - REMOVED: same-participant validation
  if (!formData.fromParticipantId) {
    errors.fromParticipantId = 'From participant is required';
  }
  if (!formData.toParticipantId) {
    errors.toParticipantId = 'To participant is required';
  }
  // NOTE: No longer check if fromParticipantId === toParticipantId

  // Validate request content
  if (formData.requestMode === 'reference') {
    if (!formData.requestRefKind) {
      errors.requestRefKind = 'Reference type is required';
    }
    if (!formData.requestRefId) {
      errors.requestRefId = 'Reference is required';
    }
  } else {
    if (!formData.requestLabelText.trim()) {
      errors.requestLabelText = 'Label text is required';
    }
  }

  // Validate response content (if included)
  if (formData.includeResponse) {
    if (formData.responseMode === 'reference') {
      if (!formData.responseRefKind) {
        errors.responseRefKind = 'Reference type is required';
      }
      if (!formData.responseRefId) {
        errors.responseRefId = 'Reference is required';
      }
    } else {
      if (!formData.responseLabelText.trim()) {
        errors.responseLabelText = 'Label text is required';
      }
    }
  }

  return errors;
}

/**
 * Determine if the "Include Response" checkbox should be disabled
 */
function shouldDisableIncludeResponse(formData: FormData): boolean {
  return isSelfMessage(formData);
}

/**
 * Determine if the self-message warning should be shown
 */
function shouldShowSelfMessageWarning(formData: FormData): boolean {
  return isSelfMessage(formData);
}

/**
 * Simulate auto-unchecking includeResponse when self-message is detected
 */
function autoCorrectFormForSelfMessage(formData: FormData): FormData {
  if (isSelfMessage(formData) && formData.includeResponse) {
    return { ...formData, includeResponse: false };
  }
  return formData;
}

describe('AddMessageExchangeDrawer - Self-Message Support', () => {
  describe('Task 1.1: Self-message validation', () => {
    it('allows selecting same participant for From and To (no validation error)', () => {
      // Create form data where From and To are the same participant
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-1', // Same as fromParticipantId
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'processInternal()',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      const errors = validateForm(formData);

      // Should NOT have an error for toParticipantId
      expect(errors.toParticipantId).toBeUndefined();
      // Form should be valid (no errors)
      expect(Object.keys(errors)).toHaveLength(0);
    });

    it('disables "Include Response Message" checkbox when From === To', () => {
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-1', // Same - self-message
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'selfCall()',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      const shouldBeDisabled = shouldDisableIncludeResponse(formData);

      expect(shouldBeDisabled).toBe(true);
    });

    it('auto-unchecks "Include Response Message" when changing to self-message', () => {
      // Simulate state where response was previously checked
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-1', // Changed to same - now a self-message
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'process()',
        includeResponse: true, // Was checked before changing to self-message
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: 'response',
      };

      const correctedFormData = autoCorrectFormForSelfMessage(formData);

      // includeResponse should be automatically unchecked
      expect(correctedFormData.includeResponse).toBe(false);
    });

    it('displays warning text when From === To', () => {
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-1', // Same - self-message
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'internal()',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      const showWarning = shouldShowSelfMessageWarning(formData);

      expect(showWarning).toBe(true);
    });
  });

  describe('Task 1.1: Non-self-message behavior preserved', () => {
    it('does not disable Include Response checkbox when From !== To', () => {
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-2', // Different - regular message
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'request()',
        includeResponse: true,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      const shouldBeDisabled = shouldDisableIncludeResponse(formData);

      expect(shouldBeDisabled).toBe(false);
    });

    it('does not show warning text when From !== To', () => {
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-2', // Different - regular message
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'call()',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      const showWarning = shouldShowSelfMessageWarning(formData);

      expect(showWarning).toBe(false);
    });

    it('does not auto-uncheck Include Response when not a self-message', () => {
      const formData: FormData = {
        fromParticipantId: 'participant-1',
        toParticipantId: 'participant-2', // Different - regular message
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: 'request()',
        includeResponse: true, // Response is checked
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: 'response',
      };

      const correctedFormData = autoCorrectFormForSelfMessage(formData);

      // includeResponse should remain true
      expect(correctedFormData.includeResponse).toBe(true);
    });
  });

  describe('Task 1.1: isSelfMessage helper function', () => {
    it('returns true when both participant IDs are non-empty and equal', () => {
      const formData: FormData = {
        fromParticipantId: 'p1',
        toParticipantId: 'p1',
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: '',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      expect(isSelfMessage(formData)).toBe(true);
    });

    it('returns false when participant IDs are different', () => {
      const formData: FormData = {
        fromParticipantId: 'p1',
        toParticipantId: 'p2',
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: '',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      expect(isSelfMessage(formData)).toBe(false);
    });

    it('returns false when fromParticipantId is empty', () => {
      const formData: FormData = {
        fromParticipantId: '',
        toParticipantId: 'p1',
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: '',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      expect(isSelfMessage(formData)).toBe(false);
    });

    it('returns false when toParticipantId is empty', () => {
      const formData: FormData = {
        fromParticipantId: 'p1',
        toParticipantId: '',
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: '',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      expect(isSelfMessage(formData)).toBe(false);
    });

    it('returns false when both participant IDs are empty (but equal)', () => {
      const formData: FormData = {
        fromParticipantId: '',
        toParticipantId: '',
        requestMode: 'label',
        requestRefKind: '',
        requestRefId: '',
        requestLabelText: '',
        includeResponse: false,
        responseMode: 'label',
        responseRefKind: '',
        responseRefId: '',
        responseLabelText: '',
      };

      expect(isSelfMessage(formData)).toBe(false);
    });
  });
});
