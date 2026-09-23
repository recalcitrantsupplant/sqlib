import { Parser as SparqlParser } from '@traqula/parser-sparql-1-2';
import type {
  ContextDefinition,
  Expression,
  Pattern,
  PatternBgp,
  PatternFilter,
  QueryConstruct,
  SolutionModifiers,
  SparqlQuery,
} from '@traqula/rules-sparql-1-2';
import type { SrlBodyItem, SrlRule, SrlRuleSet } from './ast.js';
import { expandTerms } from './expand.js';
import { generateRule } from './generate.js';
import { abbreviateIris } from './split.js';
import { boundBy, checkWellFormed, collectVars } from './wellformed.js';

/**
 * SPARQL → SRL rule.
 *
 * The inverse of `compileRule`, in both the flavours it emits: a CONSTRUCT is
 * the inverse of `{ flavour: 'construct' }` and an `INSERT { … } WHERE { … }`
 * the inverse of `{ flavour: 'insert' }`. It exists because the two languages
 * already share their leaves: SRL's grammar builds a rule head out of Traqula's
 * `constructTriples` and a rule body out of `triplesBlock` / `filter` /
 * `expression` (see `grammar.ts`), which is exactly what the stock SPARQL
 * parser produces for either form. So nothing here rewrites an AST — the nodes
 * are moved across as they are, and the whole job is deciding *which* of them
 * are allowed to make the trip.
 *
 * That decision is the point of this module, and it is deliberately strict.
 * Silently dropping a pattern does not produce a rule that fails; it produces a
 * rule that runs and infers the wrong triples. Dropping an OPTIONAL or a FILTER
 * makes it fire too often, dropping a UNION branch makes it fire too rarely,
 * and either way the result lands in the store and propagates through the
 * fixpoint. So an unsupported construct is an error and the import yields no
 * rule at all, rather than a partial one with a comment attached.
 *
 * Three tiers, then:
 *
 *  - **Rewritten silently**, where the two spellings are the same thing:
 *    `FILTER NOT EXISTS` → `NOT`, a conjunctive group flattened into the item
 *    sequence, and `BIND(e AS ?v) FILTER(BOUND(?v))` → `SET (?v := e)` — which
 *    is character-for-character what a SET compiles back out to.
 *    A FILTER (`NOT EXISTS` included) is also moved to the end of its group
 *    when a later pattern binds one of its variables — see `mapPatterns`.
 *  - **Rewritten with a warning**, where the shapes correspond but something is
 *    lost or gained: a bare `BIND`, and `MINUS` over shared variables.
 *  - **Rejected**, everything else, all of it reported at once.
 *
 * The WHERE clause is handled identically for both input forms — it is the same
 * grammar production and the same rule body either way — so the two differ only
 * in how the head is read and in the head-side constructs each can carry
 * (solution modifiers for a CONSTRUCT, DELETE / WITH / USING for an INSERT).
 */

/** Where an issue sits on the accept/reject line. */
export type SparqlImportSeverity = 'error' | 'warning';

export type SparqlImportCode =
  | 'syntax'
  | 'not-importable'
  | 'empty-template'
  | 'dataset-clause'
  | 'solution-modifier'
  | 'unsupported-pattern'
  | 'disjoint-minus'
  | 'bare-bind'
  | 'minus-as-not'
  | 'positive-exists'
  | 'filter-moved'
  | 'well-formedness'
  | 'multiple-operations'
  | 'delete-clause'
  | 'named-graph-target';

/** Which SPARQL form the rule was read out of. */
export type SparqlImportForm = 'construct' | 'insert';

export interface SparqlImportIssue {
  severity: SparqlImportSeverity;
  code: SparqlImportCode;
  /** The SPARQL construct at fault, upper-cased as it is written. */
  construct?: string;
  message: string;
}

/** A PREFIX the imported query declared, for merging into the target prologue. */
export interface SparqlImportPrefix {
  prefix: string;
  namespace: string;
  /** True when the target already binds this label to a *different* namespace. */
  conflicts: boolean;
}

