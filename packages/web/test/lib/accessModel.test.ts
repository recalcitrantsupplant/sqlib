import { describe, it, expect } from 'vitest';
import type { Grant } from '@/composables/useApiClient';
import {
  backendLevelChip,
  describeBackendModes,
  describeLibraryModes,
  effectiveAccess,
  levelOf,
  libraryGrantChips,
  modesOfRole,
  roleOf,
  splitIri,
  withLevel,
} from '@/lib/accessModel';

const grant = (principal: string, resource: string, modes: string[], resourceKind: Grant['resourceKind'] = 'library'): Grant =>
  ({ id: `${principal}-${resource}`, principal, resource, resourceKind, modes });

describe('library roles', () => {
  it('names a set of modes by the role that is exactly that set', () => {
    expect(roleOf(['read'])).toBe('view');
    expect(roleOf(['execute', 'read'])).toBe('run');
    expect(roleOf(['read', 'execute', 'write'])).toBe('edit');
    expect(roleOf(['read', 'execute', 'write', 'delete', 'control'])).toBe('manage');
  });

  it('calls any other set custom, never the nearest role', () => {
    expect(roleOf(['read', 'write'])).toBe('custom');
    expect(describeLibraryModes(['write', 'read', 'execute', 'delete'])).toBe('read, execute, write, delete');
    expect(describeLibraryModes(['read', 'execute'])).toBe('Run');
  });

  it('gives each role its modes', () => {
    expect(modesOfRole('run')).toEqual(['read', 'execute']);
    expect(modesOfRole('custom')).toEqual([]);
  });
});

describe('backend levels', () => {
  it('reads ad hoc over saved, per operation', () => {
    expect(levelOf(['query:saved', 'query:adhoc'], 'query')).toBe('adhoc');
    expect(levelOf(['query:saved'], 'update')).toBe('none');
  });

  it('replaces one operation and keeps the other', () => {
    expect(withLevel(['query:adhoc', 'update:saved'], 'query', 'none')).toEqual(['update:saved']);
    expect(withLevel(['update:saved'], 'query', 'saved')).toEqual(['update:saved', 'query:saved']);
    expect(describeBackendModes(['query:adhoc'])).toBe('Query ad hoc · Update none');
  });
});

describe('effectiveAccess', () => {
  it('unions grants per resource and lists where each part comes from', () => {
    const grants = [
      grant('alice', 'lib:a', ['read']),
      grant('analysts', 'lib:a', ['execute']),
      grant('analysts', 'be:1', ['query:saved'], 'backend'),
      grant('everyone', 'be:1', ['query:adhoc'], 'backend'),
      grant('bob', 'lib:b', ['read']),
      grant('alice', 'all', ['control'], 'everything'),
    ];
    const access = effectiveAccess(['alice', 'analysts', 'everyone'], grants);
    const library = access.find((entry) => entry.resource === 'lib:a')!;
    const backend = access.find((entry) => entry.resource === 'be:1')!;
    expect([...library.modes].sort()).toEqual(['execute', 'read']);
    expect(library.from).toEqual(['alice', 'analysts']);
    expect(backend.from).toEqual(['analysts', 'everyone']);
    expect(access.map((entry) => entry.resource)).not.toContain('lib:b');
    expect(access.map((entry) => entry.resource)).not.toContain('all');
  });
});

describe('splitIri', () => {
  it('sets the distinctive tail apart from a shortened head', () => {
    expect(splitIri('http://example.org/graph/finance')).toEqual({ head: '…/graph/', tail: 'finance' });
    expect(splitIri('urn:x')).toEqual({ head: '', tail: 'urn:x' });
  });
});

describe('grant chips', () => {
  it('gives a role one chip, with its modes as the tooltip', () => {
    expect(libraryGrantChips(['execute', 'read', 'write'])).toEqual([
      { label: 'Edit', tone: 'edit', title: 'read, execute, write' },
    ]);
  });

  it('gives each mode its own chip when no role matches', () => {
    expect(libraryGrantChips(['execute'])).toEqual([{ label: 'execute', tone: 'run' }]);
    expect(libraryGrantChips(['delete', 'read'])).toEqual([
      { label: 'read', tone: 'view' },
      { label: 'delete', tone: 'manage' },
    ]);
  });

  it('gives each backend operation its level', () => {
    expect(backendLevelChip(['query:adhoc'], 'query')).toEqual({ label: 'ad hoc', tone: 'adhoc' });
    expect(backendLevelChip(['query:adhoc'], 'update')).toEqual({ label: 'none', tone: 'none' });
  });
});
