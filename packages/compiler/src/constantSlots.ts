/**
 * Constant parameters: `VALUES ?000word { UNDEF }`.
 *
 * A constant parameter is a VALUES parameter whose one variable starts with
 * `000`. It is filled like any slot, but it takes exactly one bound value, and
 * that value is also written into the triple patterns in the reach of the
 * clause. The filled VALUES row stays, so the variable stays bound and the
 * answers are those of a plain VALUES run. Only the form the engine sees
 * changes: an engine that needs a constant at plan time (QLever text search,
 * `ts:word`) gets one.
 *
 * Reach is the group that holds the VALUES clause, and the groups nested in it
 * through plain groups, `GRAPH` and `SERVICE` bodies and `UNION` branches.
 * Each of these is an inner join with the VALUES row, so a constant in their
 * triple patterns gives the same solutions as the join. Every other occurrence
 * keeps the variable. Those that can make the answer differ from a plain
 * VALUES run are reported as warnings.
 *
 * See `docs/proposals/constant-substitution.md`.
 */

/** The prefix that marks a VALUES parameter as a constant. */
export const CONSTANT_PREFIX = '000';

/** True when a declared variable name marks a constant parameter. */
export function isConstantVariable(name: string): boolean {
  return name.startsWith(CONSTANT_PREFIX);
}

/** One occurrence of a constant parameter that keeps its variable and may change the answer. */
export interface ConstantWarning {
  /** The parameter's variable name, without `?`. */
  parameter: string;
  /** Where the variable occurs, in SPARQL words: `OPTIONAL`, `nested FILTER`, `GRAPH name` and so on. */
  position: string;
}

/** A place in the tree that holds the variable term: `holder[key]` is the term. */
interface Occurrence {
  holder: Record<string | number, unknown>;
  key: string | number;
  action: 'declaration' | 'replace' | 'keep' | 'warn';
  position?: string;
}

/** Any object in the parse tree. The walk is structural, so it reads only these keys. */
interface TreeNode {
  [key: string]: unknown;
  type?: unknown;
  subType?: unknown;
  value?: unknown;
}

interface Step {
  node: TreeNode;
  key: string | number;
}

/**
 * Classify every occurrence of `name` in `root` against the VALUES clause
 * `declaring`.
 *
 * The walk is generic: it visits every object in the tree and records the
 * chain of (node, key) steps to each variable term. The decision then reads
 * that chain, so a node shape the walk does not know is never replaced: it
 * can only make an occurrence `warn` or `keep`.
 */
export function findConstantOccurrences(root: unknown, declaring: object, name: string): Occurrence[] {
  const occurrences: Occurrence[] = [];
  const chain: Step[] = [];

  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as TreeNode;
    if (node.type === 'term' && node.subType === 'variable' && node.value === name) {
      const last = chain[chain.length - 1];
      if (last) occurrences.push({ holder: last.node, key: last.key, ...classify(chain, declaring) });
      return;
    }
    const keys: Array<string | number> = Array.isArray(value) ? value.map((_, index) => index) : Object.keys(node);
    for (const key of keys) {
      if (key === 'loc') continue;
      chain.push({ node, key });
      visit((node as Record<string | number, unknown>)[key]);
      chain.pop();
    }
  };
  visit(root);
  return occurrences;
}

/** The group node whose `patterns` list holds `declaring`, as found in the chain. */
function declaringGroupIndex(chain: Step[], declaring: object): number {
  for (let i = chain.length - 1; i >= 0; i--) {
    const step = chain[i];
    const patterns = step.node.patterns;
    if (step.key === 'patterns' && Array.isArray(patterns) && patterns.includes(declaring)) {
      return i;
    }
  }
  return -1;
}