export interface SparqlImportResult {
  /** The rule as SRL text, or null when any issue is an error. */
  rule: string | null;
  /**
   * Which form the rule was read out of, or null when the query is neither a
   * CONSTRUCT nor an `INSERT … WHERE` (including when it did not parse).
   */
  form: SparqlImportForm | null;
  issues: SparqlImportIssue[];
  /** Prefixes the query declared, each flagged if the target disagrees. */
  prefixes: SparqlImportPrefix[];
  /**
   * Whether the rule will be evaluated once rather than to a fixpoint — true
   * when it carries a SET or mints a blank node. Derived here so the caller can
   * say so *before* the rule lands in a document, since run-once also changes
   * how the whole set stratifies (`stratify.ts`).
   */
  runOnce: boolean;
}

export interface SparqlImportOptions {
  /**
   * The prologue of the document being imported *into*. Terms are expanded
   * against the query's own prefixes and re-abbreviated against these, so a
   * label the two documents spell differently resolves to the query's IRI and
   * comes out under whatever the target calls it — the target wins every
   * conflict without anything here comparing the two.
   */
  targetPrologue?: string;
  /** `RULE <iri>` name for the generated rule. Unnamed when absent. */
  name?: string;
}

/**
 * The revision of the accept/reject decision below.
 *
 * Persisted alongside the importability flag on a query version
 * (`QueryVersionSchema.srlImportRevision`), because that flag is computed once
 * when an immutable version is written and this module keeps changing under it:
 * loosening the whitelist — as adding the INSERT form just did — turns stored
 * `false`s into lies. Recording which revision decided lets a reader tell a
 * current verdict from a stale one without re-parsing anything, and lets a
 * backfill find exactly the versions that need recomputing.
 *
 * **Bump this whenever the set of queries that convert changes.**
 *
 *  - 1: CONSTRUCT only.
 *  - 2: `INSERT { … } WHERE { … }` accepted alongside CONSTRUCT.
 *  - 3: a FILTER written before the pattern that binds its variables is moved
 *    after it rather than rejected as use-before-bind.
 */
export const SRL_IMPORT_REVISION = 3;

const parser = new SparqlParser();

/**
 * Convert a CONSTRUCT or `INSERT … WHERE` query into an SRL rule.
 *
 * The result is a verdict, not a throw: an unconvertible query comes back with
 * `rule: null` and every reason it was rejected, because the caller is a dialog
 * that has to render them.
 */
export function sparqlToRule(query: string, options: SparqlImportOptions = {}): SparqlImportResult {
  const issues: SparqlImportIssue[] = [];
  const reject = (form: SparqlImportForm | null = null): SparqlImportResult =>
    ({ rule: null, form, issues, prefixes: [], runOnce: false });

  let ast: SparqlQuery;
  try {
    ast = parser.parse(query);
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'syntax',
      message: error instanceof Error ? error.message : 'The query could not be parsed',
    });
    return reject();
  }

  if (ast.type === 'update') return fromUpdate(ast as UpdateDocument, options, issues);
  if (isConstruct(ast)) return fromConstructQuery(ast, options, issues);

  issues.push({
    severity: 'error',
    code: 'not-importable',
    construct: describeQueryForm(ast),
    message:
      `A rule is built from a CONSTRUCT template or an INSERT … WHERE, and this is ${article(describeQueryForm(ast))}. `
      + 'Rewrite it as a CONSTRUCT that builds the triples the rule should infer.',
  });
  return reject();
}

/**
 * Whether a query converts to a single SRL rule.
 *
 * The cheap form of {@link sparqlToRule} for callers that only need the verdict
 * — the persistence layer computing the stored flag, and anything filtering a
 * list of queries down to the importable ones. Warnings do not count against
 * it: a query that converts with a warning still converts.
 */
export function isSrlImportable(query: string): boolean {
  return sparqlToRule(query).rule !== null;
}

// ---------------------------------------------------------------------------
// The two input forms
// ---------------------------------------------------------------------------

