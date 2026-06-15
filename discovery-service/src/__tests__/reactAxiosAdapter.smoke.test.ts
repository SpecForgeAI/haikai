/**
 * Smoke tests for the V3 React/TypeScript pack pair (formerly the
 * React/Axios adapter smoke test).
 *
 * Spec: V3 Pack Migration Batch (Task Group 3)
 *
 * Migrated from direct `extractTypeScriptIR` + `runReactAxiosAdapter`
 * invocation to the V3 pack shape: `typescriptLangPack.extract` +
 * `reactTypescriptFrameworkPack.adapt`. All assertions are preserved
 * verbatim — only the invocation shape changes.
 *
 * Covers: logical_entity, logical_data_attribute, business_logic,
 * ui_component, ui_screen, endpoint (API-call consumer side).
 */
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { reactTypescriptFrameworkPack } from '../services/extensionPacks/frameworkPacks/reactTypescriptFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const REACT_TS_HINTS: TechHints = {
  '0': { language: 'TypeScript' },
  '1': { technology: 'React' },
};

/**
 * Build a single-file source map, run the V3 pack pair, return candidates.
 * Mirrors the V2 `runReactAxiosAdapter([ir], runId)` shape the original
 * tests used — same inputs, same outputs, just routed through the V3
 * LanguagePack + FrameworkPack.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = typescriptLangPack.extract(files, REACT_TS_HINTS);
  return reactTypescriptFrameworkPack.adapt(irFiles, runId, REACT_TS_HINTS);
}

const DTO_SRC = `
export interface UserDto {
  id: number;
  firstName: string;
  lastName: string;
  email: string | null;
}

export type CreateUserRequest = {
  firstName: string;
  lastName: string;
};

// Primitive alias — should NOT be emitted as logical_entity
export type UserId = number;

// Empty marker — should NOT be emitted
export interface Marker {}
`;

const SERVICE_SRC = `
import axios from 'axios';
import { UserDto } from './UserDto';

export async function calculateOrderTotal(items: any[]): Promise<number> {
  return items.reduce((sum, i) => sum + i.price, 0);
}

export function UserCard(): JSX.Element {
  return <div>x</div>;
}

export function getUserById(id: number): UserDto | null {
  return null;
}

export function useUser(): UserDto | null {
  return null;
}

export async function evaluateDiscountPolicy(user: UserDto): Promise<number> {
  return 0;
}
`;

const COMPONENT_SRC_TSX = `
import React from 'react';
import axios from 'axios';
import { UserDto } from './UserDto';

// Page-level component — should emit ui_screen
export function OwnersPage(): JSX.Element {
  return <div>Owners</div>;
}

// Reusable widget — should emit ui_component
export function SubmitButton(): JSX.Element {
  return <button>Submit</button>;
}

// Function in .tsx without JSX return annotation but PascalCase
export const DataTable = () => {
  return <table />;
};

// PascalCase helper — should STILL be emitted as ui_component given .tsx
export function Header() {
  return <header>hi</header>;
}

// Class component — should emit ui_component (not a screen, not named *Page)
export class ProfileCard extends React.Component {
  render() {
    return <div>profile</div>;
  }
}

// Class component — screen suffix → ui_screen
export class SettingsPage extends React.Component {
  render() {
    return <div>settings</div>;
  }
}
`;

const API_CLIENT_SRC = `
import axios from 'axios';
import { UserDto, CreateUserRequest } from './UserDto';

export async function fetchUsers(): Promise<UserDto[]> {
  const res = await axios.get<UserDto[]>('/api/users');
  return res.data;
}

export async function createUser(req: CreateUserRequest): Promise<UserDto> {
  const res = await axios.post<UserDto>('/api/users', req);
  return res.data;
}

export async function deleteUser(id: number): Promise<void> {
  await axios.delete(\`/api/users/\${id}\`);
}

export async function loginLegacy(): Promise<string> {
  const res = await fetch('/api/login', { method: 'POST' });
  return res.text();
}
`;

const SCREEN_BY_PATH_SRC_TSX = `
import React from 'react';
// File lives under src/pages/, so should be classified as ui_screen even though
// the component name doesn't end with Page/Screen/View.
export function OwnerList(): JSX.Element {
  return <div>owner list</div>;
}
`;

describe('React/TypeScript V3 pack pair smoke test', () => {
  const files = new Map<string, string>([
    ['src/types/UserDto.ts', DTO_SRC],
    ['src/services/orderService.ts', SERVICE_SRC],
    ['src/components/App.tsx', COMPONENT_SRC_TSX],
    ['src/api/userClient.ts', API_CLIENT_SRC],
    ['src/pages/OwnerList.tsx', SCREEN_BY_PATH_SRC_TSX],
  ]);

  it('emits logical_entity + logical_data_attribute (pre-existing behavior still works)', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const logicals = candidates.filter((c) => c.candidateType === 'logical_data_entities').map((c) => c.name).sort();
    expect(logicals).toEqual(['CreateUserRequest', 'UserDto']);
    const attrs = candidates.filter((c) => c.candidateType === 'logical_data_attributes');
    expect(attrs.length).toBe(6); // UserDto(4) + CreateUserRequest(2)
  });

  it('emits business_logic only for non-component exported domain functions', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const names = candidates.filter((c) => c.candidateType === 'business_logics').map((c) => c.name).sort();
    // Must include calculateOrderTotal, evaluateDiscountPolicy.
    // Must exclude UserCard (component), getUserById (CRUD prefix), useUser (hook),
    // fetchUsers/createUser/deleteUser/loginLegacy (CRUD-ish or API wrappers).
    expect(names).toContain('calculateOrderTotal');
    expect(names).toContain('evaluateDiscountPolicy');
    expect(names).not.toContain('UserCard');
    expect(names).not.toContain('getUserById');
    expect(names).not.toContain('useUser');
  });

  it('emits ui_screen for *Page/*Screen/*View components', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const screens = candidates.filter((c) => c.candidateType === 'ui_screens').map((c) => c.name).sort();
    expect(screens).toContain('OwnersPage');
    expect(screens).toContain('SettingsPage');
    expect(screens).toContain('OwnerList'); // classified via /pages/ path
  });

  it('emits ui_component for non-page PascalCase components', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const comps = candidates.filter((c) => c.candidateType === 'ui_components').map((c) => c.name).sort();
    expect(comps).toContain('SubmitButton');
    expect(comps).toContain('DataTable');
    expect(comps).toContain('Header');
    expect(comps).toContain('ProfileCard'); // class component
    expect(comps).toContain('UserCard'); // from service file with JSX return type
  });

  it('infers component_type from name heuristics', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const button = candidates.find((c) => c.candidateType === 'ui_components' && c.name === 'SubmitButton');
    expect(button?.data.component_type).toBe('button');
    const table = candidates.find((c) => c.candidateType === 'ui_components' && c.name === 'DataTable');
    expect(table?.data.component_type).toBe('table');
    const header = candidates.find((c) => c.candidateType === 'ui_components' && c.name === 'Header');
    expect(header?.data.component_type).toBe('layout');
  });

  it('does NOT emit ui_component / ui_screen for TS interfaces or primitive aliases', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const uiNames = candidates.filter((c) => c.candidateType === 'ui_components' || c.candidateType === 'ui_screens').map((c) => c.name);
    expect(uiNames).not.toContain('UserDto');
    expect(uiNames).not.toContain('CreateUserRequest');
    expect(uiNames).not.toContain('Marker');
  });

  it('emits endpoint candidates for axios calls with URL + HTTP method', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const endpoints = candidates.filter((c) => c.candidateType === 'endpoints');
    const names = endpoints.map((c) => c.name).sort();
    expect(names).toContain('GET /api/users');
    expect(names).toContain('POST /api/users');
    expect(names).toContain('DELETE /api/users/${id}');
    expect(names).toContain('POST /api/login'); // fetch with method: 'POST'

    // Inspect metadata on one endpoint
    const getUsers = endpoints.find((c) => c.name === 'GET /api/users')!;
    expect(getUsers.data.httpMethod).toBe('GET');
    expect(getUsers.data.url).toBe('/api/users');
    expect(getUsers.data.apiLibrary).toBe('axios');
    expect(getUsers.data.callingFunction).toBe('fetchUsers');
    expect(getUsers.data.endpoint_subtype).toBe('api_call');
    expect(getUsers.data.responseType).toBe('UserDto[]'); // from axios.get<UserDto[]>
  });

  it('extracts fetch calls and infers HTTP method from options', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const login = candidates.find((c) => c.candidateType === 'endpoints' && c.name === 'POST /api/login');
    expect(login).toBeDefined();
    expect(login?.data.httpMethod).toBe('POST');
    expect(login?.data.apiLibrary).toBe('fetch');
  });
});

// ---------------------------------------------------------------------------
// Additional heuristic-tightening tests (post frontend-scan findings)
// ---------------------------------------------------------------------------

describe('React/TypeScript V3 pack pair — refinement filters', () => {
  function run(singleFile: Map<string, string>, runId: string) {
    return runV3Pipeline(singleFile, runId);
  }

  it('skips router-config names (AppRoutes, Routes, Router) — not a ui_screen, not a ui_component', () => {
    const src = `
      import React from 'react';
      export function AppRoutes(): JSX.Element { return <div />; }
      export function Routes(): JSX.Element { return <div />; }
      export function MainRouter(): JSX.Element { return <div />; }
    `;
    const candidates = run(new Map([['src/routes/AppRoutes.tsx', src]]), 'refine-test');
    const uiNames = candidates
      .filter((c: any) => c.candidateType === 'ui_screens' || c.candidateType === 'ui_components')
      .map((c: any) => c.name);
    expect(uiNames).not.toContain('AppRoutes');
    expect(uiNames).not.toContain('Routes');
    expect(uiNames).not.toContain('MainRouter');
  });

  it('skips CRUD-verb-prefixed functions from business_logic (create/update/delete/save/find/etc.)', () => {
    const src = `
      export async function deleteReportDefinition(id: number) { return null; }
      export async function createScenario(data: any) { return null; }
      export async function updateUser(id: number) { return null; }
      export async function fetchSomething() { return null; }
      export async function loadConfiguration() { return null; }
      export async function listAllPolicies() { return null; }
      export async function saveDocument(doc: any) { return null; }
      export async function findUserById(id: number) { return null; }
      // Genuine business logic — should still be emitted
      export async function evaluatePolicy(p: any) { return true; }
      export async function normalizeResult(r: any) { return r; }
    `;
    const candidates = run(new Map([['src/services/scenarioApi.ts', src]]), 'refine-test');
    const businessLogicNames = candidates
      .filter((c: any) => c.candidateType === 'business_logics')
      .map((c: any) => c.name)
      .sort();
    expect(businessLogicNames).toEqual(['evaluatePolicy', 'normalizeResult']);
  });

  it('skips Redux-Saga plumbing from business_logic', () => {
    const src = `
      export function rootSaga() { return null; }
      export function scenarioSaga() { return null; }
      export function watcherSaga() { return null; }
      export function evaluateScenario() { return true; }
    `;
    const candidates = run(new Map([['src/store/sagas.ts', src]]), 'refine-test');
    const businessLogicNames = candidates
      .filter((c: any) => c.candidateType === 'business_logics')
      .map((c: any) => c.name);
    expect(businessLogicNames).not.toContain('rootSaga');
    expect(businessLogicNames).not.toContain('scenarioSaga');
    expect(businessLogicNames).not.toContain('watcherSaga');
    expect(businessLogicNames).toContain('evaluateScenario');
  });
});
