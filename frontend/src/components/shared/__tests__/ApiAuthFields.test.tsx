/**
 * Shared API-auth fields (2026-08-13) — the ONE auth surface for the capture
 * wizard AND the Start-stage dialog. Pins:
 *   - all five methods render (the live gap: Start Stage 2 offered
 *     none|bearer while internal systems need the ssoToken header);
 *   - per-type fields appear and patch the caller's value;
 *   - toApiAuthSecret maps to the gateway/AMVS ApiAuthSecret shape
 *     (sso_token -> fixed `ssoToken` custom header, value TRIMMED).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ApiAuthFields, {
  EMPTY_API_AUTH,
  toApiAuthSecret,
  type ApiAuthValue,
} from '../ApiAuthFields';

const CX = { fieldGroup: 'fg', label: 'lb', input: 'in', select: 'se' };

function renderFields(value: ApiAuthValue, onChange = vi.fn()) {
  render(
    <ApiAuthFields
      value={value}
      onChange={onChange}
      classNames={CX}
      testIdPrefix="t"
    />,
  );
  return onChange;
}

describe('ApiAuthFields', () => {
  it('offers ALL five methods (the capture-wizard surface)', () => {
    renderFields({ ...EMPTY_API_AUTH });
    const options = Array.from(
      screen.getByTestId('t-auth-type').querySelectorAll('option'),
    ).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['none', 'bearer', 'basic', 'sso_token', 'header']);
  });

  it('renders the per-type fields and patches the value', () => {
    const onChange = renderFields({ ...EMPTY_API_AUTH, authType: 'sso_token' });
    const sso = screen.getByTestId('t-sso-token');
    fireEvent.change(sso, { target: { value: 'tok-1' } });
    expect(onChange).toHaveBeenCalledWith({ ssoToken: 'tok-1' });
  });

  it('renders basic + custom-header fields for their types', () => {
    renderFields({ ...EMPTY_API_AUTH, authType: 'basic' });
    expect(screen.getByTestId('t-basic-username')).toBeInTheDocument();
    expect(screen.getByTestId('t-basic-password')).toBeInTheDocument();
  });
});

describe('toApiAuthSecret', () => {
  it('sso_token maps to the FIXED ssoToken custom header with a trimmed value', () => {
    expect(
      toApiAuthSecret({ ...EMPTY_API_AUTH, authType: 'sso_token', ssoToken: '  tok-9\n' }),
    ).toEqual({ type: 'custom_header', headerName: 'ssoToken', headerValue: 'tok-9' });
  });

  it('maps the remaining types to the gateway ApiAuthSecret shape', () => {
    expect(toApiAuthSecret({ ...EMPTY_API_AUTH })).toEqual({ type: 'none' });
    expect(
      toApiAuthSecret({ ...EMPTY_API_AUTH, authType: 'bearer', bearerToken: 'b' }),
    ).toEqual({ type: 'bearer', bearerToken: 'b' });
    expect(
      toApiAuthSecret({
        ...EMPTY_API_AUTH,
        authType: 'basic',
        basicUsername: 'u',
        basicPassword: 'p',
      }),
    ).toEqual({ type: 'basic', username: 'u', password: 'p' });
    expect(
      toApiAuthSecret({
        ...EMPTY_API_AUTH,
        authType: 'header',
        headerName: 'X-Auth',
        headerValue: 'v',
      }),
    ).toEqual({ type: 'custom_header', headerName: 'X-Auth', headerValue: 'v' });
  });
});
