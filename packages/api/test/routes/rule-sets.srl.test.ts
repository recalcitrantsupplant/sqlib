import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import ruleSetRoutes from '../../src/routes/rule-sets.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  ruleSet: { get: vi.fn() },
  ruleSetVersion: { list: vi.fn(), get: vi.fn(), update: vi.fn() },
  ruleVersion: { get: vi.fn() },
  rule: { create: vi.fn() },
  dataBlock: { create: vi.fn() },
  dataBlockVersion: { get: vi.fn() },
  createRuleVersion: vi.fn(),
  createRuleSetVersion: vi.fn(),
  createDataBlockVersion: vi.fn(),
  mockExpand: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    RuleSet: hoisted.ruleSet,
    RuleSetVersion: hoisted.ruleSetVersion,
    RuleVersion: hoisted.ruleVersion,
    Rule: hoisted.rule,
    DataBlock: hoisted.dataBlock,
    DataBlockVersion: hoisted.dataBlockVersion,
  }),
  getCacheCoordinator: () => ({ get: vi.fn() }),
}));
vi.mock('../../src/lib/RuleSetVersionResolver.js', () => ({ expandRuleSetVersion: hoisted.mockExpand }));
vi.mock('../../src/lib/RuleVersionWriter.js', () => ({ createRuleVersion: hoisted.createRuleVersion }));
vi.mock('../../src/lib/RuleSetVersionWriter.js', () => ({ createRuleSetVersion: hoisted.createRuleSetVersion }));
vi.mock('../../src/lib/DataBlockVersionWriter.js', () => ({
  createDataBlockVersion: hoisted.createDataBlockVersion,
}));

const RULESET_ID = 'urn:sqlib:ruleset:rs1';
// Stored canonically: expanded IRIs, no prologue (plan §7).
const STORED_RULE = 'RULE { ?s <http://example/q> ?o } WHERE { ?s <http://example/p> ?o }';

