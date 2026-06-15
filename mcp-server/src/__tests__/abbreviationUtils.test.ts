import {
  generateInitials,
  getUniqueAbbreviation,
  ensureAbbreviations,
} from '../utils/abbreviationUtils';

describe('generateInitials', () => {
  it('extracts first letter of each word', () => {
    expect(generateInitials('Market Data Manager')).toBe('MDM');
  });

  it('handles single word', () => {
    expect(generateInitials('Admin')).toBe('A');
  });

  it('handles extra whitespace', () => {
    expect(generateInitials('  Strategic   Risk  Store  ')).toBe('SRS');
  });

  it('returns empty for empty string', () => {
    expect(generateInitials('')).toBe('');
  });

  it('uppercases all letters', () => {
    expect(generateInitials('order placement service')).toBe('OPS');
  });
});

describe('getUniqueAbbreviation', () => {
  it('returns initials when no collision', () => {
    const taken = new Set<string>();
    expect(getUniqueAbbreviation('Market Data Manager', taken)).toBe('MDM');
  });

  it('appends 2 on first collision', () => {
    const taken = new Set(['MDM']);
    expect(getUniqueAbbreviation('Market Data Manager', taken)).toBe('MDM2');
  });

  it('increments past existing numbered collisions', () => {
    const taken = new Set(['MDM', 'MDM2', 'MDM3']);
    expect(getUniqueAbbreviation('Market Data Manager', taken)).toBe('MDM4');
  });

  it('is case-insensitive when checking collisions', () => {
    const taken = new Set(['mdm']);
    expect(getUniqueAbbreviation('Market Data Manager', taken)).toBe('MDM2');
  });

  it('returns empty for empty name', () => {
    const taken = new Set<string>();
    expect(getUniqueAbbreviation('', taken)).toBe('');
  });
});

describe('ensureAbbreviations', () => {
  it('fills missing abbreviations for business_users', () => {
    const model = {
      metaModel: {
        entities: {
          business_users: [
            { name: 'Market Data Manager', abbreviation: '' },
            { name: 'Sales Rep', abbreviation: '' },
          ],
          applications: [],
        },
      },
    };

    ensureAbbreviations(model);

    expect(model.metaModel.entities.business_users[0].abbreviation).toBe('MDM');
    expect(model.metaModel.entities.business_users[1].abbreviation).toBe('SR');
  });

  it('fills missing abbreviations for applications', () => {
    const model = {
      metaModel: {
        entities: {
          business_users: [],
          applications: [
            { name: 'Strategic Risk Store', abbreviation: '' },
            { name: 'Core Application', abbreviation: '' },
          ],
        },
      },
    };

    ensureAbbreviations(model);

    expect(model.metaModel.entities.applications[0].abbreviation).toBe('SRS');
    expect(model.metaModel.entities.applications[1].abbreviation).toBe('CA');
  });

  it('preserves existing abbreviations', () => {
    const model = {
      metaModel: {
        entities: {
          business_users: [
            { name: 'Market Data Manager', abbreviation: 'MKTDM' },
          ],
          applications: [],
        },
      },
    };

    ensureAbbreviations(model);

    expect(model.metaModel.entities.business_users[0].abbreviation).toBe('MKTDM');
  });

  it('avoids collisions with existing abbreviations', () => {
    const model = {
      metaModel: {
        entities: {
          business_users: [
            { name: 'Market Data Manager', abbreviation: 'MDM' },
            { name: 'Master Data Management', abbreviation: '' },
          ],
          applications: [],
        },
      },
    };

    ensureAbbreviations(model);

    expect(model.metaModel.entities.business_users[0].abbreviation).toBe('MDM');
    expect(model.metaModel.entities.business_users[1].abbreviation).toBe('MDM2');
  });

  it('handles sequentially generated collisions', () => {
    const model = {
      metaModel: {
        entities: {
          business_users: [
            { name: 'Market Data Manager', abbreviation: '' },
            { name: 'Master Data Migration', abbreviation: '' },
            { name: 'Metadata Management', abbreviation: '' },
          ],
          applications: [],
        },
      },
    };

    ensureAbbreviations(model);

    expect(model.metaModel.entities.business_users[0].abbreviation).toBe('MDM');
    expect(model.metaModel.entities.business_users[1].abbreviation).toBe('MDM2');
    expect(model.metaModel.entities.business_users[2].abbreviation).toBe('MM');
  });

  it('handles null/undefined model gracefully', () => {
    expect(() => ensureAbbreviations(null)).not.toThrow();
    expect(() => ensureAbbreviations(undefined)).not.toThrow();
    expect(() => ensureAbbreviations({})).not.toThrow();
    expect(() => ensureAbbreviations({ metaModel: {} })).not.toThrow();
  });

  it('handles missing entity arrays gracefully', () => {
    const model = {
      metaModel: {
        entities: {},
      },
    };
    expect(() => ensureAbbreviations(model)).not.toThrow();
  });

  it('does not touch entities that already have abbreviations even if duplicated', () => {
    const model = {
      metaModel: {
        entities: {
          business_users: [
            { name: 'Admin', abbreviation: 'A' },
            { name: 'Agent', abbreviation: 'A' },
          ],
          applications: [],
        },
      },
    };

    ensureAbbreviations(model);

    // Both keep their existing (colliding) abbreviation — UI validation flags this
    expect(model.metaModel.entities.business_users[0].abbreviation).toBe('A');
    expect(model.metaModel.entities.business_users[1].abbreviation).toBe('A');
  });
});
