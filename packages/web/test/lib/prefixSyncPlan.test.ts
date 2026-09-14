/**
 * The merge matrix from the design doc (§3), as a table.
 *
 * This is where the feature is correct or not, and none of it needs a DOM.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SYNC_OPTIONS,
  planPrefixSync,
  resolveConflict,
  unresolvedConflicts,
  type PrefixSyncAction,
  type PrefixSyncInput,
} from '@/lib/prefixSyncPlan';
import type { PrefixMapping } from '@/types/prefixes';

function mapping(overrides: Partial<PrefixMapping> & { prefix: string; namespace: string }): PrefixMapping {
  return {
    id: `id-${overrides.prefix}`,
    enabled: true,
    isDefault: false,
    source: 'user-added',
    createdAt: 0,
    ...overrides,
  };
}

function input(overrides: Partial<PrefixSyncInput> = {}): PrefixSyncInput {
  const local = overrides.local ?? [];
  return {
    backendId: 'urn:sqlib:backend:store',
    direction: 'bidirectional',
    options: DEFAULT_SYNC_OPTIONS,
    local,
    effectiveIds: overrides.effectiveIds ?? new Set(local.map((m) => m.id)),
    remote: [],
    baseline: null,
    ...overrides,
  };
}

/** Actions as compact strings, so a table row reads as one expectation. */
function summarize(actions: PrefixSyncAction[]): string[] {
  return actions.map((action) => {
    switch (action.kind) {
      case 'pull-add': return `pull-add ${action.prefix}=${action.namespace}`;
      case 'pull-update': return `pull-update ${action.prefix}: ${action.from} → ${action.to}`;
      case 'pull-delete': return `pull-delete ${action.prefix}`;
      case 'push-add': return `push-add ${action.prefix}=${action.namespace}`;
      case 'push-update': return `push-update ${action.prefix}: ${action.from} → ${action.to}`;
      case 'push-delete': return `push-delete ${action.prefix}`;
      case 'conflict': return `conflict ${action.prefix}: ${action.local} vs ${action.remote}`;
    }
  });
}

const A = 'http://a.example/';
const B = 'http://b.example/';
const C = 'http://c.example/';