/** What the two forms boil down to once their form-specific parts are checked. */
interface RuleSource {
  form: SparqlImportForm;
  /** The triples the rule infers, in the `triplesBlock` shape the head needs. */
  head: PatternBgp | undefined;
  where: Pattern | undefined;
  /** The prologue the query's own terms resolve against. */
  context: ContextDefinition[];
}

function fromConstructQuery(
  ast: QueryConstruct,
  options: SparqlImportOptions,
  issues: SparqlImportIssue[],
): SparqlImportResult {
  // A rule reads the evaluation graph and nothing else, so a FROM naming a
  // different dataset cannot be honoured — and honouring it silently by
  // ignoring it would change which triples the rule sees.
  if (Array.isArray(ast.datasets?.clauses) && ast.datasets.clauses.length > 0) {
    issues.push({
      severity: 'error',
      code: 'dataset-clause',
      construct: 'FROM',
      message:
        'A rule always reads the graph it is evaluated against, so it cannot carry a FROM / FROM NAMED. '
        + 'Remove the dataset clause.',
    });
  }

  // ORDER/LIMIT/OFFSET describe a result *sequence*; a rule infers a set of
  // triples and fires to a fixpoint, so there is no sequence to bound.
  for (const modifier of describeModifiers(ast.solutionModifiers)) {
    issues.push({
      severity: 'error',
      code: 'solution-modifier',
      construct: modifier,
      message:
        `A rule infers a set of triples rather than an ordered, bounded result, so ${modifier} has no meaning here. `
        + 'Remove it.',
    });
  }

  return assemble(
    { form: 'construct', head: ast.template, where: ast.where, context: ast.context },
    options,
    issues,
  );
}

/**
 * `INSERT { … } WHERE { … }` — the one update form a rule can be read out of.
 *
 * A rule is monotone by construction: it adds the triples its head names and
 * takes nothing away, it is evaluated against a single graph, and it is one
 * rule rather than a sequence. So of the eleven SPARQL update forms only
 * `modify` can round-trip, and only the half of it that has no DELETE.
 */
function fromUpdate(
  ast: UpdateDocument,
  options: SparqlImportOptions,
  issues: SparqlImportIssue[],
): SparqlImportResult {
  const updates = Array.isArray(ast.updates) ? ast.updates : [];
  const reject = (): SparqlImportResult => ({ rule: null, form: null, issues, prefixes: [], runOnce: false });

  if (updates.length === 0) {
    issues.push({
      severity: 'error',
      code: 'not-importable',
      construct: 'SPARQL UPDATE',
      message: 'The update contains no operations, so there is nothing for a rule to infer.',
    });
    return reject();
  }

  if (updates.length > 1) {
    // A rule set is not a script: its rules all fire together, to a fixpoint,
    // in whatever order stratification puts them. Taking the first operation
    // would drop the rest, and taking them all would invent an ordering the
    // rule set cannot honour.
    issues.push({
      severity: 'error',
      code: 'multiple-operations',
      construct: ';',
      message:
        `This is a sequence of ${updates.length} update operations, and a rule is one inference. `
        + 'Import each INSERT … WHERE separately — rules in a set fire together to a fixpoint rather than in '
        + 'the order they are written, so a sequence that depends on its order will not survive the trip.',
    });
    return reject();
  }

  const entry = updates[0];
  const operation = entry?.operation;
  if (operation?.subType !== 'modify') {
    const name = describeUpdateOperation(operation?.subType);
    issues.push({
      severity: 'error',
      code: 'not-importable',
      construct: name,
      message:
        `A rule is built from a CONSTRUCT template or an INSERT … WHERE, and this is ${article(name)}. `
        + (operation?.subType === 'insertdata'
          ? 'Ground triples belong in a DATA { … } block rather than a rule.'
          : 'Rewrite it as an INSERT { … } WHERE { … } naming the triples the rule should infer.'),
    });
    return reject();
  }

  // A rule only adds triples. There is no retraction in SRL, and dropping the
  // DELETE would turn a query that rewrites data into one that duplicates it.
  if (Array.isArray(operation.delete) && operation.delete.length > 0) {
    issues.push({
      severity: 'error',
      code: 'delete-clause',
      construct: 'DELETE',
      message:
        'A rule only ever adds triples — SRL has no retraction — so a DELETE cannot be carried across. '
        + 'Import the INSERT half on its own if the deletion is not what the rule is for.',
    });
  }

  // WITH and USING both redirect which graph the operation reads or writes,
  // and a rule is evaluated against exactly one graph: the one it is run on.
  if (operation.graph) {
    issues.push({
      severity: 'error',
      code: 'named-graph-target',
      construct: 'WITH',
      message:
        'A rule is evaluated against the graph it is run on and cannot name another, so it cannot carry a WITH. '
        + 'Remove the clause.',
    });
  }
  if (Array.isArray(operation.from?.clauses) && operation.from.clauses.length > 0) {
    issues.push({
      severity: 'error',
      code: 'dataset-clause',
      construct: 'USING',
      message:
        'A rule always reads the graph it is evaluated against, so it cannot carry a USING / USING NAMED. '
        + 'Remove the dataset clause.',
    });
  }

  return assemble(
    {
      form: 'insert',
      head: insertTemplate(operation.insert, issues),
      where: operation.where,
      // A prologue in an update document is scoped to the operation it precedes,
      // so the context sits on the entry rather than at the top level.
      context: Array.isArray(entry.context) ? entry.context : [],
    },
    options,
    issues,
  );
}

