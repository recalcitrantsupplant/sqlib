/**
 * A patch, written down.
 *
 * Three serialisations, because a patch has three audiences: SPARQL, for any
 * endpoint that should apply it; RDF Patch, for anything that already speaks
 * RDF-Delta; and N-Quads per side, for storage and for hashing.
 */

import { UnsupportedUpdateError } from './errors.js';
import { graphIri, quadToNQuad, quadsToNQuads, termToNTriples, type QuadLike } from './terms.js';
import type { Patch } from './derive.js';

/** The patch with its two sides swapped: applying it undoes the original. */
export function invertPatch(patch: Patch): Patch {
  if (!patch.revertible) {
    throw new UnsupportedUpdateError(
      patch.applyMode === 'graph-ops'
        ? 'This patch carries a graph-management operation that was counted rather than enumerated, ' +
          'so its quad sets never recorded what to put back. Preview it with enumeration to get an ' +
          'invertible patch.'
        : 'This patch carries blank nodes, so its inverse would re-mint rather than restore them.',
    );
  }
  return {
    ...patch,
    additions: patch.deletions,
    deletions: patch.additions,
    additionCount: patch.deletionCount,
    deletionCount: patch.additionCount,
    rawInsertCount: patch.deletionCount,
    rawDeleteCount: patch.additionCount,
  };
}

/** Both sides as N-Quads documents. */
export function patchToNQuads(patch: Patch): { additions: string; deletions: string } {
  return {
    additions: quadsToNQuads(patch.additions),
    deletions: quadsToNQuads(patch.deletions),
  };
}

/**
 * The patch as SPARQL any endpoint can apply.
 *
 * Deletions first, and in one request: `DELETE DATA` followed by `INSERT DATA`
 * is the pair that re-states a changed triple correctly, and conforming stores
 * apply the request atomically.
 */
export function patchToSparqlUpdate(patch: Patch): string {
  if (patch.applyMode === 'graph-ops') {
    throw new UnsupportedUpdateError(
      'This patch carries a graph-management operation the quad sets do not express, so applying the ' +
        'quads alone would not reproduce the update. Preview it with enumeration, or run the update.',
    );
  }
  if (patch.applyMode !== 'ground-sparql') {
    throw new UnsupportedUpdateError(
      'This patch carries blank nodes, which DELETE DATA forbids; apply it through the store API instead.',
    );
  }
  const blocks: string[] = [];
  if (patch.deletions.length > 0) blocks.push(`DELETE DATA {\n${quadsBlock(patch.deletions)}}`);
  if (patch.additions.length > 0) blocks.push(`INSERT DATA {\n${quadsBlock(patch.additions)}}`);
  return blocks.join(' ;\n');
}

/**
 * A `QuadData` block: triples bare, and everything else inside its `GRAPH`.
 *
 * Not N-Quads. The two look alike for the default graph, which is why writing
 * N-Quads straight into `DELETE DATA` appears to work until the first patch
 * touching a named graph — where the trailing graph term is a fourth node in a
 * triple, and the parser says so.
 */
function quadsBlock(quads: readonly QuadLike[]): string {
  const byGraph = new Map<string | undefined, QuadLike[]>();
  for (const quad of quads) {
    const graph = graphIri(quad);
    const bucket = byGraph.get(graph);
    if (bucket) bucket.push(quad);
    else byGraph.set(graph, [quad]);
  }

  let text = '';
  for (const [graph, bucket] of byGraph) {
    const triples = bucket.map((quad) => `  ${triple(quad)}\n`).join('');
    text += graph === undefined ? triples : `  GRAPH <${graph}> {\n${indent(triples)}  }\n`;
  }
  return text;
}

function triple(quad: QuadLike): string {
  return `${termToNTriples(quad.subject)} ${termToNTriples(quad.predicate)} ${termToNTriples(quad.object)} .`;
}

function indent(text: string): string {
  return text.replace(/^(?=.)/gm, '  ');
}

export interface RdfPatchOptions {
  /** `H id` — this patch's identity. */
  id?: string;
  /** `H prev` — the patch this one follows in a log. */
  previous?: string;
}

/**
 * The patch in the [RDF Patch](https://afs.github.io/rdf-delta/rdf-patch.html)
 * text format: `H` headers, one transaction, `D` rows then `A` rows.
 *
 * Deletions are written first for the same reason the SPARQL form puts them
 * first — a patch that both removes and adds a statement about the same subject
 * reads as a replacement, and applies as one.
 *
 * The format has rows for quads and nothing else, so a patch's `graphOps` have
 * no spelling here. For an enumerated operation that costs nothing — its effect
 * *is* the quads. For a counted one the rows are not the whole update, which is
 * what `applyMode: 'graph-ops'` says on the JSON view; a consumer replaying RDF
 * Patch text alone would miss it.
 */
export function patchToRdfPatch(patch: Patch, options: RdfPatchOptions = {}): string {
  const lines: string[] = [];
  if (options.id) lines.push(`H id <${options.id}> .`);
  if (options.previous) lines.push(`H prev <${options.previous}> .`);
  lines.push('TX .');
  for (const quad of patch.deletions) lines.push(`D ${row(quad)}`);
  for (const quad of patch.additions) lines.push(`A ${row(quad)}`);
  lines.push('TC .');
  return `${lines.join('\n')}\n`;
}

function row(quad: QuadLike): string {
  return quadToNQuad(quad);
}
