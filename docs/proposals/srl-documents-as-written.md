# Rule sets keep the SRL document as written

This proposes that a rule set version store the SRL document its author saved,
verbatim, beside the canonical rule and data block versions it stores today.
`GET /rule-sets/:id/srl` would return that document, so a rule set reads back
with the author's prefixes, layout and comments, as a query already does.

The canonical form stays, for the jobs it does now: deciding whether two rules
are the same rule, reusing rule versions across saves and rule sets, and giving
the executor and stratifier self-contained text. It stops being the only text
sqlib keeps.

Nothing here is implemented. The behaviour described under
[What rule sets lose today](#what-rule-sets-lose-today) was checked on
2026-10-26 against the published image `sha-328eaec5c046`.

## Summary of proposed changes

1. Add `srlDocument` to `RuleSetVersion`
   (`packages/api/src/persistence/schemas/RuleSetVersionSchema.ts`): the
   document text as posted, immutable with the version.
2. Store it from `POST /rule-sets/:id/srl` (`packages/api/src/routes/rule-sets.ts`)
   and from the W3C suite seeder (`packages/api/src/lib/w3cRulesSuite/seed.ts`),
   which already holds each entry's document.
3. Return it from `GET /rule-sets/:id/srl` when the version has one, ignoring
   the `prologue` parameter, and say which kind of document was returned.
   Generate the document as now (`buildRuleSetDocument`,
   `packages/api/src/lib/ruleSetDocument.ts`) when it has none.
4. Carry it in export bundles (`packages/api/src/lib/export/ruleSetBundle.ts`),
   which take the document from the same function.
5. In the web app, stop sending a default prologue when a saved rule set is
   first opened (`DEFAULT_PROLOGUE` and `prologueFor` in
   `packages/web/src/components/RuleSetWorkArea.vue`). Send one only for a
   version without a stored document.
6. Keep the tuple seed text as written beside the canonical seeds, for the
   same reason.

## The pattern sqlib already uses

For every other authored asset, a version stores the text its author saved,
and anything the machinery needs is derived from that text:

| Version | Stored text | Derived from it |
| --- | --- | --- |
| `QueryVersion` | `queryString`, verbatim | query type, parameters (`limitParameters`, `offsetParameters`), `inferredInputs`, `inferredOutputs`, the static-export template |
| `DataGraphVersion` | `contentString`, verbatim | `tripleCount`, validity |
| `TupleSetVersion` | `contentString`, verbatim | `tupleColumns`, `rowCount` |
| `RuleSetVersion` | **none** | — |

A rule set version holds only `hasRule` and `hasDataBlock`, links to rule and
data block versions whose text is canonical. The document a person wrote is
parsed on import and then discarded.

Queries show what the pattern gives. A query can be formatted however its
author likes, and it stays that way: a layout change is a change to the stored
text, so saving it makes a new version, and nothing re-lays it out. On the image
above, saving `SELECT * WHERE { ?s ?p ?o }` and then the same query over three
lines produced two versions, each holding exactly the text posted.

## What rule sets lose today

`POST /rule-sets/:id/srl` splits the document into rules and data blocks and
stores each in canonical form: IRIs expanded, no prologue, and serialised from
the parsed rule rather than from the source text. For this document

```
PREFIX : <http://example/>
# why this rule exists
RULE { ?x :q ?y } # head
WHERE { ?x a :C ; :p ?y }
```

the stored rule is

```
RULE { ?x <http://example/q> ?y . } WHERE { ?x <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example/C> . ?x <http://example/p> ?y . }
```

The prefixes, the comments, the layout, `a` and the `;` shorthand are all gone,
and nothing else records them.

`GET /rule-sets/:id/srl` then rebuilds a document from the canonical rules and
a `prologue` the caller supplies. The web app supplies the leading `PREFIX`
lines of the document on screen, or `PREFIX : <http://example/>` when it opens a
rule set for the first time. A rule set written with any other prefix opens with
its IRIs in full, and every rule set opens on one line per rule, whatever its
author saved.

Editing the layout in the web app shows a Save button, but the edit does not
survive. Saving a reformatted, prefixed copy of an existing rule set on the
image above created a new rule set version pointing at the same rule version,
whose text was still the one-line canonical form. A rule new to the document
was stored canonically too, with `true` rewritten as
`"true"^^<http://www.w3.org/2001/XMLSchema#boolean>`.

## The change

### What is stored

`RuleSetVersion.srlDocument` holds the `srl` string posted to
`POST /rule-sets/:id/srl`, unchanged. The rule and data block versions are
derived from it exactly as now, and `hasRule` and `hasDataBlock` keep pointing
at them.

The document and the links describe the same version. The links are what runs;
the document is what was written. A version is immutable, so the two cannot
drift apart after it is created.

### What stays canonical

Rule identity is unchanged. An unnamed rule is identified by a hash of its
canonical text, and `canonicalizeStoredRule` recomputes that form by parsing the
stored rule, so matching on import does not depend on how anything is
displayed. Re-importing a document that differs only in prefixes, layout or
comments still reuses every rule version. A rule shared by two rule sets is
still one rule, displayed in each with that rule set's own document.

The executor, the stratifier and the compiler keep reading the canonical rule
text, which needs no prologue to parse.

### What is returned

`GET /rule-sets/:id/srl` returns `srlDocument` for a version that has one, and
reports `documentSource: "stored"`. The `prologue` parameter does not apply to a
stored document: its prefixes are the author's.

For a version without one, it generates the document as now and reports
`documentSource: "generated"`. That covers versions saved before this change,
and versions created through `POST /rule-sets/:id/versions` from a list of rule
versions rather than from a document.

The export bundle takes its document from `buildRuleSetDocument`, so it carries
the stored document under the same rule.

### What a save does

| Edit | Rule versions | Rule set version |
| --- | --- | --- |
| Layout, prefixes or comments only | all reused | new, with the new document |
| A rule changed | new version for that rule, the rest reused | new |
| Nothing changed | all reused | new, as now |

The first row is the change: today it creates a rule set version whose document
is lost. After it, the version keeps what was saved, as a query version does.

The last row is unchanged, and matches queries, which also make a new version
from identical text. Whether either should skip an identical save is a separate
question, listed below.

### The web app

`RuleSetWorkArea.vue` sends `prologueFor(id)` with every load, which is
`DEFAULT_PROLOGUE` on first open. With stored documents it sends no prologue,
uses the document it gets back, and falls back to the current behaviour only
when the response says the document was generated.

The editor's Format and Shorten buttons stay as editing tools. What they produce
is kept if the author saves it, and nothing applies them on load.

### Tuple seeds

Tuple seeds are stored canonically on the rule set version
(`canonicalTupleSeeds` in `rule-sets.ts`), and the comment there gives the
reason: "nothing stores the prologue beside it". With the document stored, the
seed text can be kept as written as well, beside the canonical seeds the
executor reads, and returned with the stored document.

## Alternatives considered

| Alternative | Why not |
| --- | --- |
| Store a prefix map on each rule set version, and keep generating the document | Keeps prefixes but still loses layout and comments. It also gives rule sets a mechanism queries do not have: a query keeps its prefixes in its text. |
| Format every document on output | Imposes one layout on every rule set, so an author could not format a rule set differently. |
| Store each rule's text as written, instead of canonically | A rule's text has no prologue of its own, and a rule shared by two rule sets can hold only one spelling. A layout-only re-import reuses the old rule version, so the new layout would be lost anyway. |
| Shorten IRIs in the web app on load | Depends on the browser's prefix list rather than the author's, and leaves layout and comments lost. |

## Compatibility

Existing versions have no `srlDocument` and are served as now, so no migration
is needed. A rule set gains a stored document the next time it is saved as a
document.

Libraries seeded from SRL files, such as the W3C suite and the sqlib-demos
libraries, would show their source files as written once reseeded. sqlib-demos
currently rewrites the stored rule text after seeding so rule sets display
formatted; that step would no longer be needed.

## Open questions

- **Identical saves.** Queries and rule sets both create a new version when
  nothing changed. Skipping an identical save would apply to both, and is not
  part of this change.
- **Mixed editing routes.** A rule set whose versions are created both from
  documents and through `POST /rule-sets/:id/versions` alternates between
  stored and generated documents. Recording `documentSource` makes that
  visible; merging the two is not proposed.
- **Documents that do not parse.** The invalid-save route already stores a
  rejected document as one rule version holding the whole text. It could store
  `srlDocument` as well, so a rejected document reads back exactly as written.
