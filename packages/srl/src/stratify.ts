import type { SrlBodyItem, SrlRule, SrlTuple } from './ast.js';

/**
 * Rule stratification for SRL.
 *
 * Algorithm ported from the app's previous `RuleStratifier` (which walked the
 * vendored sparqljs AST) and retargeted to the SRL/Traqula AST. Aggregation is
 * intentionally dropped — this project does not support it — so monotonicity is
 * just `monotone | negation`.
 *
 * A rule R depends on rule S when a body triple pattern of R can match a head
 * triple template of S. The dependency is *negative* when it occurs under a
 * `NOT`, and *closed* when R is a run-once rule (see `runOnce` below). Both
 * kinds demand a strictly higher stratum, so a rule set is non-stratifiable iff
 * a dependency cycle contains a negative or a closed edge.
 */

export type MonotonicityKind = 'monotone' | 'negation';
/**
 * `closed` is the spec's promotion of an ordinary (positive) dependency for a
 * run-once rule: the rule sees its dependencies only once, so they must be
 * *complete* first — exactly the ordering `negative` demands.
 */
export type DependencyLabel = 'positive' | 'negative' | 'closed';
export interface TripleSummary {
  subject: string;
  predicate: string;
  object: string;
}
export interface StratificationEdge {
  from: string;
  to: string;
  label: DependencyLabel;
  reasons: Array<{ body: TripleSummary; head: TripleSummary; label: DependencyLabel }>;
}
/**
 * One strongly connected group of rules that cannot be layered: a dependency
 * cycle through a `negative` edge, or through a run-once rule.
 *
 * Reported as data, not only as an issue string, so a client can point at the
 * rules and the dependencies involved without parsing prose.
 */
export interface StratificationCycle {
  /** The rules in the cycle, in the order they were given to `stratify`. */
  rules: string[];
  /**
   * Every dependency between two rules of the cycle. The `negative` and
   * `closed` ones are what make it illegal; breaking any one of those (or
   * any positive link that closes the loop) is what makes it stratify.
   */
  edges: StratificationEdge[];
  /** `negation`: a `NOT` sits on the cycle. `run-once`: a run-once rule does. */
  kind: 'negation' | 'run-once';
  /** For a `run-once` cycle, which rules are run-once and why. */
  runOnce?: Array<{ rule: string; reasons: string[] }>;
}
export interface StratificationReport {
  /**
   * Rule id to layer, from 0. **Empty when the rules do not stratify**: a
   * non-stratifiable document has no layering, and any numbers left over are
   * only wherever the layering gave up.
   */
  strata: Record<string, number>;
  edges: StratificationEdge[];
  monotonicity: Record<string, MonotonicityKind>;
  /**
   * Rules the evaluator must run **exactly once** per execution (the spec's
   * `SL.once`), rather than iterating them to a fixpoint. True for a rule whose
   * head mints a blank node or whose body has an assignment (`SET`): re-firing
   * either yields a fresh answer every pass, so there is no fixpoint to reach.
   * Every rule appears here; the flag is false for ordinary rules.
   */
  runOnce: Record<string, boolean>;
  issues: string[];
  /** The cycles that stop the rules stratifying; empty when they do. */
  cycles: StratificationCycle[];
}

type Term = { type?: string; subType?: string; value?: unknown; prefix?: string } | undefined;
type Triple = { subject: Term; predicate: Term; object: Term };
type BodyDep = { triple: Triple; label: DependencyLabel };
/** A tuple read/write: terms in slot order. Arity is `terms.length`. */
type TupleDep = { terms: Term[]; label: DependencyLabel };

