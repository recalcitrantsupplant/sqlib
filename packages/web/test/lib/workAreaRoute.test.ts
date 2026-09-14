import { describe, expect, it } from 'vitest';
import { workAreaRouteFor } from '../../src/lib/callables';

const query = { id: 'urn:query:1', type: 'query' as const, state: 'live' as const };
const group = { id: 'urn:group:1', type: 'group' as const, state: 'live' as const };

describe('workAreaRouteFor', () => {
  it('opens a live query and a live group by their own id', () => {
    expect(workAreaRouteFor(query, null)).toEqual({ query: 'urn:query:1' });
    expect(workAreaRouteFor(group, null)).toEqual({ queryGroup: 'urn:group:1' });
  });

  it('opens an assistant-written draft as scratch, not as a query', () => {
    /*
     * The bug this pins: a draft the assistant staged has a `urn:ui-temp:` id
     * and nothing behind it, and `?query=` resolves that against the server,
     * where it does not exist — so the row opened an empty work area.
     */
    const draft = { id: 'urn:ui-temp:abc', type: 'query' as const, state: 'draft' as const };
    expect(workAreaRouteFor(draft, null)).toEqual({ scratch: 'urn:ui-temp:abc' });
  });

  it('opens a draft of an existing query as that query', () => {
    // The body is an edit of a live query, so the work area loads the query and
    // lays the draft over it — scratch would strand it away from its versions.
    const draft = { id: 'urn:ui-temp:draft-of-urn:query:1', type: 'query' as const, state: 'draft' as const };
    expect(workAreaRouteFor(draft, 'urn:query:1')).toEqual({ query: 'urn:query:1' });
  });

  it('sends a draft group to scratch too, since scratch holds every section', () => {
    const draft = { id: 'urn:ui-temp:g', type: 'group' as const, state: 'draft' as const };
    expect(workAreaRouteFor(draft, null)).toEqual({ scratch: 'urn:ui-temp:g' });
  });
});
