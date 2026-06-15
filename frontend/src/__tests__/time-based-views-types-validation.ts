/**
 * Task Group 1: TypeScript Interfaces and Type Definitions Validation
 * This file validates that the type definitions compile correctly.
 * If this file compiles without errors, the type definitions are correct.
 */

import type {
  BusinessProcess,
  Application,
  ApplicationComponent,
  Service,
  ApplicationPoint,
  LogicalDataEntity,
  PhysicalDataEntity,
  DataMovement,
  Diagram,
} from '../types/model';

// Test 1: Quarter Format Validation
function validateQuarterFormat(quarter: string): boolean {
  const quarterPattern = /^\d{4}-Q[1-4]$/;
  return quarterPattern.test(quarter);
}

// Validate some quarter formats
const validQuarters = ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1'];
validQuarters.forEach(q => {
  if (!validateQuarterFormat(q)) {
    throw new Error(`Invalid quarter format: ${q}`);
  }
});

// Test 2: Entity Interfaces with Validity Fields
const testBusinessProcess: BusinessProcess = {
  id: 'bp1',
  name: 'Test Process',
  description: 'Test',
  tags: '',
  valid_from: '2026-Q1',
  valid_to: '2027-Q4',
};

const testApplication: Application = {
  id: 'app1',
  name: 'Test App',
  description: 'Test',
  app_type: 'Web',
  status: 'Active',
  tags: '',
  valid_from: '2026-Q2',
  valid_to: undefined,
};

const testApplicationComponent: ApplicationComponent = {
  id: 'comp1',
  name: 'Test Component',
  description: 'Test',
  application_id: 'app1',
  tags: '',
  valid_from: undefined,
  valid_to: undefined,
};

const testService: Service = {
  id: 'svc1',
  name: 'Test Service',
  description: 'Test',
  application_id: 'app1',
  service_type: 'REST',
  tags: '',
  valid_from: '2026-Q3',
  valid_to: '2028-Q1',
};

const testApplicationPoint: ApplicationPoint = {
  id: 'pt1',
  name: 'Test Point',
  description: 'Test',
  application_id: 'app1',
  point_type: 'UI',
  tags: '',
  valid_from: '2026-Q1',
};

const testLogicalDataEntity: LogicalDataEntity = {
  id: 'lde1',
  name: 'Test Entity',
  description: 'Test',
  tags: '',
  valid_from: '2025-Q4',
  valid_to: '2027-Q2',
};

const testPhysicalDataEntity: PhysicalDataEntity = {
  id: 'pde1',
  name: 'Test Physical Entity',
  description: 'Test',
  logical_entity_id: 'lde1',
  physical_type: 'Table',
  database: 'MainDB',
  tags: '',
  valid_from: '2026-Q1',
  valid_to: '2026-Q4',
};

// Test 3: Relationship Interfaces with Validity Fields
const testDataMovement: DataMovement = {
  id: 'dm1',
  source_application_id: 'app1',
  target_application_id: 'app2',
  data_entity_id: 'lde1',
  movement_type: 'Batch',
  description: 'Test',
  tags: '',
  valid_from: '2026-Q1',
  valid_to: '2027-Q1',
};

const testDataMovementTimeless: DataMovement = {
  id: 'dm2',
  source_application_id: 'app1',
  target_application_id: 'app2',
  data_entity_id: 'lde1',
  movement_type: 'Real-time',
  description: 'Test',
  tags: '',
  valid_from: undefined,
  valid_to: undefined,
};

// Test 4: Diagram Interface with view_quarter
const testDiagram: Diagram = {
  id: 'diag1',
  name: 'Test Diagram',
  description: 'Test',
  view_quarter: '2026-Q4',
  diagram_nodes: [],
  diagram_edges: [],
};

const testDiagramNoQuarter: Diagram = {
  id: 'diag2',
  name: 'Test Diagram 2',
  description: 'Test',
  diagram_nodes: [],
  diagram_edges: [],
};

// Export for verification
export const validationResults = {
  businessProcess: testBusinessProcess,
  application: testApplication,
  applicationComponent: testApplicationComponent,
  service: testService,
  applicationPoint: testApplicationPoint,
  logicalDataEntity: testLogicalDataEntity,
  physicalDataEntity: testPhysicalDataEntity,
  dataMovement: testDataMovement,
  dataMovementTimeless: testDataMovementTimeless,
  diagram: testDiagram,
  diagramNoQuarter: testDiagramNoQuarter,
};

console.log('Task Group 1: All type definitions validated successfully!');
