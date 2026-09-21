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
import { tools, type ListedTool } from '@sparql-query-lib/tools';
import { views, renderView, APP_MIME_TYPE } from '@sparql-query-lib/mcp-app';
import {
  advertisesUiExtension,
  listUiResources,
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
    expect(withUiMeta(executeRun, true)).toMatchObject({
      name: 'execute_run',
      _meta: { ui: { resourceUri: 'ui://sqlib/result', visibility: ['model', 'app'] } },
    });
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

  it('marks a result with the View that renders it, only when the client can', () => {
    expect(resultUiMeta({ ui: { resourceUri: 'ui://sqlib/result' } }, true)).toEqual({
      ui: { resourceUri: 'ui://sqlib/result' },
    });
    expect(resultUiMeta({ ui: { resourceUri: 'ui://sqlib/result' } }, false)).toBeUndefined();
    expect(resultUiMeta(undefined, true)).toBeUndefined();
  });
});

describe('UI resources', () => {
  it('lists every View with the MCP Apps MIME type and a sealed CSP', () => {
    const listed = listUiResources();
    expect(listed).toHaveLength(views.length);
    for (const resource of listed) {
      expect(resource.mimeType).toBe(APP_MIME_TYPE);
      expect(resource.uri.startsWith('ui://')).toBe(true);
      expect(resource._meta.ui.csp.connectDomains).toEqual([]);
      expect(resource._meta.ui.permissions).toEqual([]);
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
    for (const view of views) {
      expect(renderView(view.uri).length).toBeLessThan(150_000);
    }
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
