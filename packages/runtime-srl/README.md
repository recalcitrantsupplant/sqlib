# @sparql-query-lib/runtime-srl

Run a SHACL 1.2 rule set with no server.

`RuleSetRunner` loads the base graph, applies the DATA blocks once, then runs
each stratum of rules to its own fixpoint on an Oxigraph store. It reports
every pass, every rule's effect, and the inference graph: the triples the run
added to the base graph.

```ts
import { compileRule, expandIris, parseRuleSet } from '@sparql-query-lib/srl';
import { RuleSetRunner } from '@sparql-query-lib/runtime-srl';

const set = expandIris(parseRuleSet(srlText));
const rules = set.rules.map((rule, i) => ({
  ruleVersionId: `rule-${i}`,
  program: compileRule(rule, set.prologueText).program,
  source: 'normalized' as const,
  stratum: 0,
}));

const result = await new RuleSetRunner().run(
  {
    id: 'my-rules',
    ruleCount: rules.length,
    dataBlockCount: 0,
    prepareRules: () => rules,
    prepareDataBlocks: () => [],
  },
  { initialGraph: turtle, initialGraphFormat: 'text/turtle', maxIterations: 100 },
);
console.log(result.status, result.finalGraphNQuads);
```

## The host prepares; the runner evaluates

A `RuleSetSource` is what the host knows and the runner does not. Its
`prepareRules` returns the rules already validated, stratified and in run order;
its `prepareDataBlocks` returns the DATA blocks. The runner calls each once, at
the point the run reaches it, and a source refuses the run by throwing. So a
refusal lands at the same moment, with the same result, whichever host runs
the set.

- **The API's source** reads rule and DATA block versions from its entity
  cache, refuses invalid ones, and stratifies with its `RuleStratifier`. It
  also passes its own Oxigraph executor, store and deadline. See
  `packages/api/src/lib/RuleSetExecutor.ts`.
- **The CLI's source** will compile an SRL file or a bundle's rule set, and
  stratify with `srl`'s `stratify`.

## Options

`maxIterations` (passes per stratum, default 5), `timeoutMs` (per rule),
`trace` (record each rule's inserted and deleted quads), `signal`,
`initialGraph` with `initialGraphFormat`, and `inferenceFormat`. `store`,
`executor` and `loadGraph` default to a new store and an executor over it.

## Status

Private to the workspace. It becomes publishable with the command-line tool.
