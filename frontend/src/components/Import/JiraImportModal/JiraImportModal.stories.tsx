// @generated-begin JiraImportModal-stories
/**
 * JiraImportModal Storybook Stories
 *
 * CSF 3.0 stories covering the six required state stories
 * defined in JiraImportModal.contract.json.
 *
 * Contract: JiraImportModal.contract.json
 *
 * NOTE: Storybook is not yet installed in this project. These stories are
 * ready for use once Storybook is added. To set up Storybook:
 *   npx storybook@latest init --type react
 *
 * Play tests use @storybook/test (bundled with @storybook/addon-interactions).
 */

import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { JiraImportModal } from './JiraImportModal';
import type { WorkItem } from '../../../types/workItems';

// ---------------------------------------------------------------------------
// Test data fixtures
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<WorkItem> & { externalKey: string }): WorkItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    projectId: 'proj-1',
    type: overrides.type ?? 'STORY',
    parentId: overrides.parentId ?? null,
    title: overrides.title ?? `Summary for ${overrides.externalKey}`,
    description: overrides.description ?? null,
    status: overrides.status ?? 'NEW',
    sortOrder: overrides.sortOrder ?? 0,
    priority: overrides.priority ?? null,
    targetWindow: null,
    tags: null,
    externalSystem: 'JIRA',
    externalKey: overrides.externalKey,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const SAMPLE_ISSUES: WorkItem[] = [
  makeIssue({ externalKey: 'PROJ-101', type: 'EPIC', title: 'Implement user authentication' }),
  makeIssue({ externalKey: 'PROJ-102', type: 'STORY', title: 'Add login form with email/password' }),
  makeIssue({ externalKey: 'PROJ-103', type: 'STORY', title: 'Add OAuth2 Google sign-in' }),
  makeIssue({ externalKey: 'PROJ-104', type: 'FEATURE', title: 'Password reset flow' }),
  makeIssue({ externalKey: 'PROJ-105', type: 'STORY', title: 'Email verification on signup' }),
];

const LONG_LIST_ISSUES: WorkItem[] = Array.from({ length: 25 }, (_, i) =>
  makeIssue({
    externalKey: `PROJ-${200 + i}`,
    type: i % 4 === 0 ? 'EPIC' : i % 3 === 0 ? 'FEATURE' : 'STORY',
    title: `Issue ${200 + i}: ${['Implement caching layer', 'Fix race condition in queue', 'Add retry logic to API client', 'Refactor database migration', 'Update CI pipeline config'][i % 5]}`,
  })
);

// ---------------------------------------------------------------------------
// Mock fetch helper
// ---------------------------------------------------------------------------

function mockFetch(response: {
  ok?: boolean;
  status?: number;
  data?: unknown;
  delay?: number;
  rejects?: boolean;
}) {
  const { ok = true, status = 200, data = [], delay = 0, rejects = false } = response;
  window.fetch = async () => {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (rejects) throw new Error('Network error');
    return {
      ok,
      status,
      json: async () => data,
      text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
    } as Response;
  };
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

/**
 * JiraImportModal — Search, select, and import Jira issues into the backlog.
 *
 * **Contract states covered:**
 * Default | Loading | EmptyResults | Error | WithSelections | LongList
 */
const meta: Meta<typeof JiraImportModal> = {
  title: 'Import/JiraImportModal',
  component: JiraImportModal,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Modal dialog for searching Jira issues and importing them into the current product backlog. ' +
          'Controlled by parent via isOpen/onClose. Hybrid data fetch: parent provides config, component searches via API.',
      },
    },
  },
  args: {
    isOpen: true,
    onClose: () => {},
    onImport: () => {},
    projectId: 'proj-1',
    jiraProjectKey: 'PROJ',
  },
  argTypes: {
    isOpen: { control: 'boolean' },
    jiraProjectKey: { control: 'text' },
    projectId: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/**
 * Default — Modal open, empty search field, no results shown yet.
 */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('jira-search-input');
    await expect(input).toHaveFocus();
    await expect(canvas.getByTestId('jira-initial')).toBeInTheDocument();
    await expect(canvas.getByTestId('jira-import-button')).toBeDisabled();
  },
};

/**
 * Loading — Search in progress, spinner visible.
 */
export const Loading: Story = {
  decorators: [
    (Story) => {
      // Mock fetch that never resolves to keep loading state
      mockFetch({ data: [], delay: 999999 });
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('jira-search-input');
    await userEvent.type(input, 'auth');
    await userEvent.click(canvas.getByTestId('jira-search-button'));
    await expect(canvas.getByTestId('jira-loading')).toBeInTheDocument();
  },
};

/**
 * EmptyResults — Search completed, zero results returned.
 */
export const EmptyResults: Story = {
  decorators: [
    (Story) => {
      mockFetch({ data: [], delay: 50 });
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('jira-search-input');
    await userEvent.type(input, 'nonexistent-query');
    await userEvent.click(canvas.getByTestId('jira-search-button'));
    // Wait for loading to complete
    await canvas.findByTestId('jira-empty');
    await expect(canvas.getByTestId('jira-empty')).toHaveTextContent('No issues found');
  },
};

/**
 * Error — Search failed, error message displayed.
 */
export const Error: Story = {
  decorators: [
    (Story) => {
      mockFetch({ ok: false, status: 500, data: 'Internal server error', delay: 50 });
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('jira-search-input');
    await userEvent.type(input, 'bad query');
    await userEvent.click(canvas.getByTestId('jira-search-button'));
    const errorEl = await canvas.findByTestId('jira-error');
    await expect(errorEl).toBeInTheDocument();
  },
};

/**
 * WithSelections — Results visible, some rows checked, Import button enabled.
 */
export const WithSelections: Story = {
  decorators: [
    (Story) => {
      mockFetch({ data: SAMPLE_ISSUES, delay: 50 });
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('jira-search-input');
    await userEvent.type(input, 'auth');
    await userEvent.click(canvas.getByTestId('jira-search-button'));

    // Wait for results
    await canvas.findByTestId('jira-results-list');

    // Select first two rows
    const row1 = canvas.getByTestId('jira-issue-row-PROJ-101');
    const row2 = canvas.getByTestId('jira-issue-row-PROJ-102');
    await userEvent.click(row1);
    await userEvent.click(row2);

    // Import button should now be enabled
    await expect(canvas.getByTestId('jira-import-button')).toBeEnabled();
    await expect(canvas.getByTestId('jira-import-button')).toHaveTextContent('Import (2)');
  },
};

/**
 * LongList — Many results (25), list scrolls, header/footer remain fixed.
 */
export const LongList: Story = {
  decorators: [
    (Story) => {
      mockFetch({ data: LONG_LIST_ISSUES, delay: 50 });
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByTestId('jira-search-input');
    await userEvent.type(input, 'issues');
    await userEvent.click(canvas.getByTestId('jira-search-button'));

    // Wait for results
    const list = await canvas.findByTestId('jira-results-list');
    const items = list.querySelectorAll('li');
    await expect(items.length).toBe(25);
  },
};

// @generated-end JiraImportModal-stories
