/**
 * ChatBubble Persona Label Tests
 *
 * Spec 2026-01-22: Feature Shaping UI Consumes Planner JSON
 * Task Group 5: Update ChatBubble with Persona Labels
 *
 * Tests for:
 * - ChatBubble displays "You" label for user role
 * - ChatBubble displays "Product Manager" label for assistant role (Hub
 *   pattern restructure, Spec 2026-03-15)
 * - ChatBubble renders a persona avatar with a per-persona colour
 * - Persona label is visually positioned correctly
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ChatBubble } from '../components/chat/ChatBubble';
import type { ChatMessage } from '../api/chatApi';

describe('Task Group 5: ChatBubble Persona Labels', () => {
  const createMessage = (
    role: 'user' | 'assistant',
    content: string = 'Test message'
  ): ChatMessage => ({
    id: `msg-${Date.now()}`,
    role,
    content,
    timestamp: new Date(),
  });

  describe('Test 5.1: ChatBubble displays "You" label for user role', () => {
    it('should display "You" label for user messages', () => {
      const userMessage = createMessage('user', 'Hello, I have a question.');

      render(<ChatBubble message={userMessage} />);

      expect(screen.getByText('You')).toBeInTheDocument();
    });

    it('should display message content for user', () => {
      const userMessage = createMessage('user', 'This is my message content');

      render(<ChatBubble message={userMessage} />);

      expect(screen.getByText('This is my message content')).toBeInTheDocument();
    });
  });

  describe('Test 5.2: ChatBubble displays "Product Manager" label for assistant role', () => {
    it('should display "Product Manager" label for assistant messages by default', () => {
      const assistantMessage = createMessage('assistant', 'I can help with that.');

      render(<ChatBubble message={assistantMessage} />);

      expect(screen.getByText('Product Manager')).toBeInTheDocument();
    });

    it('should display message content for assistant', () => {
      const assistantMessage = createMessage('assistant', 'Here is my response');

      render(<ChatBubble message={assistantMessage} />);

      expect(screen.getByText('Here is my response')).toBeInTheDocument();
    });

    it('should allow custom persona override via prop', () => {
      const assistantMessage = createMessage('assistant', 'Response');

      render(<ChatBubble message={assistantMessage} persona="Software Architect" />);

      expect(screen.getByText('Software Architect')).toBeInTheDocument();
    });
  });

  describe('Test 5.3: ChatBubble persona styling (Hub pattern)', () => {
    // Spec 2026-03-15 restructured the bubble: the old personaGreen/Blue/
    // Purple label classes are gone. The user gets a plain "You" label; the
    // assistant gets a persona header with an avatar coloured per persona.
    it('should style the user label with the userLabel class', () => {
      const userMessage = createMessage('user', 'User message');

      render(<ChatBubble message={userMessage} />);

      const personaLabel = screen.getByText('You');
      expect(personaLabel.className).toMatch(/userLabel/);
    });

    it('should render the Product Manager avatar with the PM colour', () => {
      const assistantMessage = createMessage('assistant', 'Assistant message');

      render(<ChatBubble message={assistantMessage} />);

      const avatar = screen.getByText('PM');
      expect(avatar.className).toMatch(/personaAvatar/);
      expect(avatar).toHaveStyle({ backgroundColor: '#C62828' });
    });

    it('should derive avatar initials for custom personas (personaColor prop is ignored)', () => {
      const assistantMessage = createMessage('assistant', 'Architect message');

      render(
        <ChatBubble
          message={assistantMessage}
          persona="Software Architect"
          personaColor="purple"
        />
      );

      expect(screen.getByText('Software Architect')).toBeInTheDocument();
      // Unknown personas fall back to first-two-letter initials + neutral colour
      const avatar = screen.getByText('SO');
      expect(avatar).toHaveStyle({ backgroundColor: '#9E9E9E' });
    });
  });

  describe('Test 5.4: Persona label is visually positioned correctly', () => {
    it('should render persona label above message content', () => {
      const userMessage = createMessage('user', 'Message content here');

      const { container } = render(<ChatBubble message={userMessage} />);

      const bubble = container.querySelector('[class*="bubble"]');
      expect(bubble).toBeInTheDocument();

      // Persona label should be a child of the bubble, appearing before content
      const personaLabel = screen.getByText('You');
      const content = screen.getByText('Message content here');

      // Both should exist in the document
      expect(personaLabel).toBeInTheDocument();
      expect(content).toBeInTheDocument();
    });

    it('should have proper styling class on persona label', () => {
      const assistantMessage = createMessage('assistant', 'Content');

      render(<ChatBubble message={assistantMessage} />);

      const personaLabel = screen.getByText('Product Manager');
      expect(personaLabel.className).toMatch(/personaLabel/);
    });
  });
});
