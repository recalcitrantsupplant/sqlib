/**
 * The reserved variables of a graph policy, and whether a policy's text uses
 * each one. The server's rules are in `api/src/auth/graphPolicy.ts`; this is
 * the same list, said for a reader.
 *
 * Outputs are read from the projection (the text before WHERE). Caller slots
 * count only when declared as `VALUES ?x { UNDEF }`: sqlib fills a declared
 * slot and nothing else, so a bare `?authUser` in a pattern is an ordinary,
 * unbound variable.
 */

export type PolicyVariableState = 'used' | 'unused' | 'undeclared';

export interface PolicyVariable {
  name: string;
  kind: 'output' | 'caller';
  /** What sqlib does with it. */
  role: string;
  state: PolicyVariableState;
  /** What its state means for this policy. */
  meaning: string;
}

function projection(text: string): string {
  return text.slice(0, Math.max(0, text.search(/\bWHERE\b|\{/i)));
}

function projects(text: string, name: string): boolean {
  return new RegExp(`\\?${name}\\b`).test(projection(text));
}

function declaresSlot(text: string, name: string): boolean {
  return new RegExp(`VALUES\\s+\\?${name}\\s*\\{\\s*UNDEF\\s*\\}`, 'i').test(text);
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`\\?${name}\\b`).test(text);
}

export function policyVariables(queryText: string): PolicyVariable[] {
  const graph = projects(queryText, 'graph');
  const defaultGraph = projects(queryText, 'defaultGraph');
  const namedGraph = projects(queryText, 'namedGraph');

  function part(name: string, used: boolean, label: string): PolicyVariable {
    return {
      name,
      kind: 'output',
      role: `Each row adds a graph to the ${label}.`,
      state: used ? 'used' : 'unused',
      meaning: used
        ? 'Projected, so the policy fills this part.'
        : graph
          ? 'Not projected. ?graph fills this part.'
          : `Not projected, and no ?graph. Queries get no ${label}.`,
    };
  }

  function caller(name: string, role: string, absent: string): PolicyVariable {
    const declared = declaresSlot(queryText, name);
    return {
      name,
      kind: 'caller',
      role,
      state: declared ? 'used' : mentions(queryText, name) ? 'undeclared' : 'unused',
      meaning: declared
        ? 'Declared, so sqlib fills it on every request.'
        : mentions(queryText, name)
          ? `Used but not declared as VALUES ?${name} { UNDEF }, so sqlib does not fill it.`
          : absent,
    };
  }

  return [
    {
      name: 'graph',
      kind: 'output',
      role: 'Each row adds a graph to both the default graph (FROM) and the named graphs (FROM NAMED).',
      state: graph ? 'used' : 'unused',
      meaning: graph
        ? 'Projected, so the policy fills both parts.'
        : 'Not projected. That is fine when ?defaultGraph or ?namedGraph is.',
    },
    part('defaultGraph', defaultGraph, 'default graph (FROM)'),
    part('namedGraph', namedGraph, 'named graphs (FROM NAMED)'),
    caller('authUser', "sqlib binds it to the caller's user IRI.", 'Not declared. The policy gives every user the same graphs.'),
    caller(
      'authGroup',
      "sqlib binds it to the caller's groups, one row each. No groups means no rows.",
      'Not declared. The policy does not look at groups.',
    ),
  ];
}
