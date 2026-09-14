/**
 * The dataset the patch demo derives against.
 *
 * Small enough to read in full on screen — the point of a preview is that you
 * can check it against what you know the store holds, and a demo where you
 * cannot do that teaches nothing. Two graphs rather than one, because
 * `graphScope` and the `GRAPH` forms are half of what there is to show.
 */

/** The default graph: a documents catalogue mid-review. */
export const PATCH_DEMO_CATALOGUE = `
@prefix ex: <https://example.com/catalogue#> .

ex:doc-1 a ex:Document ;
  ex:title "Onboarding guide" ;
  ex:status "draft" ;
  ex:reviewNote "Needs a screenshot" .

ex:doc-2 a ex:Document ;
  ex:title "Retention policy" ;
  ex:status "draft" ;
  ex:reviewNote "Legal have signed off" .

ex:doc-3 a ex:Document ;
  ex:title "Incident runbook" ;
  ex:status "live" .

ex:doc-4 a ex:Document ;
  ex:title "Expenses" ;
  ex:status "retired" ;
  ex:reviewNote "Superseded by the finance handbook" .
`;

/**
 * `<https://example.com/catalogue#archive>`: a named graph with something in
 * it, so `DROP GRAPH` has a count worth showing. An empty graph would make the
 * counted-not-enumerated distinction invisible.
 */
export const PATCH_DEMO_ARCHIVE = `
@prefix ex: <https://example.com/catalogue#> .

ex:doc-0 a ex:Document ;
  ex:title "Fax cover sheet" ;
  ex:status "retired" ;
  ex:archivedOn "2019-04-01" .

ex:doc-00 a ex:Document ;
  ex:title "Office move FAQ" ;
  ex:status "retired" ;
  ex:archivedOn "2021-11-30" .
`;

export const PATCH_DEMO_ARCHIVE_GRAPH = 'https://example.com/catalogue#archive';
