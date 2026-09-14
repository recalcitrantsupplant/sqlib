import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scenario queries must be deterministic: the same graph over the same data has to
 * produce byte-identical results on every run.
 *
 * Without this, re-executing a group cannot be compared against itself, so the
 * properties that matter most - engine result equals reference-interpreter result,
 * and same graph plus same data yields the same output - degrade into "some rows
 * came back". Deriving identity from the bound variables (see
 * `data/basic-linear-chain-query3.sparql`) is both deterministic and a better test:
 * it asserts the join actually carried the values through.
 */
const NON_DETERMINISTIC = ['NOW', 'RAND', 'STRUUID', 'UUID', 'BNODE'] as const;

const scenarioRoot = join(__dirname);

function collectSources(dir: string): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(full));
    } else if (/\.(sparql|test\.ts)$/.test(entry.name) && entry.name !== 'scenario-determinism.test.ts') {
      out.push({ file: full, text: readFileSync(full, 'utf8') });
    }
  }
  return out;
}

describe('scenario query determinism', () => {
  it('no scenario query uses a non-deterministic SPARQL function', () => {
    const offenders: string[] = [];

    for (const { file, text } of collectSources(scenarioRoot)) {
      for (const fn of NON_DETERMINISTIC) {
        // Match a call site, and ignore prose mentions in comments.
        const pattern = new RegExp(`\\b${fn}\\s*\\(`, 'g');
        for (const match of text.matchAll(pattern)) {
          const lineStart = text.lastIndexOf('\n', match.index) + 1;
          const line = text.slice(lineStart, text.indexOf('\n', match.index));
          if (/^\s*(\/\/|#|\*)/.test(line)) continue;
          const lineNumber = text.slice(0, match.index).split('\n').length;
          offenders.push(`${file.replace(scenarioRoot, 'test/scenarios')}:${lineNumber}  ${line.trim()}`);
        }
      }
    }

    expect(offenders, `Non-deterministic SPARQL in scenario queries:\n${offenders.join('\n')}`).toEqual([]);
  });
});
