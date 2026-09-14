/**
 * Export formats for a test run, and the `Accept` negotiation that picks one.
 *
 * **Export is a response format on the run routes.** That is the shape a CI
 * step wants: one call runs the tests and returns the artifact,
 * `curl … -H 'Accept: application/xml' > results.xml`.
 *
 * Runs are now also stored (issue #179), so `GET /tests/:id/runs/:runId`
 * negotiates the same formats over a run that already happened — the reason
 * that route is not a *second* implementation is the line below: a format is a
 * pure function of `TestReportInput`, and `TestRunStore.toReportEntry` rebuilds
 * one from storage. What the earlier decision ruled out was putting runs in
 * the *registry*, which is preloaded at boot and must stay bounded by
 * authoring; a stored run lives outside it, as `BenchmarkRun` already did.
 *
 * Every format here is a pure function of `TestReportInput`, which the routes
 * already hold in memory by the time they answer. Adding one is a file plus a
 * registry entry; no route changes, and no new state anywhere.
 *
 * **`Accept: application/json`, and no `Accept` at all, are untouched.** They
 * return the run response they always returned. The flattened export gets its
 * own media type rather than displacing it, so nothing reading the route today
 * can break — see `./jsonExport.ts`.
 */

import { toJUnitXml } from './junit.js';
import { toEarlTurtle, toPlainEarlTurtle } from './earlTurtle.js';
import { toCsv } from './csv.js';
import { toJobSummaryMarkdown } from './markdown.js';
import { toJsonExport } from './jsonExport.js';
import type { TestReportInput } from './rows.js';

export * from './earl.js';
export { toEarlTurtle, toPlainEarlTurtle } from './earlTurtle.js';
export * from './earlPlain.js';
export * from './rows.js';
export { toJUnitXml } from './junit.js';
export { toCsv, CSV_COLUMNS } from './csv.js';
export { toJobSummaryMarkdown, MAX_SUMMARY_BYTES } from './markdown.js';
export { toJsonExport, TEST_REPORT_JSON_VERSION, type TestReportJson } from './jsonExport.js';

export const TEST_REPORT_MEDIA_TYPES = {
  JUNIT: 'application/xml',
  /**
   * EARL, the vocabulary this reporting was built around. A response format
   * like the rest: the report is the answer to the run, not something the
   * caller must first find a graph to store.
   */
  EARL: 'text/turtle',
  CSV: 'text/csv',
  MARKDOWN: 'text/markdown',
  /**
   * Vendor-specific because `application/json` is spoken for by the run
   * response, and a caller asking for "JSON" means that one.
   */
  JSON_EXPORT: 'application/vnd.sqlib.test-report+json',
} as const;

export type TestReportMediaType =
  (typeof TEST_REPORT_MEDIA_TYPES)[keyof typeof TEST_REPORT_MEDIA_TYPES];

/**
 * The `profile` values that name the conformance EARL report.
 *
 * Three spellings of one thing, because callers reach for different ones: the
 * short name, the audience, and the schema URI a `profile` parameter is
 * conventionally given. Matched case-insensitively.
 */
export const EARL_PLAIN_PROFILES = [
  'earl',
  'w3c',
  'https://www.w3.org/TR/EARL10-Schema/',
] as const;

/** The same, for the extended report — the default when no profile is named. */
export const EARL_EXTENDED_PROFILES = ['sqlib', 'extended'] as const;

export interface TestReportFormat {
  mediaType: TestReportMediaType;
  /** Types that mean the same format. `text/xml` is the older JUnit spelling. */
  aliases: string[];
  /** Offered as `Content-Disposition`, so a browser download lands named. */
  filename: string;
  render: (input: TestReportInput) => string;
  /**
   * `Accept: text/turtle;profile=earl` — a second format under one media type.
   *
   * Two EARL reports over one run is a *profile* distinction, not a media-type
   * one: both are Turtle, and a caller that cannot express the difference is a
   * caller who has to be given a new endpoint or a query parameter instead. The
   * parameter is what HTTP already has for "this type, that shape".
   */
  profiles?: readonly string[];
  /** The format a caller naming the media type and no profile gets. */
  isDefaultProfile?: boolean;
  /** Echoed back in `Content-Type`, so the answer says which shape it is. */
  profileParameter?: string;
}

export const TEST_REPORT_FORMATS: TestReportFormat[] = [
  {
    mediaType: TEST_REPORT_MEDIA_TYPES.JUNIT,
    aliases: ['text/xml'],
    filename: 'test-results.xml',
    render: toJUnitXml,
  },
  {
    mediaType: TEST_REPORT_MEDIA_TYPES.EARL,
    // `application/x-turtle` predates the registration and is still what some
    // RDF tooling sends.
    aliases: ['application/x-turtle'],
    filename: 'test-results.ttl',
    render: toEarlTurtle,
    profiles: EARL_EXTENDED_PROFILES,
    // The unqualified `text/turtle` keeps meaning what it has always meant:
    // adding the conformance profile must not change what an existing CI step
    // downloads tomorrow.
    isDefaultProfile: true,
  },
  {
    mediaType: TEST_REPORT_MEDIA_TYPES.EARL,
    aliases: ['application/x-turtle'],
    // Named for what it is rather than for the run, because this is the file
    // that gets attached to an implementation report.
    filename: 'earl-report.ttl',
    render: toPlainEarlTurtle,
    profiles: EARL_PLAIN_PROFILES,
    profileParameter: 'earl',
  },
  {
    mediaType: TEST_REPORT_MEDIA_TYPES.CSV,
    aliases: [],
    filename: 'test-results.csv',
    render: toCsv,
  },
  {
    mediaType: TEST_REPORT_MEDIA_TYPES.MARKDOWN,
    aliases: ['text/x-markdown'],
    filename: 'test-results.md',
    render: toJobSummaryMarkdown,
  },
  {
    mediaType: TEST_REPORT_MEDIA_TYPES.JSON_EXPORT,
    aliases: [],
    filename: 'test-results.json',
    // Indented: this one is read by people as often as by scripts, and a
    // single-line report of a hundred cases is not readable by either.
    render: input => `${JSON.stringify(toJsonExport(input), null, 2)}\n`,
  },
];

