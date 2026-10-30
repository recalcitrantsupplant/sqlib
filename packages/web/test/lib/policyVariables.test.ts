import { describe, it, expect } from 'vitest';
import { policyVariables } from '@/lib/policyVariables';

const EXAMPLE = `PREFIX acl: <https://example.org/acl#>
SELECT DISTINCT ?graph WHERE {
  { ?rule acl:everyone true ; acl:graph ?graph . }
  UNION
  { VALUES ?authGroup { UNDEF } ?rule acl:group ?authGroup ; acl:graph ?graph . }
}`;

function states(text: string) {
  return Object.fromEntries(policyVariables(text).map((v) => [v.name, v.state]));
}

describe('policyVariables', () => {
  it('reads the seeded example: ?graph fills both parts, ?authGroup is declared', () => {
    expect(states(EXAMPLE)).toEqual({
      graph: 'used',
      defaultGraph: 'unused',
      namedGraph: 'unused',
      authUser: 'unused',
      authGroup: 'used',
    });
    const defaultGraph = policyVariables(EXAMPLE).find((v) => v.name === 'defaultGraph');
    expect(defaultGraph?.meaning).toContain('?graph fills this part');
  });

  it('says a part gets no graphs when neither it nor ?graph is projected', () => {
    const text = 'SELECT ?defaultGraph WHERE { ?r <p> ?defaultGraph }';
    const named = policyVariables(text).find((v) => v.name === 'namedGraph');
    expect(named?.state).toBe('unused');
    expect(named?.meaning).toContain('no named graphs');
  });

  it('flags a caller variable used without its VALUES declaration', () => {
    expect(states('SELECT ?graph WHERE { ?r <p> ?authUser ; <g> ?graph }').authUser).toBe('undeclared');
  });

  it('does not count a variable used only in the pattern as projected', () => {
    expect(states('SELECT ?graph WHERE { ?namedGraph <p> ?graph }').namedGraph).toBe('unused');
  });
});
