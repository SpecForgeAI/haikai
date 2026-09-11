import React from 'react';

/**
 * SQL Server connection extras (second-pair programme, Spec 7): SQL login or
 * Windows domain (NTLM) authentication, encryption, self-signed certificate
 * trust and a named instance. Shared by every DB credential form so the
 * vocabulary and wire shape are identical everywhere; the discovery scan
 * modal carries the same fields.
 *
 * NO SECRETS: the domain is part of the NTLM principal, not a credential.
 */
export type MssqlAuthScheme = 'sql' | 'ntlm';

export interface MssqlAuthValue {
  scheme: MssqlAuthScheme;
  domain: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  instanceName: string;
}

export const DEFAULT_MSSQL_AUTH: MssqlAuthValue = {
  scheme: 'sql',
  domain: '',
  encrypt: true,
  trustServerCertificate: false,
  instanceName: '',
};

/** The wire object every DB-facing request carries for `mssql` connections. */
export interface MssqlAuthWire {
  scheme: MssqlAuthScheme;
  domain: string | null;
  encrypt: boolean;
  trustServerCertificate: boolean;
  instanceName: string | null;
}

export function toMssqlAuthWire(value: MssqlAuthValue): MssqlAuthWire {
  return {
    scheme: value.scheme,
    domain: value.scheme === 'ntlm' && value.domain.trim() !== '' ? value.domain.trim() : null,
    encrypt: value.encrypt,
    trustServerCertificate: value.trustServerCertificate,
    instanceName: value.instanceName.trim() !== '' ? value.instanceName.trim() : null,
  };
}

export interface MssqlAuthFieldsProps {
  value: MssqlAuthValue;
  onChange: (next: MssqlAuthValue) => void;
  disabled?: boolean;
  /** Prefix for data-testids (`<prefix>-scheme`, `-domain`, `-instance`, `-encrypt`, `-trust`). */
  testIdPrefix: string;
  /** Optional class hooks so the block matches its host form. */
  classNames?: { group?: string; label?: string; input?: string; select?: string; hint?: string };
}

export const MssqlAuthFields: React.FC<MssqlAuthFieldsProps> = ({ value, onChange, disabled, testIdPrefix, classNames }) => {
  const cn = classNames ?? {};
  const set = <K extends keyof MssqlAuthValue>(key: K, v: MssqlAuthValue[K]): void => onChange({ ...value, [key]: v });
  return (
    <div data-testid={`${testIdPrefix}-block`}>
      <div className={cn.group}>
        <label className={cn.label} htmlFor={`${testIdPrefix}-scheme`}>
          Authentication
        </label>
        <select
          id={`${testIdPrefix}-scheme`}
          className={cn.select ?? cn.input}
          value={value.scheme}
          onChange={(e) => set('scheme', e.target.value === 'ntlm' ? 'ntlm' : 'sql')}
          disabled={disabled}
          data-testid={`${testIdPrefix}-scheme`}
        >
          <option value="sql">SQL login</option>
          <option value="ntlm">Windows domain (NTLM)</option>
        </select>
        <span className={cn.hint}>A SQL login needs the instance in Mixed Mode authentication. Kerberos single sign-on is not supported.</span>
      </div>
      {value.scheme === 'ntlm' && (
        <div className={cn.group}>
          <label className={cn.label} htmlFor={`${testIdPrefix}-domain`}>
            Windows domain
          </label>
          <input
            id={`${testIdPrefix}-domain`}
            type="text"
            className={cn.input}
            value={value.domain}
            onChange={(e) => set('domain', e.target.value)}
            disabled={disabled}
            data-testid={`${testIdPrefix}-domain`}
          />
        </div>
      )}
      <div className={cn.group}>
        <label className={cn.label} htmlFor={`${testIdPrefix}-instance`}>
          Named instance (optional)
        </label>
        <input
          id={`${testIdPrefix}-instance`}
          type="text"
          className={cn.input}
          value={value.instanceName}
          onChange={(e) => set('instanceName', e.target.value)}
          disabled={disabled}
          data-testid={`${testIdPrefix}-instance`}
        />
        <span className={cn.hint}>Leave blank for the default instance. The port is still used.</span>
      </div>
      <div className={cn.group}>
        <label className={cn.label}>
          <input
            type="checkbox"
            checked={value.encrypt}
            onChange={(e) => set('encrypt', e.target.checked)}
            disabled={disabled}
            data-testid={`${testIdPrefix}-encrypt`}
          />{' '}
          Encrypt the connection (driver default)
        </label>
      </div>
      <div className={cn.group}>
        <label className={cn.label}>
          <input
            type="checkbox"
            checked={value.trustServerCertificate}
            onChange={(e) => set('trustServerCertificate', e.target.checked)}
            disabled={disabled}
            data-testid={`${testIdPrefix}-trust`}
          />{' '}
          Trust the server certificate (self-signed corporate certificates)
        </label>
      </div>
    </div>
  );
};