export function stratify(rules: Array<{ id: string; ast: SrlRule }>): StratificationReport {
  const monotonicity: Record<string, MonotonicityKind> = {};
  const heads = new Map<string, Triple[]>();
  const bodies = new Map<string, BodyDep[]>();
  const tupleHeads = new Map<string, TupleDep[]>();
  const tupleBodies = new Map<string, TupleDep[]>();

  for (const { id, ast } of rules) {
    monotonicity[id] = hasNegation(ast.body) ? 'negation' : 'monotone';
    heads.set(id, headTriples(ast.head));
    // A `WHERE DATA` rule matches the ground graph throughout, so it reads
    // nothing any rule produces and depends on no rule at all. Its body is not
    // walked rather than walked-and-discarded, so that a nested `NOT` inside it
    // cannot contribute an edge either.
    bodies.set(id, ast.data ? [] : bodyDeps(ast.body, 'positive'));
    tupleHeads.set(id, (ast.headTuples ?? []).map((t) => tupleDep(t, 'positive')));
    tupleBodies.set(id, ast.data ? [] : tupleBodyDeps(ast.body, 'positive'));
  }

  // A rule that mints a blank node or assigns a value produces a *fresh* answer
  // on every firing, so iterating it has no fixpoint: it must be evaluated
  // exactly once (`SL.once`), after everything it reads is complete. The spec
  // gets that ordering by promoting all such a rule's body dependencies to
  // "closed" — the same treatment `NOT` gets — which also makes a cycle through
  // one of these rules non-stratifiable, exactly as it must be.
  const runOnceReasons = new Map<string, string[]>();
  for (const { id, ast } of rules) {
    const reasons: string[] = [];
    if (headHasBlankNode(ast.head)) reasons.push('blank-node head');
    if (hasAssignment(ast.body)) reasons.push('assignment (SET)');
    if (reasons.length > 0) runOnceReasons.set(id, reasons);
  }

  const ids = rules.map((r) => r.id);
  const edges = buildEdges(ids, heads, bodies, tupleHeads, tupleBodies, new Set(runOnceReasons.keys()));
  const { layers, issues, cycles } = assignStrata(ids, edges, runOnceReasons);

  const runOnce: Record<string, boolean> = {};
  for (const id of ids) runOnce[id] = runOnceReasons.has(id);

  // No layering exists for a non-stratifiable document. The partial layers the
  // relaxation reached before giving up depend on the iteration cap and on edge
  // order, so they are withheld rather than reported as if they meant anything.
  const strata = issues.length > 0 ? {} : layers;
  return { strata, edges, monotonicity, runOnce, issues, cycles };
}

function headHasBlankNode(head: unknown): boolean {
  return headTriples(head).some((t) =>
    (['subject', 'predicate', 'object'] as const).some((k) => {
      const term = t[k] as Term;
      return term?.type === 'term' && term?.subType === 'blankNode';
    }),
  );
}

function hasNegation(items: SrlBodyItem[]): boolean {
  // A `NOT` at any level implies negation; a nested NOT can only exist inside a
  // top-level NOT, so checking for any `not` item here suffices.
  return items.some((it) => it.kind === 'not');
}

/** A `SET` anywhere in the body — including inside a `NOT` — is an assignment. */
function hasAssignment(items: SrlBodyItem[]): boolean {
  return items.some((it) => (it.kind === 'not' ? hasAssignment(it.body) : it.kind === 'set'));
}

function headTriples(head: unknown): Triple[] {
  const triples = (head as any)?.triples;
  return Array.isArray(triples) ? triples : [];
}

function bodyDeps(items: SrlBodyItem[], label: DependencyLabel): BodyDep[] {
  const deps: BodyDep[] = [];
  for (const item of items) {
    if (item.kind === 'bgp') {
      const triples = (item.triples as any)?.triples;
      if (Array.isArray(triples)) for (const t of triples) deps.push({ triple: t, label });
    } else if (item.kind === 'not') {
      // `NOT DATA` matches the ground graph, which no rule can add to — so it
      // is a dependency on *nothing*, not a negative dependency on whoever
      // derives the predicate.
      //
      // This is what makes the spec's own default-value example legal. A rule
      // deriving `:distanceKilometers` under `NOT DATA { ?x :distanceKilometers
      // ?km }` would otherwise be a negative self-dependency — a
      // non-stratifiable cycle — when in fact it reads only the input and
      // converges in one pass.
      if (item.data) continue;
      // Anything under an ordinary NOT is a negative dependency (negation as failure).
      deps.push(...bodyDeps(item.body, 'negative'));
    }
    // 'filter' / 'set' contribute no inter-rule triple dependencies.
  }
  return deps;
}

function tupleDep(tuple: SrlTuple, label: DependencyLabel): TupleDep {
  return { terms: tuple.terms as Term[], label };
}

