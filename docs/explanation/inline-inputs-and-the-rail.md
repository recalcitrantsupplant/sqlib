# Inline inputs and the rail

Where a saved input lives, and why each kind lives where it does.

## Inline is a door, not a storage class

A graph pasted into a call and a graph stored in the library are the same bytes,
in the same serialisation, under the same size ceiling, consumed by the same
loader. The only thing that used to differ was which screen they were typed on.

So `ArgumentGraphBinding`'s "exactly one of `dataGraphVersionId` or
`contentString` + `contentFormat`" was never two ways of *supplying* a graph. It
was two ways of *storing* one — a first-class entity with a name, a version and
a rail entry, and an anonymous second-class copy with none of them, chosen by
accident of entry point.

**A graph binding always pins a `DataGraphVersion`.** Pasting RDF into a call is
a create-then-pin, performed when the argument set version is saved. There is no
inline storage class for RDF, so there is no second thing to keep in sync, no
separate size rule, and no content that exists in the library but cannot be
found in it.

One counter-rule keeps this honest, and it is the whole boundary:

> **Running is not saving.** Inline content in an execute request that is never
> saved mints nothing. `/execute` and `/sparql` keep taking inline graphs,
> tables and numbers as transport, and an ad-hoc run leaves no trace in any
> rail. The entity is written when a **version is saved**, because that is the
> moment the content became durable library state anyway.

## One storage class per input kind

| Kind | Where the content lives when saved | Rail entry | Why |
| --- | --- | --- | --- |
| **Graph** | `DataGraphVersion`, always pinned by id | Graphs | RDF content is what a `DataGraph` *is*. An argument set holding RDF was a duplicate of an entity that already exists. |
| **Table** | `ArgumentTupleBinding.contentString` (SRJ) on the argument set version | Argument sets | The argument set is already the entity, already in the rail, already versioned and pinnable. There is no second home to need. |
| **Number** | `ArgumentScalarBinding` on the argument set version | Argument sets | Trivially the same. |

Read the middle column as the answer to "if I save this, where does it end up?"
and the design is one sentence: **every saved input is stored exactly once, in
the entity whose job it is to hold that kind of content, and that entity is in a
rail.**

The test is not "was this typed inline?" but:

> **Is there already an entity whose job is to hold this content?** For RDF,
> yes, and it is not the argument set — so the argument set must point at it.
> For rows supplied to a `VALUES` clause, yes, and it *is* the argument set — so
> they stay put.

Minting a tuple set from a saved `VALUES` table would not remove a second-class
copy. It would *create* a second entity, in a section governed by a different
matching discipline, holding the same rows for no reuse that a person asked for.

## What saving a pasted graph does

On save of an argument set version, every graph binding carrying pasted RDF
becomes a `DataGraph` with one `DataGraphVersion`, in the argument set's
library, and the binding is rewritten to pin that version id. The run is
byte-identical before and after; the set gets strictly *more* reproducible,
because one pin replaces an embedded copy.

**Naming.** The entity needs a name, and it should not stop the save to ask.
A client sends one pre-filled and editable; a request that sends none gets one
derived rather than a refusal. A name arrived at without friction is still a
name — what this design removes is *unnamed* fragments, not unceremoniously
named ones.

**Deletion.** Deleting a `DataGraph` whose versions are pinned is **refused**,
with a "used by" list naming the argument sets (and through them, the tests)
that pin it. This is the rule any pinned entity needs; graphs just get there
first because they are the first entity minted from a call.

**Old versions are left alone.** A set saved before this rule is a saved
version, and a saved version is immutable: it keeps running against the copy it
embedded. `contentString` / `contentFormat` on `ArgumentGraphBinding` are still
read and never written.

## Tuple set column names are labels

A tuple set fills a rule set's `TUPLE(…)` declarations. Matching is
**positional** — arity plus any ground terms in the declaration — and column
names are ignored, exactly as rule-to-rule tuple flow works.

A `TupleSetVersion` carries `columns` and keeps carrying them, because names are
genuinely useful for reading a table, diffing two versions, surviving a CSV
import, and pre-filling a conversion. They are simply **labels**, not
identifiers, and the page says so where the labels are edited.

