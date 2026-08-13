/**
 * Shared API-auth fields (2026-08-13) — ONE auth surface for every place an
 * operator supplies API credentials.
 *
 * Extracted from the API Behaviour Baseline Capture wizard (Step 2) so the
 * Start-stage dialog offers the SAME methods — the live gap: internal
 * systems authenticate with the `ssoToken` header, which the capture wizard
 * supported and the Start Stage 2 modal (none | bearer only) did not.
 *
 * Options and semantics mirror the wizard verbatim:
 *   none | bearer | basic | sso_token (fixed `ssoToken` header, value
 *   trimmed) | header (custom name + value).
 *
 * The component is presentational: the caller owns the state (one flat
 * value object) and the styling (its own CSS-module class names), and test
 * ids derive from `testIdPrefix` — the wizard keeps its historical
 * `start-capture-session-wizard-*` ids unchanged.
 */
import React from 'react';

export type ApiAuthType = 'none' | 'bearer' | 'basic' | 'sso_token' | 'header';

export interface ApiAuthValue {
  authType: ApiAuthType;
  bearerToken: string;
  basicUsername: string;
  basicPassword: string;
  ssoToken: string;
  headerName: string;
  headerValue: string;
}

export const EMPTY_API_AUTH: ApiAuthValue = {
  authType: 'none',
  bearerToken: '',
  basicUsername: '',
  basicPassword: '',
  ssoToken: '',
  headerName: '',
  headerValue: '',
};

/**
 * Map the form value to the gateway/AMVS `ApiAuthSecret` wire shape
 * (`migrationTargetCredentialsStore.TargetApiAuthSecret`): `sso_token` is
 * convenience sugar for a fixed-name custom header (`ssoToken`, value
 * trimmed so a stray copied space/newline cannot corrupt the token —
 * the capture wizard's exact rule).
 */
export function toApiAuthSecret(v: ApiAuthValue): {
  type: 'none' | 'bearer' | 'basic' | 'custom_header';
  bearerToken?: string;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
} {
  switch (v.authType) {
    case 'bearer':
      return { type: 'bearer', bearerToken: v.bearerToken };
    case 'basic':
      return { type: 'basic', username: v.basicUsername, password: v.basicPassword };
    case 'sso_token':
      return {
        type: 'custom_header',
        headerName: 'ssoToken',
        headerValue: v.ssoToken.trim(),
      };
    case 'header':
      return {
        type: 'custom_header',
        headerName: v.headerName,
        headerValue: v.headerValue,
      };
    case 'none':
    default:
      return { type: 'none' };
  }
}

export interface ApiAuthFieldsProps {
  value: ApiAuthValue;
  /** Partial-update callback: `onChange({ bearerToken: '…' })`. */
  onChange: (patch: Partial<ApiAuthValue>) => void;
  /** Caller's CSS-module classes (each surface keeps its own look). */
  classNames: {
    fieldGroup: string;
    label: string;
    input: string;
    select: string;
  };
  /** Test-id prefix, e.g. `start-capture-session-wizard` -> `…-auth-type`. */
  testIdPrefix: string;
  /** Optional id for the auth-type select (label htmlFor). */
  selectId?: string;
  /** Optional label text override (default "Auth type"). */
  selectLabel?: string;
}

export const ApiAuthFields: React.FC<ApiAuthFieldsProps> = ({
  value,
  onChange,
  classNames: cx,
  testIdPrefix,
  selectId,
  selectLabel,
}) => (
  <>
    <div className={cx.fieldGroup}>
      <label className={cx.label} htmlFor={selectId}>
        {selectLabel ?? 'Auth type'}
      </label>
      <select
        id={selectId}
        className={cx.select}
        value={value.authType}
        onChange={(e) => onChange({ authType: e.target.value as ApiAuthType })}
        data-testid={`${testIdPrefix}-auth-type`}
      >
        <option value="none">None</option>
        <option value="bearer">Bearer token</option>
        <option value="basic">Basic</option>
        <option value="sso_token">ssoToken (in header)</option>
        <option value="header">Custom header</option>
      </select>
    </div>
    {value.authType === 'bearer' && (
      <div className={cx.fieldGroup}>
        <label className={cx.label}>Bearer token</label>
        <input
          type="password"
          className={cx.input}
          value={value.bearerToken}
          onChange={(e) => onChange({ bearerToken: e.target.value })}
          data-testid={`${testIdPrefix}-bearer-token`}
        />
      </div>
    )}
    {value.authType === 'basic' && (
      <>
        <div className={cx.fieldGroup}>
          <label className={cx.label}>Username</label>
          <input
            className={cx.input}
            value={value.basicUsername}
            onChange={(e) => onChange({ basicUsername: e.target.value })}
            data-testid={`${testIdPrefix}-basic-username`}
          />
        </div>
        <div className={cx.fieldGroup}>
          <label className={cx.label}>Password</label>
          <input
            type="password"
            className={cx.input}
            value={value.basicPassword}
            onChange={(e) => onChange({ basicPassword: e.target.value })}
            data-testid={`${testIdPrefix}-basic-password`}
          />
        </div>
      </>
    )}
    {value.authType === 'sso_token' && (
      <div className={cx.fieldGroup}>
        <label className={cx.label}>SSO token value</label>
        <input
          type="password"
          className={cx.input}
          value={value.ssoToken}
          onChange={(e) => onChange({ ssoToken: e.target.value })}
          data-testid={`${testIdPrefix}-sso-token`}
          placeholder="Paste the ssoToken value — sent as the 'ssoToken' header (spaces trimmed)"
        />
      </div>
    )}
    {value.authType === 'header' && (
      <>
        <div className={cx.fieldGroup}>
          <label className={cx.label}>Header name</label>
          <input
            className={cx.input}
            value={value.headerName}
            onChange={(e) => onChange({ headerName: e.target.value })}
            data-testid={`${testIdPrefix}-header-name`}
          />
        </div>
        <div className={cx.fieldGroup}>
          <label className={cx.label}>Header value</label>
          <input
            type="password"
            className={cx.input}
            value={value.headerValue}
            onChange={(e) => onChange({ headerValue: e.target.value })}
            data-testid={`${testIdPrefix}-header-value`}
          />
        </div>
      </>
    )}
  </>
);

export default ApiAuthFields;