/** Collect tuple reads from a body; anything under NOT is a negative dependency. */
function tupleBodyDeps(items: SrlBodyItem[], label: DependencyLabel): TupleDep[] {
  const deps: TupleDep[] = [];
  for (const item of items) {
    if (item.kind === 'tuple') deps.push(tupleDep(item.tuple, label));
    // `NOT DATA` reads the ground graph, which holds no tuples and which no
    // rule writes — same reasoning as the triple case in `bodyDeps`.
    else if (item.kind === 'not' && !item.data) deps.push(...tupleBodyDeps(item.body, 'negative'));
  }
  return deps;
}

/**
 * Tuples match when arity is equal and every slot unifies. There is no relation
 * name: a constant slot narrows the match, a variable slot matches anything — so
 * `TUPLE(?any, ?x, ?y)` depends on *every* 3-tuple writer. That is deliberately
 * conservative (coarser strata, never unsound); putting an identifying IRI in
 * slot 0 is what keeps the dependency graph tight.
 */
function tupleMatches(read: TupleDep, write: TupleDep): boolean {
  if (read.terms.length !== write.terms.length) return false;
  return read.terms.every((t, i) => termEquals(t, write.terms[i]));
}

function summarizeTuple(dep: TupleDep): TripleSummary {
  const rendered = dep.terms.map((t) => formatTerm(t)).join(', ');
  return { subject: `TUPLE/${dep.terms.length}`, predicate: '', object: rendered };
}

function isVar(t: Term): boolean {
  return t?.type === 'term' && t?.subType === 'variable';
}

function termEquals(a: Term, b: Term): boolean {
  if (isVar(a) || isVar(b)) return true;
  if (!a || !b) return false;
  return a.subType === b.subType && a.value === b.value && (a.prefix ?? '') === (b.prefix ?? '');
}

function tripleMatches(body: Triple, head: Triple): boolean {
  return (
    termEquals(body.subject, head.subject) &&
    termEquals(body.predicate, head.predicate) &&
    termEquals(body.object, head.object)
  );
}

function summarize(t: Triple): TripleSummary {
  return { subject: formatTerm(t.subject), predicate: formatTerm(t.predicate), object: formatTerm(t.object) };
}

const XSD = 'http://www.w3.org/2001/XMLSchema#';
/** Datatypes SPARQL writes bare, so a summary shows `3` rather than a typed string. */
const BARE_DATATYPES = new Set([`${XSD}integer`, `${XSD}decimal`, `${XSD}double`, `${XSD}boolean`]);

function formatTerm(t: Term): string {
  if (!t) return '';
  if (t.subType === 'variable') return `?${String(t.value ?? '')}`;
  if (t.subType === 'literal') {
    // Quoted as written, so `"ABC"` is not mistaken for a name.
    const value = String(t.value ?? '');
    const tag = (t as { langOrIri?: unknown }).langOrIri;
    if (typeof tag === 'string' && tag) return `${JSON.stringify(value)}@${tag}`;
    if (tag && typeof tag === 'object') {
      const datatype = tag as Term;
      if (!datatype?.prefix && BARE_DATATYPES.has(String(datatype?.value ?? ''))) return value;
      if (String(datatype?.value ?? '') !== `${XSD}string`) return `${JSON.stringify(value)}^^${formatTerm(datatype)}`;
    }
    return JSON.stringify(value);
  }
  if (t.subType === 'namedNode') return typeof t.prefix === 'string' ? `${t.prefix}:${String(t.value ?? '')}` : `<${String(t.value ?? '')}>`;
  return String(t.value ?? '');
}

function buildEdges(
  ids: string[],
  heads: Map<string, Triple[]>,
  bodies: Map<string, BodyDep[]>,
  tupleHeads: Map<string, TupleDep[]> = new Map(),
  tupleBodies: Map<string, TupleDep[]> = new Map(),
  runOnce: Set<string> = new Set(),
): StratificationEdge[] {
  const edges: StratificationEdge[] = [];
  for (const from of ids) {
    for (const to of ids) {
      const reasons: StratificationEdge['reasons'] = [];
      let label: DependencyLabel = 'positive';
      for (const dep of bodies.get(from) ?? []) {
        for (const ht of heads.get(to) ?? []) {
          if (tripleMatches(dep.triple, ht)) {
            reasons.push({ body: summarize(dep.triple), head: summarize(ht), label: dep.label });
            if (dep.label === 'negative') label = 'negative';
          }
        }
      }
      // Tuple dependencies: a reader depends on every same-arity writer whose
      // template unifies with the read pattern.
      for (const dep of tupleBodies.get(from) ?? []) {
        for (const hw of tupleHeads.get(to) ?? []) {
          if (tupleMatches(dep, hw)) {
            reasons.push({ body: summarizeTuple(dep), head: summarizeTuple(hw), label: dep.label });
            if (dep.label === 'negative') label = 'negative';
          }
        }
      }
      if (reasons.length === 0) continue;
      // A run-once rule reads each dependency a single time, so the dependency
      // has to be finished before it fires: its positive edges close.
      if (label === 'positive' && runOnce.has(from)) label = 'closed';
      edges.push({ from, to, label, reasons });
    }
  }
  return edges;
}

