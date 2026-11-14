import { describe, expect, it } from 'vitest';
import { planTripleDiff } from '@/lib/tripleDiff';

const turtle = (text: string, label = 'v1') => ({ text, format: 'text/turtle', label });

describe('planTripleDiff', () => {
  it('shows no change when only line order and prefix names differ', async () => {
    const left = turtle(`@prefix ex: <http://example.org/> .
ex:a ex:p "one" .
ex:b ex:p "two" .
`);
    const right = turtle(`@prefix e: <http://example.org/> .
e:b e:p "two" .
e:a e:p "one" .
`, 'v2');
    const result = await planTripleDiff(left, right);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.leftText).toBe(result.rightText);
  });

  it('counts added and removed triples', async () => {
    const result = await planTripleDiff(
      turtle('@prefix ex: <http://example.org/> .\nex:a ex:p 1 .\nex:a ex:q "x" .\n'),
      turtle('@prefix ex: <http://example.org/> .\nex:a ex:p 2 .\nex:a ex:q "x" .\n', 'v2'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.leftText).toContain('ex:a ex:p "1"^^xsd:integer .');
    expect(result.rightText).toContain('ex:a ex:p "2"^^xsd:integer .');
    expect(result.rightText).toContain('ex:a ex:q "x" .');
  });

  it('matches blank nodes up to their labels', async () => {
    const result = await planTripleDiff(
      turtle('@prefix ex: <http://example.org/> .\nex:a ex:addr _:x .\n_:x ex:city "Perth" .\n'),
      turtle('@prefix ex: <http://example.org/> .\nex:a ex:addr [ ex:city "Perth" ] .\n', 'v2'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.rightText).toContain('_:c14n0');
  });

  it('compares a Turtle side with an N-Triples side', async () => {
    const result = await planTripleDiff(
      turtle('@prefix ex: <http://example.org/> .\nex:a ex:p ex:b .\n'),
      { text: '<http://example.org/a> <http://example.org/p> <http://example.org/b> .\n', format: 'application/n-triples', label: 'v2' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added + result.removed).toBe(0);
  });

  it('names the side that does not parse', async () => {
    const result = await planTripleDiff(turtle('ex:a ex:p .', 'Draft'), turtle('', 'v2'));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/^Draft does not parse/);
  });
});
