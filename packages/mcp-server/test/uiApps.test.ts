/**
 * The MCP Apps door, tested where it is decidable without a client: the
 * capability gate, the resource listing, and the binding between a tool and the
 * View it names.
 *
 * The drift test at the bottom is the one that earns its keep. A View's URI is
 * a string in three packages — the catalogue declares it, `packages/mcp-app`
 * serves it, the server publishes both — and nothing but a test stops a rename
 * in one from leaving a tool pointing at a resource that does not exist. The
 * failure mode without it is silent: the host renders nothing and the user is
 * told the tool "worked".
 */
import { describe, expect, it } from 'vitest';
import { catalogueGuide, tools, type ListedTool } from '@sparql-query-lib/tools';
import { views, renderView, canonicalUri, findView, APP_MIME_TYPE } from '@sparql-query-lib/mcp-app';
import {
  advertisesUiExtension,
  listUiResources,
  uiServerCapabilities,
  readUiResource,
  resultUiMeta,
  toolVisibleToModel,
  uiMetadataEnabled,
  withUiMeta,
} from '../src/ui-apps.js';
import { authorizationFromContext } from '../src/index.js';

const uiCapableClient = {
  extensions: {
    'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
  },
};

/**
 * The regression this file exists for.
 *
 * The UI bindings were once gated on the client advertising
 * `io.modelcontextprotocol/ui`, per the specification's SHOULD. Claude
 * advertises `roots` and `elicitation`, no `extensions` key at all, and renders
 * apps anyway — so the gate withheld the binding from the host it mattered most
 * to, and the bench came back as plain text with the server looking, from its
 * own side, entirely correct. ChatGPT does advertise, which is what kept the
 * gate looking right.
 *
 * So: publish always. A test that asserts the metadata is withheld from a
 * client that stays quiet is a test that re-introduces the bug.
 */