/**
 * The INSERT template as one triples block.
 *
 * Traqula hands back a list of quad patterns rather than a single block,
 * because `INSERT { … GRAPH <g> { … } … }` is legal. A rule head is a triples
 * block, so the plain entries are concatenated and a GRAPH entry is rejected
 * for the same reason WITH is.
 */
function insertTemplate(entries: InsertEntry[] | undefined, issues: SparqlImportIssue[]): PatternBgp | undefined {
  const triples: unknown[] = [];
  let template: PatternBgp | undefined;

  for (const entry of Array.isArray(entries) ? entries : []) {
    if ((entry as { type?: string })?.type === 'graph') {
      issues.push({
        severity: 'error',
        code: 'named-graph-target',
        construct: 'GRAPH',
        message:
          'A rule writes into the graph it is evaluated against and cannot name another, so the template cannot '
          + 'contain a GRAPH block. Remove it and the rule will infer into the evaluation graph.',
      });
      continue;
    }
    const bgp = entry as PatternBgp;
    if (!template) template = bgp;
    if (Array.isArray(bgp?.triples)) triples.push(...bgp.triples);
  }

  if (!template) return undefined;
  // Reuse the first block's node so the head keeps whatever else Traqula hung
  // on it, with every entry's triples merged into one sequence.
  return { ...template, triples } as PatternBgp;
}

// ---------------------------------------------------------------------------
// The shared half: head, body, prefixes, generation
// ---------------------------------------------------------------------------

function assemble(
  source: RuleSource,
  options: SparqlImportOptions,
  issues: SparqlImportIssue[],
): SparqlImportResult {
  const prefixes = collectPrefixes(source.context, options.targetPrologue ?? '');
  const templateTriples = Array.isArray(source.head?.triples) ? source.head.triples : [];
  if (templateTriples.length === 0) {
    issues.push({
      severity: 'error',
      code: 'empty-template',
      message: source.form === 'construct'
        ? 'The CONSTRUCT template is empty, so there is nothing for the rule to infer.'
        : 'The INSERT template is empty, so there is nothing for the rule to infer.',
    });
  }

  const body = mapPatterns(collectPatterns(source.where), issues);

  if (issues.some((issue) => issue.severity === 'error')) {
    return { rule: null, form: source.form, issues, prefixes, runOnce: false };
  }

  const rule: SrlRule = {
    name: options.name,
    head: source.head,
    headTuples: [],
    body,
    headText: '',
    bodyText: '',
    startOffset: 0,
    span: [0, 0],
  };

  /*
   * Expand against the query's prefixes, generate (which emits full IRIs), then
   * re-abbreviate against the target's. The conflict rule the caller asked for
   * — target wins — is not implemented anywhere; it is what this round trip
   * does on its own.
   */
  expandTerms(rule.head, source.context);
  for (const item of rule.body) expandTerms(item, source.context);

  const ruleSet: SrlRuleSet = { prologue: source.context, prologueText: '', rules: [rule], dataBlocks: [] };
  for (const issue of checkWellFormed(ruleSet)) {
    issues.push({
      severity: 'error',
      code: 'well-formedness',
      message:
        issue.category === 'use-before-bind'
          ? `${issue.message} SPARQL scopes a FILTER to its whole group, but SRL evaluates a rule body in `
            + 'order, so the pattern that binds the variable has to come first. Move it up in the query.'
          : issue.message,
    });
  }

  if (issues.some((issue) => issue.severity === 'error')) {
    return { rule: null, form: source.form, issues, prefixes, runOnce: false };
  }

  const text = abbreviateIris(generateRule(rule), options.targetPrologue ?? '');
  return {
    rule: text,
    form: source.form,
    issues,
    prefixes,
    runOnce: headHasBlankNode(source.head) || bodyHasSet(body),
  };
}

