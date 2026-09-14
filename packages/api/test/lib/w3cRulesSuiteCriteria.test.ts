/**
 * The criterion IRIs the suite's entries carry, read off its real manifests.
 *
 * These are what an EARL conformance report cites, so a wrong one is not a
 * cosmetic defect: it is a submission pointing a reviewer at a manifest entry
 * that does not exist. Asserted against the vendored snapshot rather than a
 * fixture, because the failure mode being guarded against — a refreshed suite
 * that moves its entries, or a manifest whose entry IRIs are relative and start
 * resolving somewhere else — only shows up against the real files.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_CATEGORIES,
  EVAL_CATEGORIES,
  readW3cRulesDocumentSuite,
  readW3cRulesEvalSuite,
} from '../../src/lib/w3cRulesSuite/manifest.js';
import { DEFAULT_SUITE_BASE_IRI, resetEarlReportConfig } from '../../src/config/earlReport.js';

describe('W3C rules suite criteria', () => {
  it('gives every entry a criterion under the suite it was published in', async () => {
    for (const category of EVAL_CATEGORIES) {
      for (const entry of (await readW3cRulesEvalSuite(category)).entries) {
        expect(entry.criterion, entry.slug).toContain(DEFAULT_SUITE_BASE_IRI);
      }
    }
    for (const category of DOCUMENT_CATEGORIES) {
      for (const entry of (await readW3cRulesDocumentSuite(category)).entries) {
        expect(entry.criterion, entry.slug).toContain(DEFAULT_SUITE_BASE_IRI);
      }
    }
  });

  it('reads the absolute IRI an eval manifest writes', async () => {
    const { entries } = await readW3cRulesEvalSuite('eval');
    const first = entries.find(entry => entry.slug === 'eval-eval-basic-01');
    expect(first?.criterion).toBe(`${DEFAULT_SUITE_BASE_IRI}eval-basic-01`);
  });

  it('resolves the relative IRIs a document manifest writes against its own location', async () => {
    // `syntax/manifest.ttl` declares `PREFIX : <manifest#>`, so `:test_1` means
    // nothing until it is resolved — and resolving it against a placeholder is
    // how a report ends up citing `http://example.org/…`.
    const { entries } = await readW3cRulesDocumentSuite('syntax');
    expect(entries[0]?.criterion).toBe(`${DEFAULT_SUITE_BASE_IRI}syntax/manifest#test_1`);
  });

  it('follows the suite base when the snapshot is republished elsewhere', async () => {
    resetEarlReportConfig({ earlReport: { suiteBaseIri: 'https://example.org/tests' } });
    try {
      const { entries } = await readW3cRulesDocumentSuite('wellformed');
      expect(entries[0]?.criterion).toContain('https://example.org/tests/wellformed/manifest#');
    } finally {
      resetEarlReportConfig();
    }
  });

  it('has no two entries claiming the same criterion', async () => {
    const criteria: string[] = [];
    for (const category of EVAL_CATEGORIES) {
      criteria.push(...(await readW3cRulesEvalSuite(category)).entries.map(entry => entry.criterion));
    }
    for (const category of DOCUMENT_CATEGORIES) {
      criteria.push(...(await readW3cRulesDocumentSuite(category)).entries.map(entry => entry.criterion));
    }
    expect(new Set(criteria).size).toBe(criteria.length);
  });
});
