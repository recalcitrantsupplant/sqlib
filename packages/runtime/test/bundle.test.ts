import { describe, expect, it } from 'vitest';
import {
  InvalidBundleError,
  assertValidBundle,
  hashTemplateText,
  verifyBundleIntegrity,
} from '../src/bundle.js';
import { bundleOf, template } from './helpers.js';

const SIMPLE = () => template('SELECT ?s WHERE { «VALUES ?s { UNDEF }» ?s ?p ?o }');

describe('assertValidBundle', () => {
  it('accepts a bundle as exported', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  it('rejects a future bundle version rather than guessing at it', async () => {
    const bundle = { ...(await bundleOf({ people: SIMPLE() })), version: 2 };
    expect(() => assertValidBundle(bundle)).toThrow(/version 2/);
  });

  it('rejects a slot that runs past the end of the text', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.slots[0].end = 10_000;
    expect(() => assertValidBundle(bundle)).toThrow(/outside the template text/);
  });

  it('rejects overlapping slots', async () => {
    const bundle = await bundleOf({
      two: template('SELECT * { «VALUES ?a { UNDEF }» «VALUES ?b { UNDEF }» }'),
    });
    bundle.queries.two.template.slots[1].start = 0;
    expect(() => assertValidBundle(bundle)).toThrow(/ordered and disjoint/);
  });

  it('catches an edit that slid the spans off their VALUES blocks', async () => {
    // The failure this format is fragile to: someone reformats the query text by
    // hand and every span after the edit now points a few characters early.
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.text = bundle.queries.people.template.text.replace(
      'SELECT ?s',
      'SELECT   ?s',
    );
    expect(() => assertValidBundle(bundle)).toThrow(/does not start at a VALUES keyword/);
  });

  it('rejects a signature that disagrees with the template', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.inferredInputs = [];
    expect(() => assertValidBundle(bundle)).toThrow(/describes 0 slots/);
  });

  it('rejects an unsupported query type', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    (bundle.queries.people as { queryType: string }).queryType = 'UPDATE';
    expect(() => assertValidBundle(bundle)).toThrow(/unsupported queryType/);
  });

  it('rejects a variable name the runtime could not emit', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.slots[0].vars = ['s p'];
    expect(() => assertValidBundle(bundle)).toThrow(InvalidBundleError);
  });
});

describe('verifyBundleIntegrity', () => {
  it('passes for an untouched bundle', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    await expect(verifyBundleIntegrity(bundle)).resolves.toBeUndefined();
  });

  it('catches an edit the structural check cannot see', async () => {
    // Changing a term inside the query leaves every span valid, so only the hash
    // can tell you the text is no longer the text that was exported and verified.
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.template.text = bundle.queries.people.template.text.replace('?o', '?z');
    await expect(verifyBundleIntegrity(bundle)).rejects.toThrow(/has been edited/);
  });
});

describe('hashTemplateText', () => {
  it('is stable and prefixed', async () => {
    const hash = await hashTemplateText('SELECT * { ?s ?p ?o }');
    expect(hash).toMatch(/^sha256-[0-9a-f]{64}$/);
    expect(await hashTemplateText('SELECT * { ?s ?p ?o }')).toBe(hash);
  });
});

describe('examples', () => {
  const withExample = async (args: unknown[], name = 'Perth') => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.examples = [{ name, arguments: args as never }];
    return bundle;
  };

  it('accepts an example whose arity matches the query', async () => {
    const bundle = await withExample([{ head: { vars: ['s'] }, results: { bindings: [] } }]);
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  const TWO = [
    { head: { vars: ['s'] }, results: { bindings: [] } },
    { head: { vars: ['s'] }, results: { bindings: [] } },
  ];

  it('rejects an example written against a different signature', async () => {
    // The failure that actually happens: the query lost a slot and every
    // example from before now supplies more arguments than it can take.
    const bundle = await withExample(TWO);
    expect(() => assertValidBundle(bundle)).toThrow(/supplies 2 argument sets but the query has only 1/);
  });

  it('accepts an example that leaves a slot out, since an omitted slot runs open', async () => {
    const bundle = await withExample([]);
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });

  it('names the offending example so it can be found', async () => {
    const bundle = await withExample(TWO, 'By city');
    expect(() => assertValidBundle(bundle)).toThrow(/'By city'/);
  });

  it('rejects an example with no name to show', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    bundle.queries.people.examples = [{ arguments: [] } as never];
    expect(() => assertValidBundle(bundle)).toThrow(/has no name/);
  });

  it('leaves a bundle without examples alone', async () => {
    const bundle = await bundleOf({ people: SIMPLE() });
    expect(bundle.queries.people.examples).toBeUndefined();
    expect(() => assertValidBundle(bundle)).not.toThrow();
  });
});

describe('ETL jobs and rule sets', () => {
  const JOB_TEMPLATE = () => template('CONSTRUCT { ?c <http://ex/name> ?name } WHERE { «VALUES (?c ?name) { (UNDEF UNDEF) }» }');

  async function withJobAndRules() {
    const bundle = await bundleOf({ people: SIMPLE() });
    const jobTemplate = JOB_TEMPLATE();
    const srl = 'RULE { ?x <http://ex/anc> ?y } WHERE { ?x <http://ex/parent> ?y }';
    bundle.etlJobs = {
      customers: {
        template: jobTemplate,
        textHash: await hashTemplateText(jobTemplate.text),
        sql: 'SELECT 1 AS id',
        columns: [
          { columnName: 'id', targetVariable: 'c', termType: 'uri', nullPolicy: 'skipRow' },
          { columnName: 'name', targetVariable: 'name', termType: 'literal', nullPolicy: 'undef' },
        ],
      },
    };
    bundle.ruleSets = {
      ancestors: { srl, textHash: await hashTemplateText(srl), ruleCount: 1, dataBlockCount: 0 },
    };
    return bundle;
  }

  it('accepts a job and a rule set as exported', async () => {
    const bundle = await withJobAndRules();
    expect(() => assertValidBundle(bundle)).not.toThrow();
    await expect(verifyBundleIntegrity(bundle)).resolves.toBeUndefined();
  });

  it('rejects a job column bound to a variable the slot does not declare', async () => {
    const bundle = await withJobAndRules();
    bundle.etlJobs!.customers.columns[1].targetVariable = 'email';
    expect(() => assertValidBundle(bundle)).toThrow(/\?email/);
  });

  it('rejects a job template with no slot for the rows', async () => {
    const bundle = await withJobAndRules();
    bundle.etlJobs!.customers.template = template('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }');
    expect(() => assertValidBundle(bundle)).toThrow(/exactly one parameter slot/);
  });

  it('catches an edited job template or SRL document by its hash', async () => {
    const job = await withJobAndRules();
    job.etlJobs!.customers.template.text = job.etlJobs!.customers.template.text.replace('name>', 'label>');
    await expect(verifyBundleIntegrity(job)).rejects.toThrow(/ETL job 'customers'/);

    const rules = await withJobAndRules();
    rules.ruleSets!.ancestors.srl += '\nRULE { ?x <http://ex/a> ?x } WHERE { ?x ?p ?o }';
    await expect(verifyBundleIntegrity(rules)).rejects.toThrow(/Rule set 'ancestors'/);
  });

  it('rejects a rule set with no document', async () => {
    const bundle = await withJobAndRules();
    bundle.ruleSets!.ancestors.srl = ' ';
    expect(() => assertValidBundle(bundle)).toThrow(/srl must be a non-empty string/);
  });
});