// ---------------------------------------------------------------------------
// Pattern mapping
// ---------------------------------------------------------------------------

/** The patterns of a WHERE clause, which is itself a group. */
function collectPatterns(where: Pattern | undefined): Pattern[] {
  if (!where) return [];
  if (where.subType === 'group') return where.patterns;
  return [where];
}

/**
 * One group's patterns as SRL body items, in SRL's order.
 *
 * Order is where the two languages part. A SPARQL FILTER — `FILTER NOT EXISTS`
 * included — applies to its whole group wherever it is written, while an SRL
 * FILTER or NOT is checked against the bindings made *before* it. So a filter
 * written ahead of the pattern that binds one of its variables cannot stay
 * where it is: as an SRL `FILTER` it is ill-formed, and as an SRL `NOT` it is
 * worse — well-formed, but a different rule, because the variable is free
 * inside the negation and the check becomes "does this match anywhere at all".
 * Moving such a filter to the end of its group gives it the same view SPARQL
 * does. BIND and MINUS are positional in SPARQL too, so they stay put.
 */
function mapPatterns(patterns: Pattern[], issues: SparqlImportIssue[]): SrlBodyItem[] {
  const items: SrlBodyItem[] = [];
  // Items that came from a FILTER of *this* group, and so are group-scoped.
  const scoped = new Set<SrlBodyItem>();

  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];
    switch (pattern?.subType) {
      case 'bgp':
        items.push({ kind: 'bgp', triples: pattern });
        break;

      case 'filter': {
        const negated = negatedPattern(pattern);
        if (negated) {
          const item: SrlBodyItem = { kind: 'not', body: mapPatterns(collectPatterns(negated), issues) };
          items.push(item);
          scoped.add(item);
          break;
        }
        if (isPatternOperation(pattern.expression, 'exists')) {
          /*
           * `FILTER EXISTS` parses as an SRL filter and compiles correctly,
           * because SRL's filter rule is Traqula's — but whether positive
           * EXISTS is inside the SRL profile is a question the grammar does not
           * answer. Passing it through with a warning beats rejecting a query
           * the toolchain handles, and beats accepting it in silence.
           */
          issues.push({
            severity: 'warning',
            code: 'positive-exists',
            construct: 'FILTER EXISTS',
            message:
              'FILTER EXISTS is kept as written and compiles correctly, but it is not clearly part of the SRL '
              + 'profile — another SRL implementation may reject the rule.',
          });
        }
        const item: SrlBodyItem = { kind: 'filter', filter: pattern };
        items.push(item);
        scoped.add(item);
        break;
      }

      case 'bind': {
        const variable = String(pattern.variable?.value ?? '');
        /*
         * A SET compiles to exactly `BIND(e AS ?v) FILTER(BOUND(?v))`
         * (`compile.ts`), so consuming that pair is the exact inverse and needs
         * no warning. A bare BIND is not the same thing, and the difference is
         * worth two sentences rather than a footnote — see below.
         */
        if (isBoundCheck(patterns[index + 1], variable)) {
          index += 1;
        } else {
          issues.push({
            severity: 'warning',
            code: 'bare-bind',
            construct: 'BIND',
            message:
              `BIND(… AS ?${variable}) becomes SET (?${variable} := …), which is BIND plus FILTER(BOUND(?${variable})): `
              + `SRL has no unfiltered assignment, so where SPARQL keeps a solution with ?${variable} unbound if the `
              + 'expression errors, the rule drops that solution instead. A rule carrying a SET is also evaluated '
              + 'once rather than to a fixpoint, which can change how the whole set stratifies.',
          });
        }
        items.push({ kind: 'set', variable, expr: pattern.expression });
        break;
      }

      case 'minus': {
        const inner = pattern.patterns;
        const outerVars = new Set<string>();
        for (const item of items) collectVariables(item, outerVars);
        const innerVars = new Set<string>();
        collectVariables(pattern, innerVars);
        const shared = [...innerVars].filter((name) => outerVars.has(name));
        if (shared.length === 0) {
          /*
           * The spec's own example of where the two differ: with no shared
           * variable MINUS removes nothing at all, while NOT EXISTS removes
           * every solution as soon as the inner pattern matches once. There is
           * no warning strong enough for a rewrite that can empty the result.
           */
          issues.push({
            severity: 'error',
            code: 'disjoint-minus',
            construct: 'MINUS',
            message:
              'This MINUS shares no variable with the patterns before it. SRL has only NOT, and over disjoint '
              + 'variables the two are opposites — MINUS removes nothing, NOT removes everything the inner pattern '
              + 'matches. Rewrite it as FILTER NOT EXISTS if that is what you meant.',
          });
          break;
        }
        issues.push({
          severity: 'warning',
          code: 'minus-as-not',
          construct: 'MINUS',
          message:
            `MINUS becomes NOT { … } (negation as failure), joined on ${shared.map((v) => `?${v}`).join(', ')}. `
            + 'The two agree here, but they are not the same operator — check the rule if the negated pattern binds '
            + 'variables the rest of the body also uses.',
        });
        items.push({ kind: 'not', body: mapPatterns(inner, issues) });
        break;
      }

      case 'group':
        /*
         * Flattening a group is sound while everything in it is a join: the
         * join is associative and a FILTER constrains the same solutions from
         * either side of the brace. The cases where it is *not* sound all
         * contain an OPTIONAL or a UNION, which are rejected in their own
         * right, so nothing unsound survives this.
         */
        items.push(...mapPatterns(collectPatterns(pattern), issues));
        break;

      default:
        issues.push(unsupported(pattern));
        break;
    }
  }

  return moveScopedFilters(items, scoped, issues);
}