/** The default: the route's own JSON response, exactly as before. */
export type ReportNegotiation =
  | { kind: 'default' }
  | { kind: 'format'; format: TestReportFormat }
  | { kind: 'unacceptable'; accept: string };

interface AcceptEntry {
  type: string;
  q: number;
  /** The `profile` parameter, lower-cased and unquoted. Absent means "default". */
  profile?: string;
  /** Position in the header, to break ties the way the caller wrote them. */
  order: number;
}

function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(',')
    .map((part, order) => {
      const [type, ...params] = part.trim().split(';');
      const qParam = params.map(p => p.trim()).find(p => p.toLowerCase().startsWith('q='));
      const parsed = qParam ? Number.parseFloat(qParam.slice(2)) : 1;
      const profileParam = params.map(p => p.trim()).find(p => p.toLowerCase().startsWith('profile='));
      // Quoted is the correct spelling for a parameter holding a URI, and bare
      // is what people type. Both mean the same profile.
      const profile = profileParam
        ? profileParam.slice('profile='.length).trim().replace(/^"|"$/g, '').toLowerCase()
        : undefined;
      return {
        type: (type ?? '').trim().toLowerCase(),
        ...(profile ? { profile } : {}),
        // A malformed q is treated as absent rather than as zero: reading
        // `q=high` as "refuses everything" would answer 406 to a typo.
        q: Number.isFinite(parsed) ? parsed : 1,
        order,
      };
    })
    .filter(entry => entry.type !== '' && entry.q > 0)
    // Highest q first; original order within a q, which is what a caller
    // listing several types at the same weight means by listing them in order.
    .sort((a, b) => (b.q - a.q) || (a.order - b.order));
}

function matchesType(entry: AcceptEntry, format: TestReportFormat): boolean {
  if (entry.type === format.mediaType) return true;
  if (format.aliases.includes(entry.type)) return true;
  // `application/*` picks a format; `*/*` does not — see below.
  const [group] = entry.type.split('/');
  return entry.type.endsWith('/*')
    && entry.type !== '*/*'
    && format.mediaType.startsWith(`${group}/`);
}

/**
 * Whether the profile the caller named is the one this format answers to.
 *
 * A named profile no format claims is *not* quietly served by the default one:
 * `profile=earl-strict` is a caller with a specific document in mind, and
 * handing them a different graph labelled as what they asked for is the same
 * failure as answering JSON to a request for XML. It falls through to a 406.
 */
function matchesProfile(entry: AcceptEntry, format: TestReportFormat): boolean {
  if (entry.profile === undefined) return format.profiles === undefined || format.isDefaultProfile === true;
  return (format.profiles ?? []).some(profile => profile.toLowerCase() === entry.profile);
}

function matches(entry: AcceptEntry, format: TestReportFormat): boolean {
  return matchesType(entry, format) && matchesProfile(entry, format);
}

/**
 * Which format an `Accept` header asks for.
 *
 * A wildcard `Accept` and a missing header both mean *default*, never "pick
 * something for me". A browser sends a wildcard on an ordinary fetch, and a curl with no header
 * sends nothing at all; answering either with CSV because it sorted first would
 * make the plain call unpredictable. An export is only ever produced when it was
 * named.
 */
export function negotiateReportFormat(header: string | undefined | null): ReportNegotiation {
  const accept = (header ?? '').trim();
  if (accept === '') return { kind: 'default' };

  const entries = parseAccept(accept);
  if (entries.length === 0) return { kind: 'unacceptable', accept };

  for (const entry of entries) {
    if (entry.type === '*/*' || entry.type === 'application/json' || entry.type === 'application/*') {
      // `application/*` reaches the run response too, and the run response is
      // what a caller who did not name a format should get.
      return { kind: 'default' };
    }
    const format = TEST_REPORT_FORMATS.find(candidate => matches(entry, candidate));
    if (format) return { kind: 'format', format };
  }

  // Nothing offered is acceptable. A 406 says so; silently answering JSON to a
  // caller that asked for XML is how a broken CI step looks green.
  return { kind: 'unacceptable', accept };
}

export interface RenderedReport {
  body: string;
  contentType: string;
  contentDisposition: string;
}

export function renderReport(format: TestReportFormat, input: TestReportInput): RenderedReport {
  return {
    body: format.render(input),
    contentType: `${format.mediaType}; charset=utf-8`
      + (format.profileParameter ? `; profile="${format.profileParameter}"` : ''),
    contentDisposition: `attachment; filename="${format.filename}"`,
  };
}
