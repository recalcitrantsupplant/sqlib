/**
 * The rewrite as a pure function, and the forms it declines to guess at.
 *
 * A preview that is quietly wrong is worse than no preview, so every form this
 * package cannot derive exactly must fail loudly and name what it choked on.
 */

import { describe, expect, it } from 'vitest';
import { planUpdate, UnsupportedUpdateError, type QuadOperationPlan } from '../src/index.js';
import { patchFor, storeFrom } from './support/harness.js';

function quadPlan(update: string): QuadOperationPlan {
  const operation = planUpdate(update).operations[0];
  if (operation.kind !== 'quads') throw new Error('expected a quad operation');
  return operation;
}

describe('planUpdate', () => {
  it('splits a template by graph context', () => {
    const plan = quadPlan(
      'INSERT { ?s <http://ex/p> ?o . GRAPH <http://ex/g> { ?s <http://ex/q> ?o } GRAPH ?v { ?s <http://ex/r> ?o } } WHERE { ?s <http://ex/p> ?o }',
    );

    expect(plan.insertParts.map((part) => part.graph)).toEqual([
      { kind: 'default' },
      { kind: 'iri', value: 'http://ex/g' },
      { kind: 'variable', value: 'v' },
    ]);
  });

  it('expands a prefixed graph name, because the IRI is stamped on the quads', () => {
    const plan = quadPlan('PREFIX g: <http://ex/graphs/> INSERT DATA { GRAPH g:one { <http://ex/a> <http://ex/p> <http://ex/b> } }');

    expect(plan.insertParts[0].graph).toEqual({ kind: 'iri', value: 'http://ex/graphs/one' });
  });

  it('carries a prologue written once into every later operation', () => {
    // The parser hangs the declarations off the unit they were written on, so
    // this reads them from operation two, which declared none of its own.
    const plan = planUpdate(
      'PREFIX g: <http://ex/graphs/> INSERT DATA { GRAPH g:one { <http://ex/a> <http://ex/p> <http://ex/b> } } ; ' +
        'INSERT DATA { GRAPH g:two { <http://ex/a> <http://ex/p> <http://ex/b> } }',
    );

    const second = plan.operations[1];
    if (second.kind !== 'quads') throw new Error('expected a quad operation');
    expect(second.insertParts[0].graph).toEqual({ kind: 'iri', value: 'http://ex/graphs/two' });
    expect(second.prologue).toContain('PREFIX g: <http://ex/graphs/>');
    // The replay text is what advances the fork during simulation, so it has to
    // carry the declarations too or the store rejects it.
    expect(second.text).toContain('http://ex/graphs/');
  });

  /*
   * No equivalence case beside this one: Oxigraph's parser rejects a prologue
   * after the first operation outright, so the oracle cannot run the program.
   * The merge rule still has to be right — an HTTP backend on Jena accepts it —
   * so it is pinned here, at the level that can be checked.
   */
  it('lets a redeclared prefix win, and declares it once', () => {
    const plan = planUpdate(
      'PREFIX p: <http://ex/> INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> } ; ' +
        'PREFIX p: <http://other/> INSERT DATA { GRAPH p:g { <http://ex/a> <http://ex/p> <http://ex/b> } }',
    );

    const second = plan.operations[1];
    if (second.kind !== 'quads') throw new Error('expected a quad operation');
    expect(second.insertParts[0].graph).toEqual({ kind: 'iri', value: 'http://other/g' });
    expect(second.prologue.match(/PREFIX p:/g)).toHaveLength(1);
  });

  it('resolves a BASE-relative graph name', () => {
    const plan = quadPlan('BASE <http://ex/> INSERT DATA { GRAPH <g1> { <a> <p> <b> } }');

    expect(plan.insertParts[0].graph).toEqual({ kind: 'iri', value: 'http://ex/g1' });
  });

  it('wraps the WHERE clause in the WITH graph rather than restricting the dataset', () => {
    const plan = quadPlan('WITH <http://ex/g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');

    expect(plan.whereText).toMatch(/^\{ GRAPH <http:\/\/ex\/g> \{/);
    expect(plan.datasetText).toBe('');
    expect(plan.deleteParts[0].graph).toEqual({ kind: 'iri', value: 'http://ex/g' });
  });

  it('lets USING define the dataset and leaves WITH to the templates', () => {
    const plan = quadPlan('WITH <http://ex/g> INSERT { ?s ?p ?o } USING <http://ex/u> WHERE { ?s ?p ?o }');

    expect(plan.datasetText).toContain('FROM <http://ex/u>');
    expect(plan.whereText).not.toContain('GRAPH <http://ex/g>');
    expect(plan.insertParts[0].graph).toEqual({ kind: 'iri', value: 'http://ex/g' });
  });

  it('reads DELETE WHERE as its own template and body', () => {
    const plan = quadPlan('DELETE WHERE { ?s <http://ex/p> ?o }');

    expect(plan.deleteParts).toHaveLength(1);
    expect(plan.whereText).toContain('?s <http://ex/p> ?o');
    expect(plan.insertParts).toHaveLength(0);
  });

  it('treats the DATA forms as ground templates over an empty WHERE', () => {
    const plan = quadPlan('INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> }');

    expect(plan.ground).toBe(true);
    expect(plan.whereText).toBe('{}');
  });

  it('records a graph-management operation as itself', () => {
    const operation = planUpdate('CLEAR GRAPH <http://ex/g>').operations[0];

    expect(operation.kind).toBe('graph');
    expect(operation).toMatchObject({ form: 'clear' });
  });

  it('plans every operation of a program', () => {
    const plan = planUpdate('INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> } ; DELETE WHERE { ?s ?p ?o }');

    expect(plan.operations.map((operation) => (operation.kind === 'quads' ? operation.form : operation.form))).toEqual([
      'insertdata',
      'deletewhere',
    ]);
  });
});

describe('what it refuses', () => {
  it('refuses a program that reads what an earlier operation wrote, on a store it cannot fork', async () => {
    await expect(
      patchFor(
        storeFrom(''),
        'INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> } ; DELETE WHERE { ?s <http://ex/p> ?o }',
        { simulation: 'none' },
      ),
    ).rejects.toThrow(/Operation 2 of 2/);
  });

  it('refuses a query', async () => {
    await expect(patchFor(storeFrom(''), 'SELECT * WHERE { ?s ?p ?o }')).rejects.toThrow(UnsupportedUpdateError);
  });
});