/** Move each group-scoped filter that a later item binds for to the end. */
function moveScopedFilters(
  items: SrlBodyItem[],
  scoped: Set<SrlBodyItem>,
  issues: SparqlImportIssue[],
): SrlBodyItem[] {
  const kept: SrlBodyItem[] = [];
  const moved: SrlBodyItem[] = [];
  const bound = new Set<string>();
  items.forEach((item, index) => {
    if (scoped.has(item)) {
      const mentioned = new Set<string>();
      collectVars(item.kind === 'not' ? item.body : (item as { filter: unknown }).filter, mentioned);
      const later = new Set(items.slice(index + 1).flatMap((next) => boundBy(next)));
      const early = [...mentioned].filter((name) => !bound.has(name) && later.has(name));
      if (early.length > 0) {
        moved.push(item);
        const construct = item.kind === 'not' ? 'FILTER NOT EXISTS' : 'FILTER';
        const vars = early.map((name) => `?${name}`).join(', ');
        issues.push({
          severity: 'warning',
          code: 'filter-moved',
          construct,
          message:
            `${construct} is written before the pattern that binds ${vars}. SPARQL applies a FILTER to its whole `
            + 'group, but SRL checks it only against what is bound before it, so it has been moved to the end of '
            + 'the rule body to keep the same meaning.'
            + (item.kind === 'not'
              ? ` Left in place, the NOT would treat ${vars} as free and test whether the pattern matches anywhere `
                + 'at all.'
              : ''),
        });
        return;
      }
    }
    kept.push(item);
    for (const name of boundBy(item)) bound.add(name);
  });
  return [...kept, ...moved];
}