describe('publishing the UI bindings', () => {
  it('publishes regardless of what the client advertised', () => {
    expect(uiMetadataEnabled()).toBe(true);
  });

  it('still recognises an advertisement, for diagnostics', () => {
    expect(advertisesUiExtension(uiCapableClient)).toBe(true);
    expect(advertisesUiExtension({ extensions: { 'io.modelcontextprotocol/ui': {} } })).toBe(true);
    expect(
      advertisesUiExtension({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/markdown'] } } })
    ).toBe(false);
    // Claude's shape: no extensions key whatsoever, and it renders anyway.
    expect(advertisesUiExtension({ roots: {}, elicitation: {} })).toBe(false);
    expect(advertisesUiExtension(undefined)).toBe(false);
  });

  it('withholds everything only when explicitly switched off', () => {
    const previous = process.env.MCP_APPS;
    try {
      process.env.MCP_APPS = 'off';
      expect(uiMetadataEnabled()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.MCP_APPS;
      else process.env.MCP_APPS = previous;
    }
  });
});

describe('tool metadata', () => {
  const executeRun: ListedTool = {
    name: 'execute_run',
    description: 'Run a query',
    inputSchema: { type: 'object' },
    ui: { resourceUri: 'ui://sqlib/result' },
  };

  it('publishes _meta.ui with an explicit default visibility when the client renders apps', () => {
    const listed = withUiMeta(executeRun, true) as Record<string, any>;
    expect(listed.name).toBe('execute_run');
    expect(listed._meta.ui.resourceUri).toBe(canonicalUri('ui://sqlib/result'));
    expect(listed._meta.ui.visibility).toEqual(['model', 'app']);
  });

  it('sends the flat spelling alongside the nested one, since hosts differ', () => {
    const listed = withUiMeta(executeRun, true) as Record<string, any>;
    expect(listed._meta['ui/resourceUri']).toBe(listed._meta.ui.resourceUri);

    const result = resultUiMeta({ ui: { resourceUri: 'ui://sqlib/result' } }, true) as Record<string, any>;
    expect(result['ui/resourceUri']).toBe(result.ui.resourceUri);
  });

  it('omits _meta.ui when publishing is switched off, and never leaks the internal binding', () => {
    const listed = withUiMeta(executeRun, false) as Record<string, unknown>;
    expect(listed._meta).toBeUndefined();
    expect(listed.ui).toBeUndefined();
  });

  it('hides an app-only tool from the model either way', () => {
    const appOnly: ListedTool = {
      name: 'app_draft_put',
      description: 'plumbing',
      inputSchema: { type: 'object' },
      ui: { resourceUri: 'ui://sqlib/bench', visibility: ['app'] },
    };
    expect(toolVisibleToModel(appOnly)).toBe(false);
    expect(toolVisibleToModel(executeRun)).toBe(true);
  });

  it('marks a result with the View that renders it, not only the declaration', () => {
    // A host that decorates from `tools/list` alone never learns what to render
    // this call in — and the result is the copy that updates without the host's
    // per-session tool cache being thrown away.
    expect(resultUiMeta({ ui: { resourceUri: 'ui://sqlib/result' } }, true)).toMatchObject({
      ui: { resourceUri: canonicalUri('ui://sqlib/result') },
    });
    expect(resultUiMeta({ ui: { resourceUri: 'ui://sqlib/result' } }, false)).toBeUndefined();
    expect(resultUiMeta(undefined, true)).toBeUndefined();
  });

  it('marks no result of an app-only tool, which a View already open called', () => {
    // The tutorial reads the library through `tags.list` and friends. Their
    // results are data for that View; naming a View on them would invite a
    // host to render a second tutorial for every read.
    expect(resultUiMeta({ ui: { resourceUri: 'ui://sqlib/tutorial', visibility: ['app'] } }, true)).toBeUndefined();
    expect(resultUiMeta({ ui: { resourceUri: 'ui://sqlib/tutorial', visibility: ['model', 'app'] } }, true)).toBeDefined();
  });
});

describe('the tutorial door', () => {
  const byName = (name: string) => tools.find((tool) => tool.name === name)!;

  it('opens on a library, and hides its plumbing from the model', () => {
    expect(byName('app.tutorial.open').ui).toEqual({ resourceUri: 'ui://sqlib/tutorial' });
    for (const name of ['tags.list', 'tests.list', 'tests.listVersions', 'ruleSets.exportSrl']) {
      expect(byName(name).ui?.visibility, name).toEqual(['app']);
    }
  });

  it('reads and computes, and never writes', () => {
    // A read-only deployment keeps only `readOnly` tools, and a tutorial that
    // disappeared on the public demo would be no tutorial at all.
    for (const name of ['app.tutorial.open', 'srl.analyze', 'srl.compile', 'srl.run', 'tags.list', 'tests.list', 'tests.listVersions', 'ruleSets.exportSrl']) {
      expect(byName(name).readOnly, name).toBe(true);
    }
  });

  it('builds the routes the tutorial reads through', () => {
    expect(byName('tests.list').buildRequest({ tags: 'urn:t:1,urn:t:2', subject: '' })).toEqual({
      method: 'GET',
      url: '/tests?tags=urn%3At%3A1%2Curn%3At%3A2',
    });
    expect(byName('tests.list').buildRequest({})).toEqual({ method: 'GET', url: '/tests' });
    expect(byName('tags.list').buildRequest({ library: 'urn:l:1' })).toEqual({ method: 'GET', url: '/tags?library=urn%3Al%3A1' });
    expect(byName('ruleSets.exportSrl').buildRequest({ id: 'urn:rs:1', version: '1', prologue: 'PREFIX : <http://e/>' })).toEqual({
      method: 'GET',
      url: '/rule-sets/urn%3Ars%3A1/srl?version=1&prologue=PREFIX+%3A+%3Chttp%3A%2F%2Fe%2F%3E',
    });
    expect(byName('srl.run').buildRequest({ srl: 'RULE {} WHERE {}', dataGraphVersionId: 'urn:v' })).toMatchObject({
      method: 'POST',
      url: '/playground/rules/execute',
      payload: { srl: 'RULE {} WHERE {}', dataGraphVersionId: 'urn:v' },
    });
  });
});

describe('what the server declares at initialize', () => {
  it('announces the UI extension rather than waiting to be asked', () => {
    // Declared at construction: on a stateless transport that builds a server
    // per request, reacting to the client's advertisement happens too late.
    expect(uiServerCapabilities()).toEqual({
      extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: [APP_MIME_TYPE] } },
    });
  });

  it('declares nothing when publishing is switched off', () => {
    const previous = process.env.MCP_APPS;
    try {
      process.env.MCP_APPS = 'off';
      expect(uiServerCapabilities()).toEqual({});
    } finally {
      if (previous === undefined) delete process.env.MCP_APPS;
      else process.env.MCP_APPS = previous;
    }
  });
});

/**
 * Hosts cache a `ui://` resource against its URI, and hold on to URIs from tool
 * declarations they cached earlier. So the published URI carries a content hash
 * — otherwise an edited View is served from a stale copy, which looks exactly
 * like the edit doing nothing — and the un-hashed URI keeps resolving, because
 * a host asking for the one it remembers and getting a 404 tells the user the
 * whole connector is unreachable.
 */
describe('cache-busting without breaking cached URIs', () => {
  it('publishes each View under a content-hashed URI', () => {
    for (const view of views) {
      expect(canonicalUri(view.uri)).toMatch(new RegExp(`^${view.uri}-[0-9a-f]{12}\\.html$`));
    }
  });

  it('moves the URI when the View changes', () => {
    const bench = canonicalUri('ui://sqlib/bench');
    const result = canonicalUri('ui://sqlib/result');
    expect(bench).not.toBe(result);
  });

  it('still resolves the stable URI a host cached earlier', () => {
    expect(findView('ui://sqlib/bench')?.name).toBe('query-bench');
    expect(findView(canonicalUri('ui://sqlib/bench'))?.name).toBe('query-bench');
    expect(readUiResource('ui://sqlib/bench')).not.toBeNull();
    expect(readUiResource(canonicalUri('ui://sqlib/bench'))).not.toBeNull();
  });

  it('resolves every URI shape a host might ask for', () => {
    // A `resources/read` error reaches the user as "Unable to reach
    // <connector>" — the whole server pronounced dead over a suffix. So the
    // resolver takes a normalised URI, an older or shorter hash, a stray
    // `.html` or a trailing slash, and only a genuinely unknown name misses.
    for (const uri of [
      'ui://sqlib/bench',
      'ui://sqlib/bench.html',
      'ui://sqlib/bench/',
      'ui://sqlib/bench-e241683c6f09.html',
      'ui://sqlib/bench-abc123.html',
      canonicalUri('ui://sqlib/bench'),
    ]) {
      expect(findView(uri)?.name, uri).toBe('query-bench');
      expect(readUiResource(uri), uri).not.toBeNull();
    }
    expect(findView('ui://sqlib/nope')).toBeUndefined();
    expect(readUiResource('ui://sqlib/nope')).toBeNull();
  });

  it('echoes back whichever URI was asked for', () => {
    const stable = readUiResource('ui://sqlib/bench')!;
    const hashed = readUiResource(canonicalUri('ui://sqlib/bench'))!;
    expect(stable.contents[0]!.uri).toBe('ui://sqlib/bench');
    expect(hashed.contents[0]!.uri).toBe(canonicalUri('ui://sqlib/bench'));
    expect(stable.contents[0]!.text).toBe(hashed.contents[0]!.text);
  });
});

describe('UI resources', () => {
  it('lists every View with the MCP Apps MIME type and a sealed CSP', () => {
    const listed = listUiResources();
    expect(listed).toHaveLength(views.length);
    for (const resource of listed) {
      expect(resource.mimeType).toBe(APP_MIME_TYPE);
      expect(resource.uri.startsWith('ui://')).toBe(true);
      expect(resource.uri).toMatch(/-[0-9a-f]{12}\.html$/);
      expect(resource._meta.ui.csp.connectDomains).toEqual([]);
      /*
       * A map, and asserted as one on purpose.
       *
       * `permissions` was `[]` here for months and read as correct, because
       * `toEqual([])` passes for an array and `typeof [] === 'object'` would
       * let a laxer check pass too. The specification keys it by permission
       * name; ChatGPT validates that and refused to register the connector at
       * all, with `_meta.ui.permissions must be a dict`, while Claude ignored
       * the field and everything looked fine from this side. Hence the explicit
       * not-an-array assertion.
       */
      expect(resource._meta.ui.permissions).toEqual({});
      expect(Array.isArray(resource._meta.ui.permissions)).toBe(false);
    }
  });

  it('reads a View as one self-contained document', () => {
    const read = readUiResource('ui://sqlib/bench');
    expect(read).not.toBeNull();
    const html = read!.contents[0]!.text;
    expect(html).toContain('<!doctype html>');
    // The kit is inlined, not linked: a View with a `src` or `href` to fetch
    // would be blocked by the CSP this package declares.
    expect(html).toContain('window.sqlibApp');
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toContain('<!--@kit:');
  });

  it('answers nothing for an unknown resource', () => {
    expect(readUiResource('ui://sqlib/nope')).toBeNull();
  });

  it('keeps each View inside the size budget a resources/read pays per render', () => {
    /*
     * A View that embeds the editor carries CodeMirror, whose view and state
     * packages alone are ~230 KB minified, and there is no smaller editor
     * worth the name. It gets its own ceiling rather than a raised one for
     * everybody, so the bench and the result table stay small, and the
     * editor's weight is paid only by the View that asked for it. The hashed
     * URI is what makes it tolerable: a host fetches it once per build.
     */
    for (const view of views) {
      const html = renderView(view.uri);
      const budget = html.includes('window.sqlibEditor') ? 600_000 : 150_000;
      expect(html.length, view.uri).toBeLessThan(budget);
    }
  });

  it('inlines the editor only where a View asks for it', () => {
    expect(renderView('ui://sqlib/tutorial')).toContain('window.sqlibEditor');
    expect(renderView('ui://sqlib/bench')).not.toContain('window.sqlibEditor');
    expect(renderView('ui://sqlib/tutorial')).not.toMatch(/<script[^>]+src=/i);
  });
});

describe('catalogue ↔ View drift', () => {
  it('binds every tool to a View that is actually served', () => {
    const served = new Set(views.map((view) => view.uri));
    const bound = tools.filter((tool) => tool.ui);
    expect(bound.length).toBeGreaterThan(0);
    for (const tool of bound) {
      expect(served, `${tool.name} names ${tool.ui!.resourceUri}`).toContain(tool.ui!.resourceUri);
    }
  });
});

/**
 * The caller's bearer token has to survive the v1 → v2 SDK move.
 *
 * v1 handed handlers `extra.requestInfo.headers`, a node headers object whose
 * values could be arrays; v2 hands `ctx.http.req`, a web-standard `Request`.
 * The failure this guards against is silent: a wrong read returns `undefined`
 * rather than throwing, every tool call runs anonymous, and nothing looks
 * broken until a deployment with `SQLIB_AUTH_MODE=required` denies work the
 * caller was entitled to — or, worse, an authenticated deployment stops
 * applying the caller's grants and nobody notices.
 */
describe('caller authorization', () => {
  it('lifts the bearer token off an HTTP request', () => {
    const ctx = {
      http: { req: new Request('https://example.org/mcp', { headers: { authorization: 'Bearer t0ken' } }) },
    };
    expect(authorizationFromContext(ctx)).toBe('Bearer t0ken');
  });

  it('is case-insensitive about the header name, as HTTP is', () => {
    const ctx = {
      http: { req: new Request('https://example.org/mcp', { headers: { Authorization: 'Bearer t0ken' } }) },
    };
    expect(authorizationFromContext(ctx)).toBe('Bearer t0ken');
  });

  it('forwards nothing over stdio, where there is no HTTP request', () => {
    expect(authorizationFromContext({})).toBeUndefined();
    expect(authorizationFromContext({ http: {} })).toBeUndefined();
  });

  it('forwards nothing when the caller sent no token', () => {
    const ctx = { http: { req: new Request('https://example.org/mcp') } };
    expect(authorizationFromContext(ctx)).toBeUndefined();
  });
});

/**
 * A UI-bound tool has to say so in words.
 *
 * Hosts strip `_meta` before the model sees a result, so the binding itself is
 * invisible to it: in one session the model reported that sqlib "exposes only
 * one rendered UI" and missed the two result tables entirely, because only
 * `app_bench_open` *looked* like a UI tool by name. The fix is not to rename
 * `execute.run` — it is the execution tool for every caller — but to state the
 * rendering in the description, which is the one channel that always reaches
 * the model.
 */
describe('a rendering tool announces itself in text', () => {
  // A tool only a View may call is never listed to the model, so it has
  // nothing to announce and the guide has no reason to name it.
  const modelFacing = (entry: (typeof tools)[number]) =>
    Boolean(entry.ui) && (!entry.ui!.visibility || entry.ui!.visibility.includes('model'));

  it('says so in every UI-bound description', () => {
    for (const tool of tools.filter(modelFacing)) {
      expect(tool.description, tool.name).toContain('MCP Apps');
    }
  });

  it('says so once in the session guide, naming each one', () => {
    const guide = catalogueGuide((name) => name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    expect(guide).toContain('Rendered results');
    for (const tool of tools.filter(modelFacing)) {
      expect(guide, tool.name).toContain(tool.name.replace(/[^a-zA-Z0-9_-]/g, '_'));
    }
  });
});
