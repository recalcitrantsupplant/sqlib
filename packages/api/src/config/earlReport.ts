/**
 * Who the EARL report says made it, and about what.
 *
 * A conformance report is a claim by somebody about a piece of software, so it
 * carries three identities the code cannot know: the **project** under test,
 * the **assertor** standing behind the verdicts, and the **base IRI** the test
 * suite is published under (which is what makes `earl:test` resolve to the
 * manifest entry a reviewer can look up).
 *
 * All of it lives in `packages/api/package.json`, and most of it in the fields
 * npm already defines. `name`, `version`, `description`, `homepage`,
 * `repository` and `author` are the same facts DOAP asks for, and a release
 * that has to be described twice is a release that will eventually be described
 * inconsistently — so the version in the report is the version in the manifest,
 * with no second place to bump. The `earlReport` key holds only what npm has no
 * field for: the project's IRI, the assertor's IRI, and where the vendored test
 * suite was published.
 *
 * Deliberately *not* environment variables. There were thirteen of them, which
 * is a configuration surface out of all proportion to "one identity record that
 * changes when the project is first published". A deployment that needs to
 * override this edits one committed file.
 *
 * Read through `getEarlReportConfig()`, which loads once and caches. See
 * `docs/guides/testing-and-conformance.md`.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The node a report points `earl:subject` at until the project is published. */
export const DEFAULT_PROJECT_IRI = 'urn:sqlib:software';

/**
 * Where the vendored W3C suite is published.
 *
 * The manifests resolve their entry IRIs against this: `eval/manifest.ttl`
 * names its entries with an absolute prefix, while `syntax/manifest.ttl` writes
 * `PREFIX : <manifest#>` and so derives every criterion IRI from it. Point it
 * at wherever the snapshot in `packages/srl/test/w3c` came from if that ever
 * stops being rdf-tests.
 */
export const DEFAULT_SUITE_BASE_IRI = 'https://w3c.github.io/rdf-tests/shacl/shacl12/';

/**
 * `packages/api/package.json`, from either `src/config/` or `dist/config/`.
 *
 * The same depth from both, so the built image reads the manifest it shipped
 * with — which is also why this is the manifest rather than a JSON file of its
 * own: the production stage of the Dockerfile copies `package.json` and `dist`,
 * and a config file beside them would have been a fourth thing to remember to
 * copy.
 */
const MANIFEST_PATH = fileURLToPath(new URL('../../package.json', import.meta.url));

/** An assertor is a person, an organisation, or a piece of software. */
export type EarlAssertorKind = 'Person' | 'Organization' | 'Software';

/** The `earlReport` key: what npm's own fields cannot say. */
export interface EarlReportManifestBlock {
  /** `earl:subject`. Must be dereferenceable for a submission. */
  projectIri?: string;
  /** `doap:name`, when the npm package name is not the project's name. */
  projectName?: string;
  /** `doap:download-page` — where a reviewer gets a copy to check the claim. */
  downloadPage?: string;
  /** `doap:programming-language`. */
  programmingLanguages?: string[];
  assertor?: {
    iri?: string;
    name?: string;
    homepage?: string;
    kind?: string;
  };
  suiteBaseIri?: string;
}

/** The npm fields that double as DOAP, plus the block above. */
export interface PackageManifest {
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  repository?: string | { url?: string };
  author?: string | { name?: string; url?: string };
  earlReport?: EarlReportManifestBlock;
}

export interface EarlProjectConfig {
  /** `earl:subject` / the `doap:Project` node. */
  iri: string;
  name: string;
  description?: string;
  homepage?: string;
  /** The release the run was made against — `dct:hasVersion` / `doap:revision`. */
  version?: string;
  repository?: string;
  downloadPage?: string;
  programmingLanguages: string[];
}

export interface EarlAssertorConfig {
  /** `earl:assertedBy`. Defaults to the project: an unattended run self-asserts. */
  iri: string;
  name: string;
  homepage?: string;
  kind: EarlAssertorKind;
}

export interface EarlReportConfig {
  project: EarlProjectConfig;
  assertor: EarlAssertorConfig;
  /** Trailing-slash base the suite's manifests resolve against. */
  suiteBaseIri: string;
  /**
   * True while the project is still the built-in `urn:` placeholder.
   *
   * A submission needs a dereferenceable subject, so this is the one fact the
   * serialiser surfaces to the reader instead of silently emitting a report
   * that names nothing a reviewer can visit.
   */
  isPlaceholder: boolean;
}

/** Trimmed, or undefined — an empty field means unset, not "set to empty". */
function text(value: unknown): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? undefined : trimmed;
}