/** Everything a rule body has no spelling for, each with the reason it has none. */
function unsupported(pattern: Pattern | undefined): SparqlImportIssue {
  const advice: Record<string, { construct: string; message: string }> = {
    optional: {
      construct: 'OPTIONAL',
      message:
        'A rule body is a conjunction — every pattern in it must match — so there is no OPTIONAL. Write a second '
        + 'rule for the case where the optional part is present.',
    },
    union: {
      construct: 'UNION',
      message:
        'A rule body is a conjunction, so there is no UNION. Write one rule per branch: they share a head and '
        + 'their inferences add up.',
    },
    values: {
      construct: 'VALUES',
      message:
        'A rule body cannot carry inline data. Ground triples belong in a DATA { … } block, which the rule can then '
        + 'match — but note a DATA block is part of the document\'s ground graph, so every rule sees it.',
    },
    graph: {
      construct: 'GRAPH',
      message:
        'A rule is evaluated against one graph and cannot name another. Remove the GRAPH block.',
    },
    service: {
      construct: 'SERVICE',
      message: 'A rule is evaluated locally against the store and cannot call out to a remote endpoint.',
    },
    query: {
      construct: 'sub-SELECT',
      message:
        'A rule body has no sub-SELECT, and so no aggregation or DISTINCT within it. Compute the aggregate in a '
        + 'query, or restructure the rule so it does not need one.',
    },
  };

  const known = advice[String(pattern?.subType ?? '')];
  if (known) return { severity: 'error', code: 'unsupported-pattern', ...known };
  return {
    severity: 'error',
    code: 'unsupported-pattern',
    construct: String(pattern?.subType ?? 'unknown').toUpperCase(),
    message: `A rule body has no equivalent for this pattern (${String(pattern?.subType ?? 'unknown')}).`,
  };
}

// ---------------------------------------------------------------------------
// Node predicates
// ---------------------------------------------------------------------------

function isPatternOperation(expression: Expression | undefined, operator: string): boolean {
  return expression?.type === 'expression'
    && expression?.subType === 'patternOperation'
    && String(expression?.operator ?? '').toLowerCase() === operator;
}

/** The group a `FILTER NOT EXISTS { … }` negates, or null for any other filter. */
function negatedPattern(pattern: PatternFilter): Pattern | null {
  if (!isPatternOperation(pattern.expression, 'notexists')) return null;
  const expression = pattern.expression as Extract<Expression, { subType: 'patternOperation' }>;
  return expression.args ?? null;
}

/** True for the `FILTER(BOUND(?v))` half of a compiled SET. */
function isBoundCheck(pattern: Pattern | undefined, variable: string): boolean {
  if (pattern?.subType !== 'filter') return false;
  const expression = pattern.expression;
  if (expression?.type !== 'expression' || expression?.subType !== 'operation') return false;
  if (String(expression.operator ?? '').toLowerCase() !== 'bound') return false;
  const args = expression.args;
  if (!Array.isArray(args) || args.length !== 1) return false;
  return args[0]?.subType === 'variable' && String(args[0]?.value ?? '') === variable;
}

function headHasBlankNode(template: unknown): boolean {
  return containsTerm(template, 'blankNode');
}

function bodyHasSet(items: SrlBodyItem[]): boolean {
  return items.some((item) => item.kind === 'set' || (item.kind === 'not' && bodyHasSet(item.body)));
}

function containsTerm(node: unknown, subType: string): boolean {
  if (!node || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  if (record.type === 'term' && record.subType === subType) return true;
  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      if (value.some((entry) => containsTerm(entry, subType))) return true;
    } else if (value && typeof value === 'object') {
      if (containsTerm(value, subType)) return true;
    }
  }
  return false;
}

function collectVariables(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.type === 'term' && record.subType === 'variable') {
    into.add(String(record.value ?? ''));
    return;
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) {
      for (const entry of value) collectVariables(entry, into);
    } else if (value && typeof value === 'object') {
      collectVariables(value, into);
    }
  }
}

