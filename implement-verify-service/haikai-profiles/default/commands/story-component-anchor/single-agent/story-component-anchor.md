# Haikai Skill: /story-component-anchor

**Author:** Agent  
**Date:** 2026-02-07  
**Version:** 1.0

## 1. Description

This skill generates Storybook CSF 3.0 stories from a UI component's contract.json file. It analyzes the contract definition (component name, props, events, state stories, visual specs, accessibility requirements) and produces a complete `.stories.tsx` file with proper TypeScript types, play tests, and documentation.

## 2. Usage

The skill receives a contract.json object and generates stories based on its structure.

### 2.1. Input

The skill expects a contract.json with the following structure:

```json
{
  "component": "ComponentName",
  "version": "1.0.0",
  "description": "Component description",
  "folder": "path/to/component",
  "props": {
    "propName": {
      "type": "string | boolean | number | object",
      "required": true,
      "description": "Prop description",
      "default": "defaultValue"
    }
  },
  "events": {
    "onClick": "Triggered when component is clicked"
  },
  "stateStories": [
    { "name": "Default", "description": "Default state" },
    { "name": "Loading", "description": "Loading state" },
    { "name": "Error", "description": "Error state" }
  ],
  "visual": {
    "spacing": "Uses 8px grid",
    "colors": "Uses theme colors"
  },
  "accessibility": {
    "keyboard": "Focusable via Tab",
    "aria": "Uses aria-label"
  }
}
```

### 2.2. Output

Generate a complete Storybook stories file with:

1. **Meta Configuration**
   - Title following pattern: `Components/{ComponentName}`
   - Component reference
   - Layout and docs parameters
   - `autodocs` tag

2. **TypeScript Types**
   - `Meta<typeof Component>`
   - `StoryObj<typeof Component>`

3. **Stories for Each stateStory**
   - One exported story per `stateStories` entry
   - Args matching the state's requirements
   - Play function with `@storybook/test` interactions

4. **Generated Code Markers**
   - Wrap output in `@generated-begin {component}-stories` and `@generated-end {component}-stories`

## 3. Story Template

```typescript
// @generated-begin {Component}-stories
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { {Component} } from './{Component}';

const meta: Meta<typeof {Component}> = {
  title: 'Components/{Component}',
  component: {Component},
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: `{description}`,
      },
    },
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof {Component}>;

// Story for each stateStory...
export const {StoryName}: Story = {
  args: {
    // Props for this state
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Interaction tests
  },
};
// @generated-end {Component}-stories
```

## 4. Instructions

When invoked with a contract.json:

1. Parse the contract structure
2. Extract component name, description, props, events, and stateStories
3. Generate the meta configuration with proper types
4. Create one story for each entry in `stateStories`
5. Add appropriate args based on props and story requirements
6. Include play functions for interactive testing
7. Output the complete `.stories.tsx` content wrapped in generation markers