/**
 * An IRI-shaped field, or undefined.
 *
 * Every IRI here reaches `sparqlTerms.iri()`, which refuses anything carrying a
 * space or an angle bracket — correctly, but the failure would land as a 500 on
 * a report route long after someone mistyped a homepage. Rejecting it at load
 * time instead means the report is merely missing a `doap:homepage`.
 */
function iriText(value: unknown): string | undefined {
  const trimmed = text(value);
  if (trimmed === undefined) return undefined;
  return /[<>"{}|\\^`\s]/.test(trimmed) ? undefined : trimmed;
}

/** `repository` is a string or `{ type, url }`, and the url may be `git+https://…`. */
function repositoryIri(repository: PackageManifest['repository']): string | undefined {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  const value = text(raw);
  if (value === undefined) return undefined;
  return iriText(value.replace(/^git\+/, '').replace(/^git:\/\//, 'https://'));
}

/** npm's `author`, in either of its two spellings. */
function author(value: PackageManifest['author']): { name?: string; url?: string } {
  if (typeof value !== 'string') return { name: text(value?.name), url: iriText(value?.url) };
  // `Name <email> (https://example.org)` — the shorthand npm documents.
  const match = /^([^<(]*)(?:<[^>]*>)?\s*(?:\(([^)]*)\))?/.exec(value.trim());
  return { name: text(match?.[1]), url: iriText(match?.[2]) };
}

function assertorKind(value: unknown, named: boolean): EarlAssertorKind {
  const kind = text(value)?.toLowerCase();
  if (kind === 'person') return 'Person';
  if (kind === 'organization' || kind === 'organisation') return 'Organization';
  if (kind === 'software') return 'Software';
  // Unstated: an assertor identified only by the project is the software
  // asserting about itself, which is what an unattended CI run is.
  return named ? 'Person' : 'Software';
}

/** A trailing slash, so the suite base concatenates with a directory name. */
function withTrailingSlash(iri: string): string {
  return iri.endsWith('/') ? iri : `${iri}/`;
}

/** Spreads to nothing when the value is absent, so no key is written as `undefined`. */
function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, string>);
}

export function buildEarlReportConfig(manifest: PackageManifest = {}): EarlReportConfig {
  const block = manifest.earlReport ?? {};
  const projectIri = iriText(block.projectIri) ?? DEFAULT_PROJECT_IRI;
  const languages = (block.programmingLanguages ?? [])
    .map(language => text(language))
    .filter((language): language is string => language !== undefined);
  const maintainer = author(manifest.author);

  const project: EarlProjectConfig = {
    iri: projectIri,
    name: text(block.projectName) ?? text(manifest.name) ?? 'sqlib',
    ...optional('description', text(manifest.description)),
    ...optional('homepage', iriText(manifest.homepage)),
    ...optional('version', text(manifest.version)),
    ...optional('repository', repositoryIri(manifest.repository)),
    ...optional('downloadPage', iriText(block.downloadPage)),
    programmingLanguages: languages.length > 0 ? languages : ['TypeScript'],
  };

  const assertorIri = iriText(block.assertor?.iri) ?? maintainer.url;
  const assertorName = text(block.assertor?.name) ?? maintainer.name;

  const assertor: EarlAssertorConfig = {
    // Falling back to the project rather than minting a second placeholder:
    // "the software asserted this about itself" is both true of an unattended
    // run and a shape EARL has a term for.
    iri: assertorIri ?? project.iri,
    name: assertorName ?? project.name,
    ...optional('homepage', iriText(block.assertor?.homepage) ?? maintainer.url),
    kind: assertorKind(block.assertor?.kind, assertorIri !== undefined || assertorName !== undefined),
  };

  return {
    project,
    assertor,
    suiteBaseIri: withTrailingSlash(iriText(block.suiteBaseIri) ?? DEFAULT_SUITE_BASE_IRI),
    isPlaceholder: project.iri === DEFAULT_PROJECT_IRI,
  };
}

/**
 * The manifest on disk, or an empty one.
 *
 * A manifest that will not parse gives the built-in defaults rather than
 * throwing: this is read on the way to answering a report, and taking the
 * process down over a description field would be a poor trade. The placeholder
 * banner in the document is the visible consequence.
 */
function readManifest(): PackageManifest {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as PackageManifest;
  } catch {
    return {};
  }
}

let current: EarlReportConfig | null = null;

export function getEarlReportConfig(): EarlReportConfig {
  current ??= buildEarlReportConfig(readManifest());
  return current;
}

/** Reload from disk, or from a manifest supplied by a test. */
export function resetEarlReportConfig(manifest?: PackageManifest): EarlReportConfig {
  current = buildEarlReportConfig(manifest ?? readManifest());
  return current;
}
