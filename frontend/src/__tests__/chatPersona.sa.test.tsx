/**
 * Tests for SA Chat Persona Routing
 *
 * Spec 2026-01-23: SA Handoff Per Increment
 * Task Group 7: Route Chat to SA Persona Based on Phase
 *
 * Tests:
 * 1. ChatBubble receives persona="Software Architect" when phase='implementation_clarification'
 * 2. ChatBubble receives personaColor="purple" when phase='implementation_clarification'
 * 3. PO phase messages retain persona="Product Owner" and personaColor="green"
 * 4. Persona switches correctly when phase changes
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ChatBubble } from '../components/chat/ChatBubble';
import type { ChatMessage } from '../api/chatApi';
import type { ImplementChatPhase } from '../api/chatApi';

/**
 * Helper function to determine persona based on phase
 * This is the logic that will be used in ImplementationAssistantPanel
 *
 * Exported for use in integration tests.
 */
export function getPersonaForPhase(phase: ImplementChatPhase | undefined): {
  persona: string;
  personaColor: 'green' | 'blue' | 'purple';
} {
  if (phase === 'implementation_clarification') {
    return {
      persona: 'Software Architect',
      personaColor: 'purple',
    };
  }
  // Default to Product Owner for all other phases
  return {
    persona: 'Product Owner',
    personaColor: 'blue',
  };
}

describe('SA Chat Persona Routing', () => {
  describe('getPersonaForPhase helper', () => {
    it('should return Software Architect with purple color for implementation_clarification phase', () => {
      const result = getPersonaForPhase('implementation_clarification');

      expect(result.persona).toBe('Software Architect');
      expect(result.personaColor).toBe('purple');
    });

    it('should return Product Owner with blue color for refine phase', () => {
      const result = getPersonaForPhase('refine');

      expect(result.persona).toBe('Product Owner');
      expect(result.personaColor).toBe('blue');
    });

    it('should return Product Owner with blue color for bootstrap phase', () => {
      const result = getPersonaForPhase('bootstrap');

      expect(result.persona).toBe('Product Owner');
      expect(result.personaColor).toBe('blue');
    });

    it('should return Product Owner with blue color for implementation_planning phase', () => {
      const result = getPersonaForPhase('implementation_planning');

      expect(result.persona).toBe('Product Owner');
      expect(result.personaColor).toBe('blue');
    });

    it('should return Product Owner with blue color when phase is undefined', () => {
      const result = getPersonaForPhase(undefined);

      expect(result.persona).toBe('Product Owner');
      expect(result.personaColor).toBe('blue');
    });
  });

  describe('ChatBubble persona rendering', () => {
    const assistantMessage: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content: 'This is a test message from the assistant.',
      timestamp: new Date(),
    };

    it('should render with Software Architect persona when passed persona="Software Architect"', () => {
      render(
        <ChatBubble
          message={assistantMessage}
          persona="Software Architect"
          personaColor="purple"
        />
      );

      expect(screen.getByText('Software Architect')).toBeInTheDocument();
    });

    it('should render with Product Owner persona when passed persona="Product Owner"', () => {
      render(
        <ChatBubble
          message={assistantMessage}
          persona="Product Owner"
          personaColor="blue"
        />
      );

      expect(screen.getByText('Product Owner')).toBeInTheDocument();
    });

    it('should render with purple color class when personaColor="purple"', () => {
      const { container } = render(
        <ChatBubble
          message={assistantMessage}
          persona="Software Architect"
          personaColor="purple"
        />
      );

      // Spec 2026-03-15 (Hub pattern): the personaColor prop is ignored;
      // the persona name renders in the header with a per-persona avatar.
      expect(container.textContent).toContain('Software Architect');
      const avatar = container.querySelector('[class*="personaAvatar"]');
      expect(avatar).toBeInTheDocument();
    });

    it('should render with blue color class when personaColor="blue"', () => {
      const { container } = render(
        <ChatBubble
          message={assistantMessage}
          persona="Product Owner"
          personaColor="blue"
        />
      );

      // Spec 2026-03-15 (Hub pattern): the personaColor prop is ignored;
      // the persona name renders in the header with a per-persona avatar.
      expect(container.textContent).toContain('Product Owner');
      const avatar = container.querySelector('[class*="personaAvatar"]');
      expect(avatar).toBeInTheDocument();
    });
  });

  describe('Persona switching based on phase', () => {
    it('should switch from PO to SA persona when phase changes to implementation_clarification', () => {
      // Simulate phase change
      const phases: ImplementChatPhase[] = ['refine', 'implementation_clarification'];

      const personasBefore = getPersonaForPhase(phases[0]);
      expect(personasBefore.persona).toBe('Product Owner');
      expect(personasBefore.personaColor).toBe('blue');

      const personasAfter = getPersonaForPhase(phases[1]);
      expect(personasAfter.persona).toBe('Software Architect');
      expect(personasAfter.personaColor).toBe('purple');
    });

    it('should maintain correct persona through multiple phase transitions', () => {
      const phaseSequence: ImplementChatPhase[] = [
        'bootstrap',
        'refine',
        'implementation_planning',
        'implementation_clarification',
        'refine', // User might go back
      ];

      const expectedPersonas = [
        'Product Owner',      // bootstrap
        'Product Owner',      // refine
        'Product Owner',      // implementation_planning
        'Software Architect', // implementation_clarification
        'Product Owner',      // refine (back)
      ];

      phaseSequence.forEach((phase, index) => {
        const result = getPersonaForPhase(phase);
        expect(result.persona).toBe(expectedPersonas[index]);
      });
    });
  });
});