// ---------------------------------------------------------------------------
// Query-level reporting
// ---------------------------------------------------------------------------

function describeQueryForm(ast: SparqlQuery | undefined): string {
  if (!ast) return 'not a query';
  if (ast.type === 'update') return 'SPARQL UPDATE';
  switch (ast.subType) {
    case 'select': return 'SELECT';
    case 'ask': return 'ASK';
    case 'describe': return 'DESCRIBE';
    default: return String(ast.subType ?? '').toUpperCase() || 'not a query';
  }
}

/** An update operation named the way the author wrote it, keyword only. */
function describeUpdateOperation(subType: string | undefined): string {
  const names: Record<string, string> = {
    insertdata: 'INSERT DATA',
    deletedata: 'DELETE DATA',
    deletewhere: 'DELETE WHERE',
    load: 'LOAD',
    clear: 'CLEAR',
    create: 'CREATE',
    drop: 'DROP',
    add: 'ADD',
    move: 'MOVE',
    copy: 'COPY',
  };
  return names[String(subType ?? '')] ?? String(subType ?? 'unknown').toUpperCase();
}

/** Narrows a parsed document to one of the forms a rule can be built from. */
function isConstruct(ast: SparqlQuery): ast is QueryConstruct {
  return ast.type === 'query' && ast.subType === 'construct';
}

function article(noun: string): string {
  return /^[AEIOU]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** The solution modifiers present, named as they are written. */
function describeModifiers(modifiers: SolutionModifiers | undefined): string[] {
  const present: string[] = [];
  if (!modifiers || typeof modifiers !== 'object') return present;
  if (modifiers.order) present.push('ORDER BY');
  if (modifiers.limitOffset?.limit !== undefined) present.push('LIMIT');
  if (modifiers.limitOffset?.offset !== undefined) present.push('OFFSET');
  if (modifiers.group) present.push('GROUP BY');
  if (modifiers.having) present.push('HAVING');
  return present;
}

// ---------------------------------------------------------------------------
// Prefixes
// ---------------------------------------------------------------------------

const TARGET_PREFIX = /^\s*PREFIX\s+([^\s:]*):\s*<([^>]*)>/gim;

function collectPrefixes(context: ContextDefinition[], targetPrologue: string): SparqlImportPrefix[] {
  const target = new Map<string, string>();
  for (const match of targetPrologue.matchAll(TARGET_PREFIX)) target.set(match[1], match[2]);

  const prefixes: SparqlImportPrefix[] = [];
  if (!Array.isArray(context)) return prefixes;
  for (const def of context) {
    const node = def as ContextDefinition;
    if (node?.type !== 'contextDef' || node.subType !== 'prefix') continue;
    const prefix = String(node.key ?? '');
    const namespace = String(node.value?.value ?? '');
    const existing = target.get(prefix);
    prefixes.push({ prefix, namespace, conflicts: existing !== undefined && existing !== namespace });
  }
  return prefixes;
}

// ---------------------------------------------------------------------------
// Update AST shapes
// ---------------------------------------------------------------------------

/*
 * Traqula exports its update types only through the parse result's union, and
 * narrowing that union to `modify` costs more than describing the four fields
 * this module reads. These are structural views of the real nodes, not a
 * re-declaration of them: every value here is passed straight back to the
 * generator, which sees the genuine node.
 */

type InsertEntry = PatternBgp | { type: 'graph' };

interface ModifyOperation {
  type: 'updateOperation';
  subType: 'modify';
  insert?: InsertEntry[];
  delete?: unknown[];
  /** The `WITH <g>` target, when there is one. */
  graph?: { value?: string };
  where?: Pattern;
  /** The `USING` clauses. */
  from?: { clauses?: unknown[] };
}

interface UpdateDocument {
  type: 'update';
  updates?: Array<{
    context?: ContextDefinition[];
    operation?: ({ type: 'updateOperation'; subType: string } & Partial<ModifyOperation>);
  }>;
}
