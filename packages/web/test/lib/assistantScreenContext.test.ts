/**
 * The sender's half of the screen context (#128 item 2).
 *
 * The server parses this again and enforces its own caps — see
 * `api/test/assistant/screen-context.test.ts` — so what is asserted here is
 * that the browser sends something already small and already true: no empty
 * shells, no body without the entity it belongs to, and nothing at all when
 * there is nothing worth saying.
 */
import { describe, expect, it } from 'vitest';
import { buildScreenContext } from '@/lib/assistantScreenContext';

describe('buildScreenContext', () => {
  it('returns null when the screen has nothing to say', () => {
    expect(buildScreenContext({})).toBeNull();
    expect(buildScreenContext({ screen: null, library: null, openEntity: null })).toBeNull();
    expect(buildScreenContext({ screen: '   ' })).toBeNull();
  });

  it('carries the screen, library and open entity', () => {
    expect(
      buildScreenContext({
        screen: 'build',
        library: { id: 'urn:lib:1', name: 'Ops' },
        openEntity: { id: 'urn:q:1', type: 'query', name: 'Recent orders', state: 'draft', tab: 'try' },
      })
    ).toEqual({
      screen: 'build',
      library: { id: 'urn:lib:1', name: 'Ops' },
      openEntity: { id: 'urn:q:1', type: 'query', name: 'Recent orders', state: 'draft', tab: 'try' },
    });
  });

  it('drops empty fields rather than sending them as blanks', () => {
    expect(
      buildScreenContext({
        screen: 'build',
        library: { id: 'urn:lib:1', name: '  ' },
        openEntity: { id: 'urn:q:1', type: null, name: '', state: undefined, tab: null },
      })
    ).toEqual({
      screen: 'build',
      library: { id: 'urn:lib:1' },
      openEntity: { id: 'urn:q:1' },
    });
  });

  it('drops an entity with no id, and the body that came with it', () => {
    expect(
      buildScreenContext({
        screen: 'build',
        openEntity: { name: 'Recent orders' },
        draftBody: 'SELECT * WHERE { ?s ?p ?o }',
      })
    ).toEqual({ screen: 'build' });
  });

  it('sends the body being edited alongside its entity', () => {
    const context = buildScreenContext({
      openEntity: { id: 'urn:q:1' },
      draftBody: 'SELECT * WHERE { ?s ?p ?o }',
    });
    expect(context?.draftBody).toBe('SELECT * WHERE { ?s ?p ?o }');
  });

  it('caps a long body before it reaches the wire', () => {
    const context = buildScreenContext({
      openEntity: { id: 'urn:q:1' },
      draftBody: 'x'.repeat(10_000),
    });
    expect(context?.draftBody).toHaveLength(4_000);
  });

  it('caps a long error too', () => {
    const context = buildScreenContext({ lastError: 'e'.repeat(5_000) });
    expect(context?.lastError).toHaveLength(1_000);
  });

  it('sends an error even with nothing open, since it is what the user is looking at', () => {
    expect(buildScreenContext({ lastError: 'Backend refused: 400' })).toEqual({
      lastError: 'Backend refused: 400',
    });
  });
});
