/**
 * Tests for DataEntityPointSelect Component
 *
 * Spec: Switch Logical ER and Data Movements UI to Data Entity Point Dropdown
 * Task Group 3: DataEntityPointSelect Editor Component
 *
 * Tests for:
 * - Component renders with current value displayed as label
 * - Double-click activates edit mode with typeahead input
 * - Typeahead filters options across both logical and physical entity groups
 * - Group headers display correctly
 * - Selection emits pointId and closes dropdown
 * - Escape key deactivates edit mode without selection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DataEntityPointSelect } from '../components/Grid/DataEntityPointSelect';
import { ArchitectureModel, MetaModelEntities } from '../types/model';

// Helper to create mock MetaModelEntities with specified data entities
function createMockEntities(
  logicalEntities: Array<{ id: string; name: string }> = [],
  physicalEntities: Array<{ id: string; name: string }> = []
): MetaModelEntities {
  return {
    business_users: [],
    business_processes: [],
    process_activities: [],
    business_points: [],
    applications: [],
    app_components: [],
    services: [],
    interfaces: [],
    endpoints: [],
    classes: [],
    methods: [],
    application_points: [],
    logical_data_entities: logicalEntities.map((e) => ({
      id: e.id,
      name: e.name,
      description: '',
      tags: '',
    })),
    logical_data_attributes: [],
    physical_data_entities: physicalEntities.map((e) => ({
      id: e.id,
      name: e.name,
      description: '',
      physical_type: '',
      database: '',
      tags: '',
    })),
    physical_data_attributes: [],
    interactions: [],
    app_business_points: [],
    events: [],
    states: [],
    state_transitions: [],
    activities: [],
    activity_flows: [],
    activity_partitions: [],
    business_logics: [],
    ui_screens: [],
    ui_components: [],
    ui_actions: [],
    package_sets: [],
    packages: [],
  };
}

function createMockModel(entities: MetaModelEntities): ArchitectureModel {
  return {
    metaModel: {
      entities,
      relationships: {
        business_user_business_points: [],
        application_point_business_points: [],
        application_point_business_logics: [],
        logical_data_entity_relationships: [],
        logical_data_entity_physical_data_entities: [],
        logical_data_attribute_physical_data_attributes: [],
        data_movements: [],
        interface_logical_entities: [],
        ui_workflow_transitions: [],
      },
    },
    diagrams: [],
  };
}

describe('DataEntityPointSelect Component', () => {
  let mockOnChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnChange = vi.fn();
  });

  it('should render with current value displayed as label in read mode', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      []
    );
    const model = createMockModel(entities);

    render(
      <DataEntityPointSelect
        value="dep_log_log_1"
        model={model}
        onChange={mockOnChange}
      />
    );

    // Should display the resolved label
    expect(screen.getByText('Customer [LOGICAL_DATA_ENTITY]')).toBeInTheDocument();
  });

  it('should activate edit mode with typeahead input on double-click', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      []
    );
    const model = createMockModel(entities);

    render(
      <DataEntityPointSelect
        value="dep_log_log_1"
        model={model}
        onChange={mockOnChange}
      />
    );

    // Double-click to enter edit mode
    const cellValue = screen.getByText('Customer [LOGICAL_DATA_ENTITY]');
    fireEvent.doubleClick(cellValue);

    // Should show input field
    expect(screen.getByPlaceholderText(/Search/i)).toBeInTheDocument();
  });

  it('should filter options across both logical and physical entity groups', () => {
    const entities = createMockEntities(
      [
        { id: 'log_1', name: 'Customer' },
        { id: 'log_2', name: 'Order' },
      ],
      [
        { id: 'phy_1', name: 'customers_table' },
        { id: 'phy_2', name: 'orders_table' },
      ]
    );
    const model = createMockModel(entities);

    render(
      <DataEntityPointSelect
        value=""
        model={model}
        onChange={mockOnChange}
      />
    );

    // Double-click to enter edit mode - use document.querySelector for empty value cell
    const cellValue = document.querySelector('[class*="cellValue"]');
    fireEvent.doubleClick(cellValue!);

    // Type to filter
    const input = screen.getByPlaceholderText(/Search/i);
    fireEvent.change(input, { target: { value: 'order' } });

    // Should show filtered results (Order and orders_table)
    expect(screen.getByText('Order [LOGICAL_DATA_ENTITY]')).toBeInTheDocument();
    expect(screen.getByText('orders_table [PHYSICAL_DATA_ENTITY]')).toBeInTheDocument();

    // Should NOT show non-matching results
    expect(screen.queryByText('Customer [LOGICAL_DATA_ENTITY]')).not.toBeInTheDocument();
    expect(screen.queryByText('customers_table [PHYSICAL_DATA_ENTITY]')).not.toBeInTheDocument();
  });

  it('should display group headers for logical and physical entities', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      [{ id: 'phy_1', name: 'customers_table' }]
    );
    const model = createMockModel(entities);

    render(
      <DataEntityPointSelect
        value=""
        model={model}
        onChange={mockOnChange}
      />
    );

    // Double-click to enter edit mode
    const cellValue = document.querySelector('[class*="cellValue"]');
    fireEvent.doubleClick(cellValue!);

    // Should show group headers
    expect(screen.getByText('LOGICAL DATA ENTITIES')).toBeInTheDocument();
    expect(screen.getByText('PHYSICAL DATA ENTITIES')).toBeInTheDocument();
  });

  it('should emit pointId on option selection and close dropdown', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      []
    );
    const model = createMockModel(entities);

    render(
      <DataEntityPointSelect
        value=""
        model={model}
        onChange={mockOnChange}
      />
    );

    // Double-click to enter edit mode
    const cellValue = document.querySelector('[class*="cellValue"]');
    fireEvent.doubleClick(cellValue!);

    // Click on an option
    const option = screen.getByText('Customer [LOGICAL_DATA_ENTITY]');
    fireEvent.click(option);

    // Should call onChange with the point ID
    expect(mockOnChange).toHaveBeenCalledWith('dep_log_log_1');

    // Should close dropdown (back to read mode)
    expect(screen.queryByPlaceholderText(/Search/i)).not.toBeInTheDocument();
  });

  it('should deactivate edit mode without selection on Escape key', () => {
    const entities = createMockEntities(
      [{ id: 'log_1', name: 'Customer' }],
      []
    );
    const model = createMockModel(entities);

    render(
      <DataEntityPointSelect
        value="dep_log_log_1"
        model={model}
        onChange={mockOnChange}
      />
    );

    // Double-click to enter edit mode
    const cellValue = screen.getByText('Customer [LOGICAL_DATA_ENTITY]');
    fireEvent.doubleClick(cellValue);

    // Verify edit mode is active
    const input = screen.getByPlaceholderText(/Search/i);
    expect(input).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    // Should return to read mode without calling onChange
    expect(mockOnChange).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(/Search/i)).not.toBeInTheDocument();
    expect(screen.getByText('Customer [LOGICAL_DATA_ENTITY]')).toBeInTheDocument();
  });
});