describe('planPrefixSync', () => {
  describe('pull', () => {
    it('adds what the store has and we lack', () => {
      const plan = planPrefixSync(input({ direction: 'pull', remote: [{ prefix: 'ex', namespace: A }] }));

      expect(summarize(plan.actions)).toEqual([`pull-add ex=${A}`]);
    });

    it('updates a local mapping the store disagrees with', () => {
      const plan = planPrefixSync(input({
        direction: 'pull',
        local: [mapping({ prefix: 'ex', namespace: B })],
        remote: [{ prefix: 'ex', namespace: A }],
      }));

      expect(summarize(plan.actions)).toEqual([`pull-update ex: ${B} → ${A}`]);
    });

    it('leaves local-only mappings alone unless mirroring', () => {
      const local = [mapping({ prefix: 'mine', namespace: B })];

      expect(planPrefixSync(input({ direction: 'pull', local })).actions).toEqual([]);
      expect(summarize(planPrefixSync(input({
        direction: 'pull',
        local,
        options: { ...DEFAULT_SYNC_OPTIONS, mirror: true },
      })).actions)).toEqual(['pull-delete mine']);
    });

    it('never rewrites a default in place, adding the store value alongside instead', () => {
      const plan = planPrefixSync(input({
        direction: 'pull',
        local: [mapping({ prefix: 'rdf', namespace: B, isDefault: true, source: 'default' })],
        remote: [{ prefix: 'rdf', namespace: A }],
      }));

      expect(plan.actions[0]).toMatchObject({ kind: 'pull-add', prefix: 'rdf', namespace: A });
      expect((plan.actions[0] as { note?: string }).note).toContain('alongside');
    });

    it('never removes a default on a mirror, and says why', () => {
      const plan = planPrefixSync(input({
        direction: 'pull',
        local: [mapping({ prefix: 'rdf', namespace: B, isDefault: true, source: 'default' })],
        options: { ...DEFAULT_SYNC_OPTIONS, mirror: true },
      }));

      expect(plan.actions).toEqual([]);
      expect(plan.skipped[0].reason).toContain('default');
    });
  });

  describe('push', () => {
    it('sends what the store lacks and corrects what it disagrees with', () => {
      const plan = planPrefixSync(input({
        direction: 'push',
        local: [mapping({ prefix: 'new', namespace: A }), mapping({ prefix: 'old', namespace: B })],
        remote: [{ prefix: 'old', namespace: C }],
      }));

      expect(summarize(plan.actions)).toEqual([`push-add new=${A}`, `push-update old: ${C} → ${B}`]);
    });

    it('leaves defaults out of the push by default', () => {
      const plan = planPrefixSync(input({
        direction: 'push',
        local: [mapping({ prefix: 'rdf', namespace: A, isDefault: true, source: 'default' })],
      }));

      expect(plan.actions).toEqual([]);
      expect(plan.skipped[0].reason).toContain('default');
    });

    it('pushes defaults when the user asks for them', () => {
      const plan = planPrefixSync(input({
        direction: 'push',
        local: [mapping({ prefix: 'rdf', namespace: A, isDefault: true, source: 'default' })],
        options: { ...DEFAULT_SYNC_OPTIONS, pushSources: ['default'] },
      }));

      expect(summarize(plan.actions)).toEqual([`push-add rdf=${A}`]);
    });

    it('skips disabled and shadowed mappings, saying which is which', () => {
      const shadowed = mapping({ prefix: 'ex', namespace: C, id: 'shadowed' });
      const plan = planPrefixSync(input({
        direction: 'push',
        local: [mapping({ prefix: 'off', namespace: A, enabled: false }), shadowed],
        effectiveIds: new Set<string>(),
      }));

      expect(plan.actions).toEqual([]);
      expect(plan.skipped.map((entry) => entry.reason)).toEqual(['Disabled', 'Shadowed by another mapping']);
    });

    it('does not try to send the empty prefix the store will not hold', () => {
      const plan = planPrefixSync(input({ direction: 'push', local: [mapping({ prefix: '', namespace: A })] }));

      expect(plan.actions).toEqual([]);
      expect(plan.skipped[0].reason).toContain('empty prefix');
    });

    it('deletes remote-only prefixes only when mirroring', () => {
      const remote = [{ prefix: 'theirs', namespace: A }];

      expect(planPrefixSync(input({ direction: 'push', remote })).actions).toEqual([]);
      expect(summarize(planPrefixSync(input({
        direction: 'push',
        remote,
        options: { ...DEFAULT_SYNC_OPTIONS, mirror: true },
      })).actions)).toEqual(['push-delete theirs']);
    });
  });

  /**
   * The table from §3C. Each row is one prefix: what we hold, what the store
   * holds, what the baseline says, and the single action that should follow.
   */
  describe('bidirectional', () => {
    type Row = [name: string, local: string | null, remote: string | null, base: string | null, expected: string[]];

    const rows: Row[] = [
      ['both agree', A, A, A, []],
      ['converged since baseline', A, A, B, []],
      ['only the store changed', A, B, A, [`pull-update ex: ${A} → ${B}`]],
      ['only we changed', A, B, B, [`push-update ex: ${B} → ${A}`]],
      ['both changed, differently', A, B, C, [`conflict ex: ${A} vs ${B}`]],
      ['added here', A, null, null, [`push-add ex=${A}`]],
      ['added there', null, A, null, [`pull-add ex=${A}`]],
      ['deleted there', A, null, A, ['pull-delete ex']],
      ['deleted here', null, A, A, ['push-delete ex']],
      ['deleted there, edited here', B, null, A, [`conflict ex: ${B} vs null`]],
      ['deleted here, edited there', null, B, A, [`conflict ex: null vs ${B}`]],
      ['first sync, values agree', A, A, null, []],
      ['first sync, values differ', A, B, null, [`conflict ex: ${A} vs ${B}`]],
    ];

    it.each(rows)('%s', (_name, local, remote, base, expected) => {
      const plan = planPrefixSync(input({
        direction: 'bidirectional',
        local: local === null ? [] : [mapping({ prefix: 'ex', namespace: local })],
        remote: remote === null ? [] : [{ prefix: 'ex', namespace: remote }],
        baseline: base === null ? null : { ex: base },
      }));

      expect(summarize(plan.actions)).toEqual(expected);
    });

    it('is blocked while a conflict is unanswered and clear once it is not', () => {
      const plan = planPrefixSync(input({
        direction: 'bidirectional',
        local: [mapping({ prefix: 'ex', namespace: A })],
        remote: [{ prefix: 'ex', namespace: B }],
      }));

      expect(plan.blocked).toBe(true);
      expect(unresolvedConflicts(plan)).toBe(1);

      (plan.actions[0] as { resolution: string }).resolution = 'remote';

      expect(plan.blocked).toBe(false);
      expect(unresolvedConflicts(plan)).toBe(0);
    });

    it('merges the two sides when neither has ever synced', () => {
      const plan = planPrefixSync(input({
        direction: 'bidirectional',
        local: [mapping({ prefix: 'mine', namespace: A })],
        remote: [{ prefix: 'theirs', namespace: B }],
      }));

      expect(summarize(plan.actions).sort()).toEqual([`pull-add theirs=${B}`, `push-add mine=${A}`]);
    });
  });
});

describe('resolveConflict', () => {
  const conflict = (overrides: Record<string, unknown> = {}) => ({
    kind: 'conflict' as const,
    prefix: 'ex',
    local: A,
    localId: 'id-ex',
    remote: B,
    resolution: null,
    ...overrides,
  });

  it('does nothing for an unresolved or skipped conflict', () => {
    expect(resolveConflict(conflict(), new Set()).actions).toEqual([]);
    expect(resolveConflict(conflict({ resolution: 'skip' }), new Set()).actions).toEqual([]);
  });

  it('keeping local pushes our value over theirs', () => {
    expect(resolveConflict(conflict({ resolution: 'local' }), new Set()).actions).toEqual([
      { kind: 'push-update', prefix: 'ex', from: B, to: A },
    ]);
  });

  it('taking remote rewrites ours', () => {
    expect(resolveConflict(conflict({ resolution: 'remote' }), new Set()).actions).toEqual([
      { kind: 'pull-update', id: 'id-ex', prefix: 'ex', from: A, to: B },
    ]);
  });

  it('taking remote on a delete-vs-edit removes ours', () => {
    expect(resolveConflict(conflict({ resolution: 'remote', remote: null }), new Set()).actions).toEqual([
      { kind: 'pull-delete', id: 'id-ex', prefix: 'ex', namespace: A },
    ]);
  });

  it('keeping both takes the store value and renames ours out of the way', () => {
    const resolved = resolveConflict(conflict({ resolution: 'both' }), new Set(['ex', 'ex-1']));

    expect(resolved.actions).toEqual([{ kind: 'pull-add', prefix: 'ex', namespace: B }]);
    expect(resolved.rename).toEqual({ id: 'id-ex', to: 'ex-2' });
  });
});