- **Never make a label load-bearing.** No matching, no verdict and no execution
  path reads `columns`. A label that quietly acquires meaning is worse than no
  label, because it teaches a rule that only holds sometimes.
- **The bind-time notice is the only place names have any consequence**, and the
  consequence is a sentence: arity mismatch is an error; an info line notes that
  matching is positional and the labels are ignored; it escalates to a warning
  only when labels exist and **collide** — the set's columns read `y | x`
  against a declaration reading `?x ?y` — because that is exactly where someone
  believes name-matching is happening.

## Conversions between the two table shapes

Both shapes are SPARQL Results JSON, so each direction is a projection plus one
question. Both are explicit, user-invoked, and record `copiedFrom` where a new
entity is created, so "used by" can be answered loosely without pins.

**Tuple set → argument table.** The dialog asks for the variable name each
column fills, pre-filled from the tuple set's labels and marked as unverified —
they are labels, so a pre-fill is a guess, and the person confirms it. The
existing `fits / partial / mismatch` verdict judges the result. Second question,
easy to forget: a rule-set table may lead with a ground term
(`TUPLE(:seed, ?x, ?y)`), so **strip the leading fixed column** is offered.

**Argument table → tuple set.** The names are kept — as labels. The honest
warning is not "we will drop your names" but that rule sets match by arity and
position, the names are kept so you can read the table, and they are never used
when it fills a `TUPLE(…)`. And the mirror question: **prepend a fixed IRI**,
for a declaration that leads with a ground term.

Neither direction is a link. A conversion is a copy, taken once, and the two
entities go their own ways afterwards — which is the whole reason this is safe
where a save-time side effect was not.

## What the rail shows: origin, not tags

Graphs minted from a call appear in Graphs automatically — not because a side
effect pushed them there, but because they *are* graphs. What was missing was
the ability to tell at a glance where something came from.

The section sidebar's grouping control offers a third mode, **Origin**, in
Graphs and in Argument sets:

- *Composed here* — made with `+ New` on the rail.
- *From queries* / *From groups* — born on a callable's screen, read off
  `targetEntity` for an argument set, and off `DataGraph.mintedFrom` for a graph.

Bucket by kind of origin, not one cluster per callable, or a real library
shatters into dozens of single-row clusters. The callable stays in the subtitle.

**Not tags.** Tags are user-authored and library-wide. Auto-tagging by
provenance makes a tag mean both *I decided this* and *the system asserted
this*, which destroys the one job tags do well. Origin is how you **find**
things; tags are how you **mean** things.

And origin is deliberately a weak organiser: a set made on one query is
legitimately what another wants, and a graph minted from a group is an ordinary
graph the moment it exists. Scope is provenance, not a fence — which is why the
argument set switcher computes a fits/partial/mismatch verdict at all.

## One browser-local draft store, keyed by section

Unsaved argument sets used to live in a store of their own, kept separate so
that argument sets would stay out of the nav rail. That reason was retired the
day an argument set became a rail entity, and the split outlived it: the query
screen wrote to one key and the rail read another, so a set made on a query
never reached the rail in that session, appeared after a reload — which made a
missing write read as a caching glitch — and could lose its edits to the next
one.

There is one browser-local draft store, keyed by section
(`useCallableDrafts`), and `useArgumentSetDrafts` is a view over its
`argumentSet` section rather than a second store.

## Still open

- **Does a test pin survive minting?** Saving a set that carries pasted RDF
  writes a graph and rewrites the binding. Saved versions are immutable, so this
  produces a **new** argument set version, and a test pinned to the old one
  keeps running against the embedded copy until it is repinned. Old versions are
  currently left alone; whether they are ever migrated is undecided.
- **Ad-hoc runs and the size ceiling.** Running is not saving, so a big pasted
  graph can be executed repeatedly without ever becoming an entity. That is
  correct, and it means the "this call carries 40 MB of RDF, save it as a graph"
  nudge belongs on the run path, not only on save.
- **`argumentSignature.ts` ignores `graphBindings`.** A graph-carrying set
  offered to a query returns `fits` rather than `partial` with *This set's
  graphs are not used by a query*. The run is correct — a query drops them — but
  once graphs are visible entities the silence starts generating questions.
- **`immutable` outlived the freeze vocabulary.** The flag carries no
  information now that versions are created frozen.