describe('RuleSets Routes — SRL document authoring', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(ruleSetRoutes, { prefix: '/rule-sets' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.ruleSet.get.mockReturnValue({ $id: RULESET_ID, currentVersion: `${RULESET_ID}:v1`, isPartOf: 'urn:lib:1' });
    hoisted.ruleSetVersion.list.mockReturnValue([
      { $id: `${RULESET_ID}:v1`, isPartOf: RULESET_ID, version: 1, hasRule: ['urn:rv:1'], hasDataBlock: [] },
    ]);
    hoisted.ruleVersion.get.mockImplementation((id: string) =>
      id === 'urn:rv:1' ? { $id: 'urn:rv:1', isPartOf: 'urn:rule:1', ruleString: STORED_RULE } : undefined,
    );
    hoisted.dataBlockVersion.get.mockReturnValue(undefined);
  });

  /** A rule set version whose single data block holds the given dataString. */
  const withDataBlock = (dataString: string) => {
    hoisted.ruleSetVersion.list.mockReturnValue([
      {
        $id: `${RULESET_ID}:v1`,
        isPartOf: RULESET_ID,
        version: 1,
        hasRule: ['urn:rv:1'],
        hasDataBlock: ['urn:dbv:1'],
      },
    ]);
    hoisted.dataBlockVersion.get.mockImplementation((id: string) =>
      id === 'urn:dbv:1' ? { $id: 'urn:dbv:1', isPartOf: 'urn:db:1', dataString } : undefined,
    );
  };

  it('exports the rule set as one SRL document', async () => {
    const res = await app.inject({ method: 'GET', url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl?prologue=${encodeURIComponent('PREFIX : <http://example/>')}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ruleCount).toBe(1);
    expect(body.srl).toContain('PREFIX : <http://example/>');
    expect(body.srl).toContain('RULE {');
  });

  it('404s for an unknown rule set', async () => {
    hoisted.ruleSet.get.mockReturnValue(undefined);
    const res = await app.inject({ method: 'GET', url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl` });
    expect(res.statusCode).toBe(404);
  });

  it('preview reports no changes when re-importing the same document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: `PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toEqual([]);
    expect(body.detached).toEqual([]);
    expect(body.unchangedCount).toBe(1);
  });

  it('preview flags a detached rule as orphaned when nothing else references it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: `PREFIX : <http://example/>\nRULE { ?s :other ?o } WHERE { ?s :p ?o }` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toHaveLength(1);
    expect(body.detached).toHaveLength(1);
    expect(body.detached[0].orphaned).toBe(true);
    expect(body.detached[0].ruleVersionId).toBe('urn:rv:1');
  });

  it('preview reports a rule still used by another rule set as not orphaned', async () => {
    hoisted.ruleSetVersion.list.mockReturnValue([
      { $id: `${RULESET_ID}:v1`, isPartOf: RULESET_ID, version: 1, hasRule: ['urn:rv:1'], hasDataBlock: [] },
      { $id: 'urn:other:v1', isPartOf: 'urn:sqlib:ruleset:other', version: 1, hasRule: ['urn:rv:1'] },
    ]);
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: `PREFIX : <http://example/>\nRULE { ?s :other ?o } WHERE { ?s :p ?o }` },
    });
    const body = res.json();
    expect(body.detached[0].orphaned).toBe(false);
    expect(body.detached[0].otherRuleSets).toBe(1);
  });

  it('preview surfaces well-formedness warnings without failing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: `PREFIX : <http://example/>\nRULE { ?s :q ?missing } WHERE { ?s :p ?o }` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().warnings.join(' ')).toMatch(/unbound-head/);
  });

  it('rejects an invalid SRL document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
      payload: { srl: 'this is not SRL' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('import reuses an unchanged rule version and creates a new rule set version', async () => {
    hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
      payload: { srl: `PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toEqual([]);
    expect(body.updated).toEqual([]);
    expect(body.ruleCount).toBe(1);
    // Unchanged rule: no new RuleVersion minted.
    expect(hoisted.createRuleVersion).not.toHaveBeenCalled();
    expect(hoisted.createRuleSetVersion).toHaveBeenCalledWith(
      RULESET_ID,
      expect.objectContaining({ hasRule: ['urn:rv:1'] }),
    );
  });

  it('import creates a Rule and RuleVersion for a new rule', async () => {
    hoisted.rule.create.mockResolvedValue({ $id: 'urn:rule:new' });
    hoisted.createRuleVersion.mockResolvedValue({ $id: 'urn:rv:new' });
    hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });
    const res = await app.inject({
      method: 'POST',
      url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
      payload: { srl: `PREFIX : <http://example/>\nRULE { ?s :brandNew ?o } WHERE { ?s :p ?o }` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created).toEqual(['urn:rv:new']);
    expect(body.detached).toEqual(['urn:rv:1']);
    expect(hoisted.rule.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.stringContaining('brandNew') }),
    );
  });

  // -------------------------------------------------------------------------
  // DATA blocks: a document is prologue + DATA + rules, and all three have to
  // survive a round trip. Exporting only the rules is what used to lose data.
  // -------------------------------------------------------------------------

  describe('DATA blocks', () => {
    const PROLOGUE = encodeURIComponent('PREFIX : <http://example/>');

    it('exports DATA blocks alongside the rules', async () => {
      withDataBlock('DATA { <http://example/a> <http://example/p> <http://example/b> }');
      const res = await app.inject({
        method: 'GET',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl?prologue=${PROLOGUE}`,
      });
      const body = res.json();
      expect(body.dataBlockCount).toBe(1);
      expect(body.srl).toContain('DATA {');
      expect(body.srl).toContain(':a :p :b');
      expect(body.warnings).toEqual([]);
    });

    it('exports a legacy INSERT DATA block in its SRL form', async () => {
      withDataBlock('PREFIX : <http://example/>\nINSERT DATA { :a :p :b }');
      const res = await app.inject({
        method: 'GET',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl?prologue=${PROLOGUE}`,
      });
      expect(res.json().srl).toContain('DATA { :a :p :b');
    });

    it('says so rather than mangling a data block with no DATA form', async () => {
      withDataBlock('DELETE WHERE { ?s ?p ?o }');
      const res = await app.inject({
        method: 'GET',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl?prologue=${PROLOGUE}`,
      });
      const body = res.json();
      expect(body.dataBlockCount).toBe(0);
      expect(body.warnings.join(' ')).toMatch(/urn:dbv:1.*omitted/);
    });

    it('preview reports an unchanged data block as unchanged, not as new', async () => {
      withDataBlock('DATA { <http://example/a> <http://example/p> <http://example/b> }');
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
        payload: {
          srl: 'PREFIX : <http://example/>\nDATA { :a :p :b }\nRULE { ?s :q ?o } WHERE { ?s :p ?o }',
        },
      });
      const body = res.json();
      expect(body.data.created).toEqual([]);
      expect(body.data.unchangedCount).toBe(1);
      expect(body.data.detached).toEqual([]);
    });

    it('preview reports an edited data block as one created and one detached', async () => {
      withDataBlock('DATA { <http://example/a> <http://example/p> <http://example/b> }');
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
        payload: {
          srl: 'PREFIX : <http://example/>\nDATA { :a :p :DIFFERENT }\nRULE { ?s :q ?o } WHERE { ?s :p ?o }',
        },
      });
      const body = res.json();
      expect(body.data.created).toHaveLength(1);
      expect(body.data.detached).toHaveLength(1);
      expect(body.data.detached[0].orphaned).toBe(true);
    });

    it('import mints a DataBlock and DataBlockVersion for a new DATA block', async () => {
      hoisted.dataBlock.create.mockResolvedValue({ $id: 'urn:db:new' });
      hoisted.createDataBlockVersion.mockResolvedValue({ $id: 'urn:dbv:new' });
      hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });

      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: {
          srl: 'PREFIX : <http://example/>\nDATA { :a :p :b }\nRULE { ?s :q ?o } WHERE { ?s :p ?o }',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().dataCreated).toEqual(['urn:dbv:new']);
      expect(hoisted.createDataBlockVersion).toHaveBeenCalledWith(
        'urn:db:new',
        expect.objectContaining({ dataString: expect.stringContaining('DATA {') }),
      );
      expect(hoisted.createRuleSetVersion).toHaveBeenCalledWith(
        RULESET_ID,
        expect.objectContaining({ hasDataBlock: ['urn:dbv:new'] }),
      );
    });

    it('import drops a data block the author deleted, instead of carrying it forward', async () => {
      withDataBlock('DATA { <http://example/a> <http://example/p> <http://example/b> }');
      hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });

      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: { srl: 'PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().dataDetached).toEqual(['urn:dbv:1']);
      expect(hoisted.createRuleSetVersion).toHaveBeenCalledWith(
        RULESET_ID,
        expect.objectContaining({ hasDataBlock: [] }),
      );
    });

    it('import reuses the stored version for an unchanged data block', async () => {
      withDataBlock('DATA { <http://example/a> <http://example/p> <http://example/b> }');
      hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });

      await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: {
          srl: 'PREFIX : <http://example/>\nDATA { :a :p :b }\nRULE { ?s :q ?o } WHERE { ?s :p ?o }',
        },
      });

      expect(hoisted.createDataBlockVersion).not.toHaveBeenCalled();
      expect(hoisted.createRuleSetVersion).toHaveBeenCalledWith(
        RULESET_ID,
        expect.objectContaining({ hasDataBlock: ['urn:dbv:1'] }),
      );
    });

    it('accepts a data-only document', async () => {
      hoisted.dataBlock.create.mockResolvedValue({ $id: 'urn:db:new' });
      hoisted.createDataBlockVersion.mockResolvedValue({ $id: 'urn:dbv:new' });
      hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: { srl: 'PREFIX : <http://example/>\nDATA { :a :p :b }' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ruleCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // The rule-tuples toggle and the initial named tuples (box 2).
  // -------------------------------------------------------------------------

  describe('rule tuples', () => {
    const TUPLE_DOC = 'PREFIX : <http://example/>\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }';

    it('rejects TUPLE when the extension is off — the toggle means something', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
        payload: { srl: TUPLE_DOC },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/rule-tuples extension/i);
    });

    it('accepts TUPLE when the extension is on', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
        payload: { srl: TUPLE_DOC, tuples: true },
      });
      expect(res.statusCode).toBe(200);
    });

    it('rejects seed rows when the extension is off', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }',
          tupleSeeds: 'TUPLE(:rel, :a)',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/rule-tuples extension/i);
    });

    it('preview counts seed values and lists declared inputs separately', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl/preview`,
        payload: {
          srl: TUPLE_DOC,
          tuples: true,
          tupleSeeds: 'TUPLE(:rel, :a)\nTUPLE(:input, ?x)',
        },
      });
      const seeds = res.json().tupleSeeds;
      expect(seeds.rows).toBe(1);
      expect(seeds.declarations).toEqual([
        { arity: 2, terms: ['<http://example/input>', '?x'] },
      ]);
    });

    it('rejects a malformed seed document rather than storing it', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: { srl: TUPLE_DOC, tuples: true, tupleSeeds: 'not a tuple row' },
      });
      expect(res.statusCode).toBe(400);
      expect(hoisted.createRuleSetVersion).not.toHaveBeenCalled();
    });

    it('stores seeds canonically, so they match a rule read at execution', async () => {
      hoisted.rule.create.mockResolvedValue({ $id: 'urn:rule:new' });
      hoisted.createRuleVersion.mockResolvedValue({ $id: 'urn:rv:new' });
      hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });

      await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: { srl: TUPLE_DOC, tuples: true, tupleSeeds: 'TUPLE(:rel, :a)' },
      });

      expect(hoisted.createRuleSetVersion).toHaveBeenCalledWith(
        RULESET_ID,
        expect.objectContaining({
          // Expanded against the document's prologue and stored without one —
          // the same canonical form rules are stored in.
          tupleSeeds: 'TUPLE(<http://example/rel>, <http://example/a>)',
          tuplesEnabled: true,
        }),
      );
    });

    it('exports the stored seeds abbreviated against the requested prologue', async () => {
      hoisted.ruleSetVersion.list.mockReturnValue([
        {
          $id: `${RULESET_ID}:v1`,
          isPartOf: RULESET_ID,
          version: 1,
          hasRule: ['urn:rv:1'],
          hasDataBlock: [],
          tupleSeeds: 'TUPLE(<http://example/rel>, <http://example/a>)',
          tuplesEnabled: true,
        },
      ]);
      const res = await app.inject({
        method: 'GET',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl?prologue=${encodeURIComponent('PREFIX : <http://example/>')}`,
      });
      const body = res.json();
      expect(body.tuplesEnabled).toBe(true);
      expect(body.tupleSeeds).toBe('TUPLE(:rel, :a)');
    });

    it('drops the seed document when the extension is turned off', async () => {
      hoisted.createRuleSetVersion.mockResolvedValue({ $id: `${RULESET_ID}:v2`, version: 2 });
      await app.inject({
        method: 'POST',
        url: `/rule-sets/${encodeURIComponent(RULESET_ID)}/srl`,
        payload: { srl: 'PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }' },
      });
      expect(hoisted.createRuleSetVersion).toHaveBeenCalledWith(
        RULESET_ID,
        expect.objectContaining({ tupleSeeds: '', tuplesEnabled: false }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Per-rule export to equivalent SPARQL.
  // -------------------------------------------------------------------------

  describe('compile to SPARQL', () => {
    it('compiles each rule to an INSERT ... WHERE program', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE :first { ?s :q ?o } WHERE { ?s :p ?o }\nRULE { ?s :r ?o } WHERE { ?s :q ?o }',
        },
      });
      expect(res.statusCode).toBe(200);
      const { rules } = res.json();
      expect(rules).toHaveLength(2);
      expect(rules[0].label).toBe('first');
      expect(rules[0].sparql).toContain('INSERT {');
      expect(rules[0].sparql).toContain('PREFIX : <http://example/>');
      expect(rules[0].caveats).toEqual([]);
      expect(rules[1].label).toBe('rule-2');
    });

    /*
     * The route compiles what parses, and `FILTER NOT EXISTS { … }` used to
     * parse: the body grammar reuses SPARQL's filter, whose expressions can be
     * pattern operations. So a document the editor underlined as invalid SRL
     * came back as SPARQL anyway, and the two answers disagreed on the same
     * text. The parser refuses it now, and refusing is what this holds.
     */
    it('refuses a SPARQL NOT EXISTS rather than compiling it', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o FILTER NOT EXISTS { ?s :dead ?z } }',
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('NOT EXISTS is not part of SRL');
    });

    it('compiles SRL constructs a reader would need translated', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE { ?s :ok true } WHERE { ?s :p ?o NOT { ?s :q ?o } SET (?v := ?o + 1) }',
        },
      });
      const sparql = res.json().rules[0].sparql;
      expect(sparql).toContain('FILTER NOT EXISTS');
      expect(sparql).toContain('BIND(');
    });

    it('flags a tuple-reading rule as only equivalent after VALUES substitution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }',
          tuples: true,
        },
      });
      const rule = res.json().rules[0];
      expect(rule.tupleReads).toBe(1);
      expect(rule.caveats.join(' ')).toMatch(/VALUES/);
      // The read renders as a VALUES slot with a column per position — arity —
      // and its constant pinned into the row, so the block says which rows it
      // wants. The comment above carries the pattern as written.
      expect(rule.sparql).toContain('VALUES (?_read0_slot0 ?x) { (:rel UNDEF) }');
      expect(rule.sparql).toContain('# TUPLE(:rel, ?x)');
      // And the caveat says an unsubstituted slot means the premise is absent,
      // rather than letting the UNDEF row read as "runnable".
      expect(rule.caveats.join(' ')).toMatch(/absent/i);
    });

    it('compiles a tuple-producing rule to a SELECT, and says why', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: {
          srl: 'PREFIX : <http://example/>\nRULE { TUPLE(:rel, ?s) } WHERE { ?s :p ?o }',
          tuples: true,
        },
      });
      const rule = res.json().rules[0];
      expect(rule.producesTuples).toBe(true);
      expect(rule.sparql).toMatch(/SELECT\s+DISTINCT/);
      expect(rule.caveats.join(' ')).toMatch(/SELECT/);
    });

    it('compiles DATA blocks to INSERT DATA', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: { srl: 'PREFIX : <http://example/>\nDATA { :a :p :b }' },
      });
      const { dataBlocks } = res.json();
      expect(dataBlocks).toHaveLength(1);
      expect(dataBlocks[0].sparql).toContain('INSERT DATA {');
    });

    it('rejects a document that does not parse', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/compile',
        payload: { srl: 'nonsense' },
      });
      expect(res.statusCode).toBe(400);
    });

    // Issue #158. The non-destructive reading: same head, same body, one pass,
    // returning the triples instead of writing them, so a reader can paste it
    // into any endpoint. Computed per request like the INSERT beside it —
    // nothing new is stored.
    describe('flavour=construct', () => {
      const compile = (srl: string, payload: Record<string, unknown> = {}) =>
        app.inject({ method: 'POST', url: '/rule-sets/srl/compile', payload: { srl, ...payload } });

      it('emits CONSTRUCT ... WHERE with the prologue and the same body', async () => {
        const srl = 'PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }';
        const res = await compile(srl, { flavour: 'construct' });
        expect(res.statusCode).toBe(200);
        const { rules, flavour } = res.json();
        expect(flavour).toBe('construct');
        expect(rules[0].sparql).toContain('PREFIX : <http://example/>');
        expect(rules[0].sparql).toMatch(/CONSTRUCT\s*\{[\s\S]*:q[\s\S]*\}\s*WHERE\s*\{[\s\S]*:p/);
        expect(rules[0].sparql).not.toContain('INSERT');
      });

      it('defaults to insert, and says which flavour it answered with', async () => {
        const res = await compile('PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }');
        expect(res.json().flavour).toBe('insert');
        expect(res.json().rules[0].sparql).toContain('INSERT {');
      });

      it('reads a DATA block as CONSTRUCT ... WHERE {}', async () => {
        const res = await compile('PREFIX : <http://example/>\nDATA { :a :p :b }', { flavour: 'construct' });
        expect(res.json().dataBlocks[0].sparql).toContain('CONSTRUCT { :a :p :b } WHERE {}');
      });

      // A SELECT captured into an ephemeral store is already non-destructive and
      // has no CONSTRUCT form, so the toggle must not relabel it — it says so
      // per block instead.
      it('leaves a tuple-producing rule as the same SELECT, with the caveat saying why', async () => {
        const srl = 'PREFIX : <http://example/>\nRULE { TUPLE(:rel, ?s) } WHERE { ?s :p ?o }';
        const res = await compile(srl, { tuples: true, flavour: 'construct' });
        const rule = res.json().rules[0];
        expect(rule.sparql).toMatch(/SELECT\s+DISTINCT/);
        expect(rule.sparql).not.toContain('CONSTRUCT');
        expect(rule.caveats.join(' ')).toMatch(/no CONSTRUCT preview/);
      });

      it('rejects a flavour it does not know', async () => {
        const res = await compile('PREFIX : <http://example/>\nRULE { ?s :q ?o } WHERE { ?s :p ?o }', {
          flavour: 'describe',
        });
        expect(res.statusCode).toBe(400);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Document analysis: what the editor draws while the document is being typed.
  // -------------------------------------------------------------------------

  describe('analyze', () => {
    const analyze = (srl: string, tuples = false) =>
      app.inject({ method: 'POST', url: '/rule-sets/srl/analyze', payload: { srl, tuples } });

    const DOCUMENT = [
      'PREFIX ex: <http://example/>',
      '',
      'DATA {',
      '  ex:a ex:knows ex:b .',
      '}',
      '',
      'RULE {',
      '  ?p ex:friendOfFriend ?q .',
      '} WHERE {',
      '  ?p ex:knows ?x . ?x ex:knows ?q .',
      '}',
      '',
      'RULE {',
      '  ?p ex:distant ?q .',
      '} WHERE {',
      '  ?p ex:knows ?q . NOT { ?p ex:friendOfFriend ?q }',
      '}',
    ].join('\n');

    it('reports each block with the lines it occupies', async () => {
      const res = await analyze(DOCUMENT);
      expect(res.statusCode).toBe(200);
      const { blocks, ruleCount, dataBlockCount } = res.json();
      expect(ruleCount).toBe(2);
      expect(dataBlockCount).toBe(1);
      expect(blocks.map((b: { kind: string }) => b.kind)).toEqual(['data', 'rule', 'rule']);
      expect(blocks[0]).toMatchObject({ startLine: 3, endLine: 5, triples: 1, label: 'DATA block' });
      expect(blocks[1]).toMatchObject({ startLine: 7, endLine: 11, label: 'ex:friendOfFriend' });
      expect(blocks[2]).toMatchObject({ startLine: 13, endLine: 17, label: 'ex:distant' });
    });

    it('stratifies the rules and says which one negates', async () => {
      const { blocks, stratification } = (await analyze(DOCUMENT)).json();
      expect(blocks[1]).toMatchObject({ stratum: 0, monotonicity: 'monotone' });
      expect(blocks[2]).toMatchObject({ stratum: 1, monotonicity: 'negation' });
      expect(stratification.strataCount).toBe(2);
      expect(stratification.negationCount).toBe(1);
      expect(stratification.stratified).toBe(true);
      expect(stratification.edges.length).toBeGreaterThan(0);
    });

    it('marks a run-once rule, which is why it lands in a later stratum', async () => {
      const { blocks, stratification } = (
        await analyze(
          'PREFIX ex: <http://example/>\n'
          + 'RULE { ?s ex:q ?o } WHERE { ?s ex:p ?o }\n'
          + 'RULE { ?s ex:sum ?total } WHERE { ?s ex:q ?o SET (?total := ?o + 1) }',
        )
      ).json();
      expect(blocks[0]).toMatchObject({ runOnce: false, stratum: 0 });
      // SET makes the rule SL.once, so what it reads must be complete first.
      expect(blocks[1]).toMatchObject({ runOnce: true, stratum: 1 });
      expect(stratification.runOnceCount).toBe(1);
      expect(stratification.edges[0]).toMatchObject({ label: 'closed' });
    });

    it('reports a cycle through negation as unstratified', async () => {
      const { stratification } = (
        await analyze(
          'PREFIX ex: <http://example/>\n'
          + 'RULE { ?s ex:p ?o } WHERE { ?s ex:q ?o NOT { ?s ex:r ?o } }\n'
          + 'RULE { ?s ex:q ?o } WHERE { ?s ex:p ?o }\n'
          + 'RULE { ?s ex:r ?o } WHERE { ?s ex:p ?o }',
        )
      ).json();
      expect(stratification.stratified).toBe(false);
      expect(stratification.issues.join(' ')).toMatch(/cycle/i);
    });

    it('withholds strata for an unstratified document and reports the cycle as data', async () => {
      const { blocks, stratification } = (
        await analyze(
          'PREFIX : <http://example/>\n'
          + '\n'
          + 'RULE { ?s :p "abc" } WHERE { ?s :data "" NOT { ?s :p "ABC" } }\n'
          + '\n'
          + 'RULE { :s :p "ABC" } WHERE { NOT { ?x :p "abc" } ?s :data "" }',
        )
      ).json();
      expect(stratification.stratified).toBe(false);
      expect(stratification.strata).toEqual({});
      expect(stratification.strataCount).toBe(0);
      expect(blocks.map((block: { stratum: number | null }) => block.stratum)).toEqual([null, null]);
      expect(stratification.cycles).toHaveLength(1);
      expect(stratification.cycles[0]).toMatchObject({ kind: 'negation', rules: ['rule-1', 'rule-2'] });
      expect(stratification.cycles[0].edges).toHaveLength(2);
      // Issue text names rules the way the editor does, not by internal id.
      expect(stratification.issues.join(' ')).toMatch(/rule at L3/);
      expect(stratification.issues.join(' ')).toMatch(/rule at L5/);
      expect(stratification.issues.join(' ')).not.toMatch(/rule-\d/);
    });

    it('prefers an author-supplied rule name to the head predicate', async () => {
      const { blocks } = (
        await analyze('PREFIX ex: <http://example/>\nRULE ex:mine { ?s ex:q ?o } WHERE { ?s ex:p ?o }')
      ).json();
      expect(blocks[0].name).toBe('ex:mine');
      expect(blocks[0].label).toBe('ex:mine');
    });

    it('reports a syntax error as invalid rather than as a failed request', async () => {
      const res = await analyze('PREFIX ex: <http://example/>\nRULE { ?s ex:q ?o } WHERE {');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.valid).toBe(false);
      expect(body.error).toBeTruthy();
      expect(body.blocks).toEqual([]);
    });

    it('treats TUPLE as a syntax error unless the extension is on', async () => {
      const off = await analyze('PREFIX ex: <http://example/>\nRULE { TUPLE(ex:rel, ?s) } WHERE { ?s ex:p ?o }');
      expect(off.json().valid).toBe(false);
      const on = await analyze('PREFIX ex: <http://example/>\nRULE { TUPLE(ex:rel, ?s) } WHERE { ?s ex:p ?o }', true);
      expect(on.json().valid).toBe(true);
      expect(on.json().blocks[0].label).toBe('TUPLE');
    });

    it('returns an empty analysis for an empty document', async () => {
      const body = (await analyze('   ')).json();
      expect(body).toMatchObject({ valid: true, ruleCount: 0, dataBlockCount: 0, blocks: [] });
    });

    it('reports well-formedness issues alongside a parseable document', async () => {
      const body = (await analyze('PREFIX ex: <http://example/>\nRULE { ?s ex:q ?unbound } WHERE { ?s ex:p ?o }')).json();
      expect(body.valid).toBe(true);
      expect(body.wellFormedness[0]).toMatchObject({ category: 'unbound-head', ruleIndex: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Import: CONSTRUCT / INSERT … WHERE -> rule.
  // -------------------------------------------------------------------------

  describe('from-sparql', () => {
    const convert = (query: string, targetPrologue = 'PREFIX : <http://example/>') =>
      app.inject({
        method: 'POST',
        url: '/rule-sets/srl/from-sparql',
        payload: { query, targetPrologue },
      });

    it('converts a CONSTRUCT into a rule', async () => {
      const res = await convert('PREFIX : <http://example/> CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }');
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rule).toBe('RULE { ?s :q ?o . } WHERE { ?s :p ?o . }');
      expect(body.issues).toEqual([]);
      expect(body.runOnce).toBe(false);
    });

    it('names the rule when asked', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/from-sparql',
        payload: {
          query: 'PREFIX : <http://example/> CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }',
          targetPrologue: 'PREFIX : <http://example/>',
          name: 'http://example/r1',
        },
      });
      expect(res.json().rule).toContain('RULE :r1');
    });

    /*
     * The convention `/srl/analyze` set: a document the user is still working
     * on is a 200 describing what is wrong with it, not a rejected request.
     * Pasting a SELECT into the import dialog is a state it renders.
     */
    it('reports an unconvertible query as a 200, not a 4xx', async () => {
      const res = await convert('PREFIX : <http://example/> SELECT * WHERE { ?s :p ?o }');
      expect(res.statusCode).toBe(200);
      expect(res.json().rule).toBeNull();
      expect(res.json().issues[0]).toMatchObject({ severity: 'error', code: 'not-importable' });
    });

    it('reports every unsupported construct at once', async () => {
      const res = await convert(
        'PREFIX : <http://example/> CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o OPTIONAL { ?s :m ?n } VALUES ?v { 1 } }',
      );
      const constructs = res.json().issues.map((issue: { construct?: string }) => issue.construct);
      expect(constructs).toEqual(expect.arrayContaining(['OPTIONAL', 'VALUES']));
    });

    it('warns rather than fails when a bare BIND becomes a SET', async () => {
      const body = (await convert(
        'PREFIX : <http://example/> CONSTRUCT { ?s :q ?x } WHERE { ?s :p ?o BIND(?o + 1 AS ?x) }',
      )).json();
      expect(body.rule).not.toBeNull();
      expect(body.issues).toHaveLength(1);
      expect(body.issues[0]).toMatchObject({ severity: 'warning', code: 'bare-bind' });
      expect(body.runOnce).toBe(true);
    });

    it('spells the rule with the target document\'s prefixes', async () => {
      const body = (await convert(
        'PREFIX x: <http://query/> CONSTRUCT { ?s x:q ?o } WHERE { ?s x:p ?o }',
        'PREFIX x: <http://other/>\nPREFIX q: <http://query/>',
      )).json();
      expect(body.rule).toContain('q:q');
      expect(body.prefixes).toContainEqual({ prefix: 'x', namespace: 'http://query/', conflicts: true });
    });

    it('rejects an empty body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/rule-sets/srl/from-sparql',
        payload: { query: '   ' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('converts an INSERT … WHERE into the same rule as the equivalent CONSTRUCT', async () => {
      const inserted = (await convert(
        'PREFIX : <http://example/> INSERT { ?s :q ?o } WHERE { ?s :p ?o }',
      )).json();
      const constructed = (await convert(
        'PREFIX : <http://example/> CONSTRUCT { ?s :q ?o } WHERE { ?s :p ?o }',
      )).json();
      expect(inserted.rule).toBe(constructed.rule);
      expect(inserted.form).toBe('insert');
      expect(constructed.form).toBe('construct');
    });

    it('reports an unimportable update as a 200 naming the form', async () => {
      const res = await convert('PREFIX : <http://example/> DELETE WHERE { ?s :p ?o }');
      expect(res.statusCode).toBe(200);
      expect(res.json().rule).toBeNull();
      expect(res.json().issues[0]).toMatchObject({ severity: 'error', code: 'not-importable' });
      expect(res.json().issues[0].message).toContain('DELETE WHERE');
    });

    it('rejects a DELETE/INSERT because a rule cannot retract', async () => {
      const body = (await convert(
        'PREFIX : <http://example/> DELETE { ?s :p ?o } INSERT { ?s :q ?o } WHERE { ?s :p ?o }',
      )).json();
      expect(body.rule).toBeNull();
      expect(body.issues.map((issue: { code: string }) => issue.code)).toContain('delete-clause');
    });
  });
});
