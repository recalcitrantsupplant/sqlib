/**
 * The last run of a record, kept in the browser until the next one.
 *
 * What it is for: opening another record and coming back used to lose the
 * result you were reading, so the rows had to be fetched again to be read
 * again. What it must not become: a place large results accumulate, since it
 * shares one origin's storage with the scratch store and the verdict cache.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  forgetLastRun,
  loadLastRun,
  runCacheKey,
  saveLastRun,
} from '@/lib/lastRunCache';

const QUERY = runCacheKey('query', 'urn:sqlib:query:q1');
const OTHER = runCacheKey('query', 'urn:sqlib:query:q2');

beforeEach(() => {
  window.localStorage.clear();
});

describe('runCacheKey', () => {
  it('keeps kinds and unsaved records apart', () => {
    expect(runCacheKey('query', 'x')).toBe('query:x');
    expect(runCacheKey('rule-set', 'x')).not.toBe(runCacheKey('query', 'x'));
    expect(runCacheKey('query-scratch', 'x')).not.toBe(runCacheKey('query', 'x'));
  });

  /* A record being created has no id yet, and no run worth keeping. */
  it('has no key for a record with no id', () => {
    expect(runCacheKey('query', null)).toBeNull();
    expect(loadLastRun(null)).toBeNull();
    expect(() => saveLastRun(null, { rows: 1 })).not.toThrow();
  });
});

describe('lastRunCache', () => {
  it('gives back the run it was given, per record', () => {
    saveLastRun(QUERY, { rawContent: 'q1 rows' });
    saveLastRun(OTHER, { rawContent: 'q2 rows' });

    expect(loadLastRun<{ rawContent: string }>(QUERY)?.rawContent).toBe('q1 rows');
    expect(loadLastRun<{ rawContent: string }>(OTHER)?.rawContent).toBe('q2 rows');
  });

  /* The *last* run: a record has one result, not a history. */
  it('replaces a record\'s run rather than keeping both', () => {
    saveLastRun(QUERY, { rawContent: 'first' });
    saveLastRun(QUERY, { rawContent: 'second' });

    expect(loadLastRun<{ rawContent: string }>(QUERY)?.rawContent).toBe('second');
    expect(JSON.parse(window.localStorage.getItem('sqlib.lastRuns.v1') ?? '{}')).toHaveProperty(
      QUERY as string,
    );
  });

  it('forgets one record without touching another', () => {
    saveLastRun(QUERY, { rawContent: 'q1' });
    saveLastRun(OTHER, { rawContent: 'q2' });

    forgetLastRun(QUERY);

    expect(loadLastRun(QUERY)).toBeNull();
    expect(loadLastRun<{ rawContent: string }>(OTHER)?.rawContent).toBe('q2');
  });

  /*
   * A CONSTRUCT over a large graph can answer with megabytes. Keeping one
   * would evict every other record's run to hold it, then be evicted itself by
   * the next one — so it is not kept, and neither is the older run it would
   * otherwise sit beside, which would claim to be this record's latest.
   */
  it('keeps no run at all rather than an enormous one', () => {
    saveLastRun(QUERY, { rawContent: 'small' });
    saveLastRun(QUERY, { rawContent: 'x'.repeat(1_100_000) });

    expect(loadLastRun(QUERY)).toBeNull();
  });

  it('evicts the oldest record when the budget is reached', () => {
    const big = 'x'.repeat(900_000);
    saveLastRun(runCacheKey('query', 'a'), { rawContent: big });
    saveLastRun(runCacheKey('query', 'b'), { rawContent: big });
    saveLastRun(runCacheKey('query', 'c'), { rawContent: big });

    expect(loadLastRun(runCacheKey('query', 'a'))).toBeNull();
    expect(loadLastRun(runCacheKey('query', 'c'))).not.toBeNull();
  });

  it('survives a payload another version of the app wrote', () => {
    window.localStorage.setItem('sqlib.lastRuns.v1', '{"query:q1": "not an entry"}');
    expect(loadLastRun(QUERY)).toBeNull();

    saveLastRun(QUERY, { rawContent: 'after' });
    expect(loadLastRun<{ rawContent: string }>(QUERY)?.rawContent).toBe('after');
  });

  it('survives a storage that refuses to answer', () => {
    window.localStorage.setItem('sqlib.lastRuns.v1', 'not json at all');
    expect(loadLastRun(QUERY)).toBeNull();
  });
});
