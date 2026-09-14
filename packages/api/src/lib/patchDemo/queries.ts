/**
 * The update queries the demo library ships, and why each one is here.
 *
 * Every one of them is chosen for something it makes visible in a preview that
 * the others do not: raw counts against net counts, an empty diff, a named
 * graph in `graphScope`, an operation that reads what the one before it wrote,
 * a graph verb that is counted rather than diffed. Running them in order walks
 * the whole of `packages/rdf-delta`'s public behaviour without reading a line
 * of it.
 *
 * They are ordinary `Query` entities pointed at the demo backend, so the flow
 * under test is exactly the product flow: open one, press Run, read the patch.
 */

export interface PatchDemoQuery {
  /** Stable slug — the id is minted from it, so re-seeding is a no-op. */
  slug: string;
  name: string;
  /** Shown under the name in the editor. Says what to look for in the patch. */
  description: string;
  updateString: string;
}

export const PATCH_DEMO_QUERIES: readonly PatchDemoQuery[] = [
  {
    slug: 'insert-data',
    name: '1. INSERT DATA — the simplest diff there is',
    description:
      'One new document, none of it in the store. The patch is three additions and no deletions — '
      + 'three, because `a ex:Document` is a triple like any other. Start here: it is the shape '
      + 'every other preview is a variation on.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

INSERT DATA {
  ex:doc-5 a ex:Document ;
    ex:title "Travel policy" ;
    ex:status "draft" .
}`,
  },
  {
    slug: 'insert-data-partly-present',
    name: '2. INSERT DATA — where half of it is already true',
    description:
      'Three triples asked for, two of which the store already holds — doc-3 is a Document and is '
      + 'already live. Read rawInsertCount (3) against additionCount (1): inserting a triple that '
      + 'is present is a no-op, and the patch reports the change rather than the request.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

INSERT DATA {
  ex:doc-3 a ex:Document ;
    ex:status "live" ;
    ex:owner "platform-team" .
}`,
  },
  {
    slug: 'delete-data',
    name: '3. DELETE DATA — and one triple that was never there',
    description:
      'Deleting an absent triple is also a no-op. rawDeleteCount counts what was asked for, '
      + 'deletionCount what the store would actually lose — the half of a preview worth reading '
      + 'before you approve it.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

DELETE DATA {
  ex:doc-4 ex:reviewNote "Superseded by the finance handbook" .
  ex:doc-4 ex:reviewNote "A note nobody ever wrote" .
}`,
  },
  {
    slug: 'delete-insert-where',
    name: '4. DELETE … INSERT … WHERE — promote every draft',
    description:
      'The flagship form. The templates are instantiated against the store as it stands before '
      + 'the write, so the patch names the two concrete documents that would move from draft to '
      + 'live — not the pattern that would find them.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

DELETE { ?doc ex:status "draft" }
INSERT { ?doc ex:status "live" }
WHERE  { ?doc ex:status "draft" }`,
  },
  {
    slug: 'delete-where',
    name: '5. DELETE WHERE — clear the review notes',
    description:
      'One template doing both jobs. Every review note in the store, listed as ground triples, '
      + 'so you can see exactly what would go.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

DELETE WHERE { ?doc ex:reviewNote ?note }`,
  },
  {
    slug: 'no-op',
    name: '6. The update that changes nothing',
    description:
      'It deletes a triple and puts the same one back. Net effect is empty: zero additions, zero '
      + 'deletions, and the raw counts show the work that would have been done for it. Knowing an '
      + 'update is a no-op before running it is the cheapest thing a preview buys you.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

DELETE { ?doc ex:status "live" }
INSERT { ?doc ex:status "live" }
WHERE  { ?doc ex:status "live" }`,
  },
  {
    slug: 'graph-scoped',
    name: '7. INSERT … WHERE into a named graph',
    description:
      'Retired documents are copied into <…#archive>. The patch quads carry that graph and it '
      + 'shows up in graphScope, so "which graphs would this touch?" is answerable without '
      + 'reading the update.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

INSERT { GRAPH ex:archive { ?doc ex:archivedOn "2026-09-03" } }
WHERE  { ?doc ex:status "retired" }`,
  },
  {
    slug: 'multi-operation',
    name: '8. Two operations, the second reading what the first wrote',
    description:
      'A program, not an operation. The second half can only be derived against the state the '
      + 'first half leaves, so the store is forked and the operations replayed on the copy — '
      + 'which is why this needs an in-process backend and an HTTP one refuses it. The patch is '
      + 'the net effect of both, including the document the first operation invented.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

INSERT DATA {
  ex:doc-6 a ex:Document ;
    ex:title "Key handover" ;
    ex:status "draft" .
} ;

DELETE { ?doc ex:status "draft" }
INSERT { ?doc ex:status "live" }
WHERE  { ?doc ex:status "draft" }`,
  },
  {
    slug: 'drop-graph',
    name: '9. DROP GRAPH — the edge of the feature',
    description:
      'A graph verb names a graph, not triples, and what it holds is a separate question with a '
      + 'separate cost — so it is counted rather than diffed. There is nothing for an RDF Patch '
      + 'document to say, and Run tells you so: a 422 naming the GET /patches/<id> where the '
      + 'record is, carrying graphOps with affectedCount 8 — the triples in the archive graph, '
      + 'reached with one COUNT rather than listed — plus enumerated false, applyMode '
      + '"graph-ops" and revertible false. An honest refusal is the point of it; a patch that '
      + 'silently showed no quads for a dropped graph would be the bug.',
    updateString: `PREFIX ex: <https://example.com/catalogue#>

DROP GRAPH ex:archive`,
  },
];
