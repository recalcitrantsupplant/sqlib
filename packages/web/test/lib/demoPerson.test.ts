import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEMO_PERSON_HEADER,
  currentDemoPersonId,
  demoPeopleFrom,
  demoPersonHeaders,
  setDemoPersonId,
} from '@/lib/demoPerson';
import { accountStateOf } from '@/lib/account';

beforeEach(() => {
  setDemoPersonId(null);
});

describe('the demo person', () => {
  it('is a guest with no header until one is chosen', () => {
    expect(currentDemoPersonId()).toBeNull();
    expect(demoPersonHeaders()).toEqual({});
  });

  it('sends the chosen person on every request, and keeps it in storage', () => {
    setDemoPersonId('alice');
    expect(demoPersonHeaders()).toEqual({ [DEMO_PERSON_HEADER]: 'alice' });
    expect(window.localStorage.getItem('sqlib.demoPerson')).toBe('alice');
    setDemoPersonId(null);
    expect(window.localStorage.getItem('sqlib.demoPerson')).toBeNull();
  });

  it('reads the people from /health, and none outside demo mode', () => {
    expect(demoPeopleFrom({ demo: null })).toEqual([]);
    expect(demoPeopleFrom({})).toEqual([]);
    expect(
      demoPeopleFrom({ demo: { people: [{ id: 'dana', name: 'Dana', groups: ['admins', 3], admin: true }, { id: 4 }] } })
    ).toEqual([{ id: 'dana', name: 'Dana', groups: ['admins'], admin: true }]);
  });

  it('makes the account a demo account only on an anonymous deployment', () => {
    expect(accountStateOf({ mode: 'anonymous', signedIn: false, lapsed: false, demoPerson: true })).toBe('demo');
    expect(accountStateOf({ mode: 'anonymous', signedIn: false, lapsed: false })).toBe('guest');
    expect(accountStateOf({ mode: 'required', signedIn: true, lapsed: false, demoPerson: true })).toBe('signed-in');
  });
});
