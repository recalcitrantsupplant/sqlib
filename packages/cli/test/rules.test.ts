import { PEOPLE, sqlib, workspace } from './helpers.js';

const ANCESTORS = `PREFIX : <http://ex/>
DATA { :cy :parent :di }
RULE { ?x :anc ?z } WHERE { ?x :parent ?z }
RULE { ?x :anc ?z } WHERE { ?x :anc ?y . ?y :parent ?z }
RULE { ?x :root true } WHERE { ?x :anc ?y NOT { ?w :anc ?x } }
`;

describe('sqlib rules run', () => {
  it('writes the inference graph and reports convergence', async () => {
    const dir = await workspace({ 'anc.srl': ANCESTORS, 'people.ttl': PEOPLE });
    const { status, stdout, stderr } = await sqlib(dir, ['rules', 'run', '--srl', 'anc.srl', '--data', 'people.ttl']);
    expect(status).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines).toContain('<http://ex/ann> <http://ex/anc> <http://ex/di> .');
    expect(lines).toContain('<http://ex/ann> <http://ex/root> "true"^^<http://www.w3.org/2001/XMLSchema#boolean> .');
    // The base graph is input, not output; the DATA block's triple is output.
    expect(lines).not.toContain('<http://ex/ann> <http://ex/parent> <http://ex/bo> .');
    expect(lines).toContain('<http://ex/cy> <http://ex/parent> <http://ex/di> .');
    expect(stderr).toMatch(/^converged after \d+ passes: 8 triples inferred/);
  });

  it('exits 2 when a stratum hits --max-iterations, with the graph so far', async () => {
    const dir = await workspace({ 'anc.srl': ANCESTORS, 'people.ttl': PEOPLE });
    const { status, stdout, stderr } = await sqlib(dir, ['rules', 'run', '--srl', 'anc.srl', '--data', 'people.ttl', '--max-iterations', '1']);
    expect(status).toBe(2);
    expect(stdout.length).toBeGreaterThan(0);
    expect(stderr).toContain('reached --max-iterations (1)');
  });

  it('refuses rules that do not stratify', async () => {
    const dir = await workspace({
      'loop.srl': 'PREFIX : <http://ex/>\nRULE { ?x :a true } WHERE { ?x :p ?y NOT { ?x :b true } }\nRULE { ?x :b true } WHERE { ?x :p ?y NOT { ?x :a true } }\n',
    });
    const { status, stderr } = await sqlib(dir, ['rules', 'run', '--srl', 'loop.srl']);
    expect(status).toBe(1);
    expect(stderr).toContain('does not stratify');
  });

  it('reads the base graph from standard input', async () => {
    const dir = await workspace({ 'anc.srl': ANCESTORS });
    const { status, stdout } = await sqlib(
      dir,
      ['rules', 'run', '--srl', 'anc.srl', '--data', '-', '--data-format', 'nt'],
      '<http://ex/a> <http://ex/parent> <http://ex/b> .\n',
    );
    expect(status).toBe(0);
    expect(stdout).toContain('<http://ex/a> <http://ex/anc> <http://ex/b> .');
  });
});