function assignStrata(
  ids: string[],
  edges: StratificationEdge[],
  runOnceReasons: Map<string, string[]> = new Map(),
): { layers: Record<string, number>; issues: string[]; cycles: StratificationCycle[] } {
  const layers = new Map<string, number>();
  for (const id of ids) layers.set(id, 0);

  const limit = ids.length + 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      const pLayer = layers.get(edge.from) ?? 0;
      const qLayer = layers.get(edge.to) ?? 0;
      if (edge.label === 'positive') {
        // A rule that reads S's output must not be in an earlier stratum than S.
        if (pLayer < qLayer) {
          layers.set(edge.from, qLayer);
          changed = true;
        }
        continue;
      }
      // Negative or closed dependency: reader must be strictly later, so that
      // what it reads is complete before it runs.
      if (pLayer <= qLayer) {
        const next = qLayer + 1;
        if (next > limit) {
          const { issues, cycles } = detectNonStratifiableCycles(ids, edges, runOnceReasons);
          return {
            layers: toObject(layers),
            issues: issues.length ? issues : ['Stratification error: negative cycle'],
            cycles,
          };
        }
        layers.set(edge.from, next);
        changed = true;
      }
    }
  }

  return { layers: toObject(layers), ...detectNonStratifiableCycles(ids, edges, runOnceReasons) };
}

function detectNonStratifiableCycles(
  ids: string[],
  edges: StratificationEdge[],
  runOnceReasons: Map<string, string[]> = new Map(),
): { issues: string[]; cycles: StratificationCycle[] } {
  const order = new Map(ids.map((id, position) => [id, position]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }

  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Map<string, boolean>();
  const stack: string[] = [];
  const issues: string[] = [];
  const cycles: StratificationCycle[] = [];
  let idx = 0;

  const strongconnect = (v: string): void => {
    index.set(v, idx);
    lowlink.set(v, idx);
    idx += 1;
    stack.push(v);
    onStack.set(v, true);
    for (const w of adj.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.get(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }
    if (lowlink.get(v) === index.get(v)) {
      const component: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.set(w, false);
        component.push(w);
      } while (w !== v);

      const set = new Set(component);
      const hasCycle = component.length > 1 || (adj.get(v) ?? []).includes(v);
      if (!hasCycle) return;
      const rules = [...component].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      const cycleEdges = edges.filter((e) => set.has(e.from) && set.has(e.to));
      const negativeInCycle = cycleEdges.some((e) => e.label === 'negative');
      if (negativeInCycle) {
        issues.push(`Non-stratifiable cycle involving: ${rules.join(', ')}`);
        cycles.push({ rules, edges: cycleEdges, kind: 'negation' });
        return;
      }
      // Even a wholly positive cycle is illegal if it contains a run-once rule:
      // it can only be evaluated after what it reads is complete, and a cycle
      // never lets that happen (each firing would yield a fresh answer).
      const onceInCycle = component.filter((id) => runOnceReasons.has(id));
      if (onceInCycle.length > 0) {
        const described = onceInCycle
          .map((id) => `${id} [${(runOnceReasons.get(id) ?? []).join(', ')}]`)
          .join(', ');
        issues.push(
          `Non-stratifiable cycle involving run-once rule(s): ${described} (cycle: ${rules.join(', ')})`,
        );
        cycles.push({
          rules,
          edges: cycleEdges,
          kind: 'run-once',
          runOnce: rules
            .filter((id) => runOnceReasons.has(id))
            .map((id) => ({ rule: id, reasons: runOnceReasons.get(id) ?? [] })),
        });
      }
    }
  };

  for (const v of ids) if (!index.has(v)) strongconnect(v);
  return { issues, cycles };
}

function toObject(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map) out[k] = v;
  return out;
}
