import { describe, expect, it } from 'vitest';
import { fromBundle } from '@sparql-query-lib/runtime';
import { buildExportBundle } from '../../../src/lib/export/queryBundle.js';
import { generateDemoPage, loadRuntimeSource } from '../../../src/lib/export/demoPage.js';

const RUNTIME_STUB = 'module.exports = { stub: true };';

async function bundleOf(
  queries: Array<{ name: string; queryString: string; description?: string }>,
) {
  return buildExportBundle({
    library: { id: 'urn:sqlib:library:test', name: 'Test Library' },
    queries,
    generatedAt: '2026-08-26T00:00:00.000Z',
  });
}

const PEOPLE = {
  name: 'People by city',
  queryString:
    'PREFIX ex: <http://example.org/>\nSELECT ?name WHERE { VALUES (?city) { (UNDEF) } ?p ex:livesIn ?city ; ex:name ?name }',
};

async function pageOf(
  queries = [PEOPLE],
  options: Parameters<typeof generateDemoPage>[1] = {},
) {
  const bundle = await bundleOf(queries);
  return generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB, ...options });
}

describe('escaping — the page embeds text nobody vetted', () => {
  it('cannot be broken out of by a query containing a closing script tag', async () => {
    // The regression this file exists for: query text is author-supplied, and a
    // literal </script> inside it would end the element and turn the rest of the
    // bundle into markup.
    const page = await pageOf([
      {
        name: 'Sneaky',
        queryString: 'SELECT ?x WHERE { ?x ?p "</script><img src=x onerror=alert(1)>" }',
      },
    ]);

    // Exactly three script elements: runtime, bundle, page script.
    expect(page.match(/<\/script>/g)).toHaveLength(3);
    expect(page).not.toContain('<img src=x onerror=alert(1)>');
    expect(page).toContain('\\u003c/script\\u003e');
  });

  it('escapes markup in the visible template pane', async () => {
    const page = await pageOf([
      { name: 'Angle', queryString: 'SELECT ?x WHERE { ?x ?p <http://example.org/a> }' },
    ]);
    // Highlighted, but the angle brackets are entities either way: the
    // highlighter only ever wraps already-escaped text in spans.
    expect(page).toContain('&lt;http://example.org/a&gt;');
  });

  it('escapes a hostile query name into its heading and ids', async () => {
    const page = await pageOf([
      { name: '"><script>alert(1)</script>', queryString: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);
    expect(page).not.toContain('<script>alert(1)');
    expect(page.match(/<\/script>/g)).toHaveLength(3);
  });

  it('escapes a description', async () => {
    const page = await pageOf([{ ...PEOPLE, description: 'Uses <b>bold</b> & things' }]);
    expect(page).toContain('Uses &lt;b&gt;bold&lt;/b&gt; &amp; things');
  });

  it('keeps the embedded bundle parseable after escaping', async () => {
    const page = await pageOf([
      { name: 'Sneaky', queryString: 'SELECT ?x WHERE { ?x ?p "</script>" }' },
    ]);
    // The data block declares the bundle and then the group plans, one per
    // line, so the bundle's own line is what this reads.
    const match = page.match(/window\.SQLIB_BUNDLE = (.*?);\n/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match![1]);
    // The escaping is a JS-source concern only: what JSON.parse yields is the
    // original text, </script> and all.
    expect(parsed.queries.sneaky.template.text).toContain('</script>');
  });
});

describe('page structure', () => {
  it('inlines the runtime and exposes it as a global', async () => {
    const page = await pageOf();
    expect(page).toContain(RUNTIME_STUB);
    expect(page).toContain('window.SQLIB = module.exports;');
  });

  it('exposes the bundle for copying into another tool', async () => {
    const page = await pageOf();
    expect(page).toContain('window.SQLIB_BUNDLE = {');
  });

  it('lists every query in the nav so nothing is hidden', async () => {
    const page = await pageOf([
      PEOPLE,
      { name: 'Everything', queryString: 'SELECT * WHERE { ?s ?p ?o }' },
    ]);
    expect(page).toContain('href="#q-people-by-city"');
    expect(page).toContain('href="#q-everything"');
  });

  it('shows parameter slots as the UNDEF form the author wrote, not the marker', async () => {
    // template.text carries a marker IRI in each slot so the compiler could find
    // its span. The embedded bundle keeps it — the runtime splices over it — but
    // the pane a person reads must not show it.
    const page = await pageOf();
    const pane = page.match(/Template<\/span><\/div>\s*<pre>([\s\S]*?)<\/pre>/);
    expect(pane).not.toBeNull();
    // The pane is syntax-highlighted, so assert on its text rather than markup.
    const text = pane![1].replace(/<[^>]+>/g, '');
    expect(text).toContain('VALUES ?city { UNDEF }');
    expect(text).not.toContain('urn:sqlib:template-slot');
  });

  it('gives each query a template pane and a substituted pane', async () => {
    const page = await pageOf();
    expect(page).toContain('>Template<');
    expect(page).toContain('>Substituted<');
    expect(page).toContain('id="sub-people-by-city"');
    // The argument builder is the shared custom element, not a bespoke textarea.
    expect(page).toContain('<sqlib-args id="args-people-by-city">');
  });

  it('spells out the signature', async () => {
    const page = await pageOf();
    expect(page).toContain('slot 1: ?city');
  });

  it('mentions page parameters in the signature', async () => {
    const page = await pageOf([
      { name: 'Paged', queryString: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001 OFFSET 0002' },
    ]);
    expect(page).toContain('limit 1');
    expect(page).toContain('offset 2');
  });

  it('says a query takes no arguments rather than showing an empty signature', async () => {
    const page = await pageOf([{ name: 'All', queryString: 'SELECT * WHERE { ?s ?p ?o }' }]);
    expect(page).toContain('no arguments');
  });

  it('warns that the page carries no authorization', async () => {
    const page = await pageOf();
    expect(page).toMatch(/requests are anonymous/);
  });

  it('reports what the export left out', async () => {
    const page = await pageOf([PEOPLE], {
      skipped: [{ name: 'Draft', reason: 'The query has no current version.' }],
    });
    expect(page).toContain('not in this export');
    expect(page).toContain('Draft — The query has no current version.');
  });

  it('renders an empty library without breaking', async () => {
    const page = await pageOf([]);
    expect(page).toContain('This export contains no queries.');
    expect(page).toContain('0 queries');
  });
});

describe('examples on the page', () => {
  async function pageWithExamples() {
    const bundle = await bundleOf([PEOPLE]);
    bundle.queries['people-by-city'].examples = [
      {
        name: 'Perth',
        arguments: [
          {
            head: { vars: ['city'] },
            arguments: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
          },
        ],
      },
      {
        name: 'Seeded case',
        arguments: [{ head: { vars: ['city'] }, arguments: { bindings: [] } }],
        dataDependent: true,
        expected: '{"head":{"vars":["name"]}}',
      },
    ];
    return generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB });
  }

  it('renders a button per example', async () => {
    const page = await pageWithExamples();
    expect(page).toContain('data-example-for="people-by-city" data-example-index="0"');
    expect(page).toContain('>Perth');
    expect(page).toContain('data-example-index="1"');
  });

  it('badges an example whose test seeded its own data', async () => {
    const page = await pageWithExamples();
    expect(page).toMatch(/class="badge"[^>]*>seeded</);
  });

  it('shows a recorded result as reference, not as an assertion', async () => {
    const page = await pageWithExamples();
    expect(page).toContain('reference only, not assertions');
    expect(page).toContain('&quot;head&quot;');
  });

  it('omits the expected section when nothing carries one', async () => {
    const page = await pageOf();
    expect(page).not.toContain('reference only, not assertions');
  });
});

describe('groups on the page', () => {
  const CITY = {
    name: 'People by city',
    description: 'Everyone recorded as living in a given city.',
    queryString:
      'PREFIX ex: <http://example.org/>\nSELECT ?name WHERE { VALUES (?city) { (UNDEF) } ?p ex:livesIn ?city ; ex:name ?name }',
  };
  const RECORD = {
    name: 'Describe a person',
    queryString:
      'PREFIX ex: <http://example.org/>\nDESCRIBE ?person WHERE { VALUES (?person) { (UNDEF) } ?person a ex:Person }',
  };

  /** A two-node chain: the caller fills the first slot, an edge fills the second. */
  async function pageWithGroup(group: Record<string, unknown> = {}) {
    const bundle = await bundleOf([CITY, RECORD]);
    bundle.groups = {
      'people-and-records': {
        description: 'Everyone in a city, then their records.',
        nodes: {
          people: { query: 'people-by-city' },
          records: { query: 'describe-a-person' },
        },
        edges: [
          {
            from: 'people',
            to: 'records',
            targetVars: ['person'],
            mappings: [{ source: 'name', target: 'person' }],
          },
        ],
        resultNode: 'records',
        ...group,
      },
    };
    return generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB });
  }

  it('gives a group a cell, a rail entry and its own argument builder', async () => {
    const page = await pageWithGroup();
    expect(page).toContain('<section class="cell" id="g-people-and-records">');
    expect(page).toContain('href="#g-people-and-records"');
    expect(page).toContain('<sqlib-args id="gargs-people-and-records">');
    expect(page).toContain('1 group');
  });

  it('draws the chain in execution order, linking each step to its query cell', async () => {
    // Alphabetically `people` comes first anyway; what is asserted here is that
    // each step names the query it runs and points at that query's own cell,
    // which is where its template is.
    const page = await pageWithGroup();
    const chain = page.match(/<ol class="chain">([\s\S]*?)<\/ol>/);
    expect(chain).not.toBeNull();
    expect(chain![1]).toContain('href="#q-people-by-city"');
    expect(chain![1]).toContain('href="#q-describe-a-person"');
    expect(chain![1].indexOf('people-by-city')).toBeLessThan(
      chain![1].indexOf('describe-a-person'),
    );
  });

  it('says which slot the caller fills and which an edge fills', async () => {
    const page = await pageWithGroup();
    expect(page).toContain('?city from you');
    expect(page).toContain('?name→?person from people');
    expect(page).toContain('<span>2 steps</span><span>slot 1: ?city</span>');
  });

  it('marks the node whose result is the group&#39;s', async () => {
    const page = await pageWithGroup();
    expect(page).toMatch(/describe-a-person[\s\S]*?class="chain__result">result</);
  });

  it('embeds the walker&#39;s own plan rather than deriving it twice', async () => {
    // The page sets `<sqlib-args>`'s signature from this, and the static markup
    // above is rendered from the same object: one derivation, by the runtime
    // that will do the walking.
    const page = await pageWithGroup();
    const match = page.match(/window\.SQLIB_GROUP_PLANS = (.*?);<\/script>/s);
    expect(match).not.toBeNull();
    const plans = JSON.parse(match![1]);
    expect(plans['people-and-records'].inputs).toEqual([['city']]);
    expect(plans['people-and-records'].resultQuery).toBe('describe-a-person');
    expect(plans['people-and-records'].steps.map((step: { node: string }) => step.node)).toEqual([
      'people',
      'records',
    ]);
  });

  it('offers one grid for two nodes that declare the same variables', async () => {
    // The walker matches an argument set to a slot by its variables, so one set
    // fills both slots. A second grid would take rows nothing would ever read.
    const bundle = await bundleOf([CITY, { ...CITY, name: 'People by city again' }]);
    bundle.groups = {
      twice: {
        nodes: {
          first: { query: 'people-by-city' },
          second: { query: 'people-by-city-again' },
        },
        edges: [],
        resultNode: 'second',
      },
    };
    const page = generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB });
    const plans = JSON.parse(page.match(/window\.SQLIB_GROUP_PLANS = (.*?);<\/script>/s)![1]);
    expect(plans.twice.inputs).toEqual([['city']]);
    expect(page).toContain('<span>2 steps</span><span>slot 1: ?city</span>');
  });

  it('reports the page parameters a group&#39;s nodes accept', async () => {
    const bundle = await bundleOf([
      { name: 'Paged', queryString: 'SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001' },
    ]);
    bundle.groups = {
      paged: { nodes: { only: { query: 'paged' } }, edges: [], resultNode: 'only' },
    };
    const page = generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB });
    expect(page).toContain('<span>limit 1</span>');
  });

  it('escapes a hostile group name, description and node key', async () => {
    const bundle = await bundleOf([CITY]);
    bundle.groups = {
      '"><script>alert(1)</script>': {
        description: 'Uses <b>bold</b> & things',
        nodes: { '"><img src=x>': { query: 'people-by-city' } },
        edges: [],
        resultNode: '"><img src=x>',
      },
    };
    const page = generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB });
    expect(page).not.toContain('<script>alert(1)');
    expect(page).not.toContain('<img src=x>');
    expect(page).toContain('Uses &lt;b&gt;bold&lt;/b&gt; &amp; things');
    expect(page.match(/<\/script>/g)).toHaveLength(3);
  });

  it('draws a group the walker cannot read, but does not offer to run it', async () => {
    // A node naming a query the bundle does not carry: the rest of the page is
    // unaffected, and the cell says why its Run button is dead rather than
    // failing when someone presses it.
    const bundle = await bundleOf([CITY]);
    bundle.groups = {
      broken: { nodes: { gone: { query: 'not-here' } }, edges: [], resultNode: 'gone' },
    };
    const page = generateDemoPage(bundle, { runtimeSource: RUNTIME_STUB });
    expect(page).toContain('id="g-broken"');
    expect(page).toContain('could not be read from the bundle');
    expect(page).not.toContain('<ol class="chain">');
    const plans = JSON.parse(page.match(/window\.SQLIB_GROUP_PLANS = (.*?);<\/script>/s)![1]);
    expect(plans.broken).toBeUndefined();
  });

  it('carries no group markup for a library that has none', async () => {
    const page = await pageOf();
    expect(page).not.toContain('class="chain"');
    expect(page).not.toContain('<sqlib-args id="gargs-');
    expect(page).not.toContain('>Groups <');
    expect(page).toContain('window.SQLIB_GROUP_PLANS = {};');
  });
});