function classify(chain: Step[], declaring: object): Pick<Occurrence, 'action' | 'position'> {
  if (chain.some((step) => step.node === declaring)) return { action: 'declaration' };

  const groupAt = declaringGroupIndex(chain, declaring);
  if (groupAt === -1) {
    // Outside the group that holds the clause. A projection, a solution
    // modifier or a template reads the variable the VALUES row binds; inside a
    // WHERE clause, the variable is joined outside the reach and keeps its name.
    const nearestQuery = lastIndexWhere(chain, (step) => step.node.type === 'query' || isUpdateOperation(step.node));
    const inWhere = nearestQuery !== -1 && chain[nearestQuery].key === 'where';
    return inWhere ? { action: 'warn', position: 'outside the group of its VALUES clause' } : { action: 'keep' };
  }

  // Walk down from the group that holds the clause.
  let inFilter = false;
  let depth = 0; // pattern nodes passed below the declaring group
  for (let i = groupAt + 1; i < chain.length; i++) {
    const { node, key } = chain[i];
    if (Array.isArray(node)) continue;
    if (node.type === 'pattern') {
      switch (node.subType) {
        case 'group':
        case 'union':
        case 'bgp':
          depth++;
          continue;
        case 'graph':
        case 'service':
          if (key === 'name') return { action: 'warn', position: `${String(node.subType).toUpperCase()} name` };
          depth++;
          continue;
        case 'filter':
          if (depth > 0) return { action: 'warn', position: 'nested FILTER' };
          inFilter = true;
          depth++;
          continue;
        case 'optional':
          return { action: 'warn', position: 'OPTIONAL' };
        case 'minus':
          return { action: 'warn', position: 'MINUS' };
        case 'lateral':
          return { action: 'warn', position: 'LATERAL' };
        case 'bind':
          return { action: 'warn', position: 'BIND' };
        case 'values':
          return { action: 'warn', position: 'another VALUES clause' };
        default:
          return { action: 'warn', position: String(node.subType) };
      }
    }
    if (node.type === 'query') return { action: 'warn', position: 'sub-SELECT' };
    if (node.type === 'expression' && node.subType === 'patternOperation') return { action: 'warn', position: 'EXISTS' };
    if (node.type === 'term' && node.subType === 'triple') return { action: 'warn', position: 'triple term' };
    if (key === 'annotations') return { action: 'warn', position: 'annotation' };
  }

  if (inFilter) return { action: 'keep' };
  const last = chain[chain.length - 1];
  const isTripleTerm = last.node.type === 'triple' && (last.key === 'subject' || last.key === 'predicate' || last.key === 'object');
  return isTripleTerm ? { action: 'replace' } : { action: 'warn', position: 'expression' };
}

function lastIndexWhere(chain: Step[], test: (step: Step) => boolean): number {
  for (let i = chain.length - 1; i >= 0; i--) if (test(chain[i])) return i;
  return -1;
}

/** An UPDATE operation that has a WHERE clause (`DELETE … INSERT … WHERE`). */
function isUpdateOperation(node: TreeNode): boolean {
  return !!node.where && typeof node.where === 'object' && node.type !== 'query'
    && (Array.isArray(node.insert) || Array.isArray(node.delete));
}

/** The warnings for every occurrence of a constant parameter, one per position. */
export function constantWarnings(root: unknown, declaring: object, name: string): ConstantWarning[] {
  const seen = new Set<string>();
  const warnings: ConstantWarning[] = [];
  for (const occurrence of findConstantOccurrences(root, declaring, name)) {
    if (occurrence.action !== 'warn' || !occurrence.position || seen.has(occurrence.position)) continue;
    seen.add(occurrence.position);
    warnings.push({ parameter: name, position: occurrence.position });
  }
  return warnings;
}

/**
 * Write `term` into every triple pattern in the reach of `declaring`.
 *
 * Each written position gets its own copy of the term node, so a later
 * rewrite of one cannot change another.
 */
export function writeConstant(root: unknown, declaring: object, name: string, term: object): number {
  let written = 0;
  for (const occurrence of findConstantOccurrences(root, declaring, name)) {
    if (occurrence.action !== 'replace') continue;
    occurrence.holder[occurrence.key] = structuredClone(term);
    written++;
  }
  return written;
}