describe('the inlined runtime is the real one', () => {
  it('reads the built CommonJS bundle from the installed package', () => {
    const source = loadRuntimeSource();
    expect(source).toContain('applyTemplateArguments');
    // CommonJS, not ESM and certainly not TypeScript: the page evaluates this
    // with a module/exports pair, so a top-level `export` is a syntax error in
    // the browser. Resolution used to land on the package's source under tsx,
    // which produced a page that died on load while every test still passed.
    expect(source).toContain('module.exports');
    expect(source).not.toMatch(/^\s*(export|import)\s/m);
  });

  /**
   * The page's whole claim: what it substitutes is what the server substitutes.
   * Evaluate the runtime exactly as the page's inline block does, then compare
   * against the same runtime used directly.
   */
  it('substitutes through its own inlined copy exactly as the API does', async () => {
    const bundle = await bundleOf([PEOPLE]);
    const page = generateDemoPage(bundle);

    const match = page.match(/var module = \{ exports: \{\} \};\n {2}var exports = module\.exports;\n([\s\S]*?)\n {2}window\.SQLIB = module\.exports;/);
    expect(match).not.toBeNull();

    // The bundle declares a custom element, so it needs `HTMLElement` to exist
    // at definition time. Substitution is what this test is about, so a stub is
    // honest — the element itself is exercised in a browser, not here.
    const factory = new Function('module', 'exports', 'HTMLElement', match![1]);
    const moduleObject = { exports: {} as Record<string, unknown> };
    factory(moduleObject, moduleObject.exports, class {});
    const inlined = moduleObject.exports as typeof import('@sparql-query-lib/runtime');

    const payload = {
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
        },
      ],
    };

    expect(inlined.fromBundle(bundle).query('people-by-city').text(payload)).toBe(
      fromBundle(bundle).query('people-by-city').text(payload),
    );
  });
});
