/**
 * The AuthStore: grants as RDF in a dedicated graph, mirrored in memory (design §5).
 *
 * Grants live in the `urn:sqlib:auth` named graph of the library storage backend
 * and are mirrored into in-process indexes at startup. Reads (every request)
 * never leave memory; writes go through the single `/auth` API path and are
 * persisted synchronously before the indexes are rebuilt.
 *
 * The graph is deliberately unreachable through the entity layer: no LDKit schema
 * maps this vocabulary, so nothing here can surface through an entity route.
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import * as oxigraph from 'oxigraph';
import type { BackendMode, LibraryMode } from './types.js';
import { RESOURCE_EVERYTHING, isBackendMode, isLibraryMode } from './types.js';
import {
  AUTH_GRAPH_IRI,
  BACKEND_MODE_IRIS,
  LIBRARY_MODE_IRIS,
  RDF_TYPE,
  XSD_DATETIME,
  auth,
  backendModeFromIri,
  libraryModeFromIri,
} from './vocabulary.js';

/**
 * Marks that the seed file has been applied to this graph. Durable, so seeding
 * stays a genuinely one-time event rather than "whenever the graph looks empty".
 */
const SEED_MARKER_IRI = 'urn:sqlib:auth:seed-state';

export type GrantResourceKind = 'library' | 'backend' | 'everything';

export interface Grant {
  id: string;
  principal: string;
  resourceKind: GrantResourceKind;
  /** Library IRI, backend IRI, or the `auth:Everything` sentinel. */
  resource: string;
  modes: ReadonlySet<string>;
  grantedBy?: string;
  grantedAt?: string;
}

export interface PrincipalRecord {
  iri: string;
  rawClaim: string;
  kind: string;
  seenAt?: string;
}

export interface CreateGrantInput {
  principal: string;
  resourceKind: GrantResourceKind;
  resource: string;
  modes: readonly string[];
  grantedBy?: string;
}

/**
 * How the auth graph reaches durable storage. Extracted so tests can run the
 * store entirely in memory, and so a cycle through `ExecutorFactory` is avoided.
 */
export interface AuthGraphPersistence {
  /** Returns the auth graph as N-Quads (may be empty). */
  load(): Promise<string>;
  /** Applies an insert/delete of concrete quads, serialized as N-Quads. */
  apply(params: { insert?: string; delete?: string }): Promise<void>;
}

/** Persistence that keeps nothing. Used in `disabled` mode and unit tests. */
export const inMemoryPersistence = (): AuthGraphPersistence => {
  let contents = '';
  return {
    async load() {
      return contents;
    },
    async apply({ insert, delete: toDelete }) {
      if (toDelete) {
        const removed = new Set(toDelete.split('\n').map(line => line.trim()).filter(Boolean));
        contents = contents
          .split('\n')
          .filter(line => line.trim() && !removed.has(line.trim()))
          .join('\n');
      }
      if (insert) {
        contents = contents ? `${contents}\n${insert.trim()}` : insert.trim();
      }
    },
  };
};

function iriTerm(value: string): oxigraph.NamedNode {
  return oxigraph.namedNode(value);
}

function modeIriFor(resourceKind: GrantResourceKind, mode: string): string {
  if (resourceKind === 'backend') {
    return BACKEND_MODE_IRIS[mode as BackendMode] ?? LIBRARY_MODE_IRIS[mode as LibraryMode];
  }
  return LIBRARY_MODE_IRIS[mode as LibraryMode] ?? BACKEND_MODE_IRIS[mode as BackendMode];
}

export function validateModes(resourceKind: GrantResourceKind, modes: readonly string[]): string[] {
  if (modes.length === 0) {
    throw Object.assign(new Error('A grant must specify at least one mode.'), { statusCode: 400 });
  }
  const normalized = modes.map(mode => mode.trim().toLowerCase());
  for (const mode of normalized) {
    const valid =
      resourceKind === 'backend'
        ? isBackendMode(mode)
        : resourceKind === 'library'
          ? isLibraryMode(mode)
          : isLibraryMode(mode) || isBackendMode(mode);
    if (!valid) {
      throw Object.assign(
        new Error(`Invalid mode "${mode}" for ${resourceKind} grant.`),
        { statusCode: 400 }
      );
    }
  }
  return [...new Set(normalized)];
}

export class AuthStore {
  private store = new oxigraph.Store();
  private grants = new Map<string, Grant>();
  private byPrincipal = new Map<string, Grant[]>();
  private byLibrary = new Map<string, Grant[]>();
  private byBackend = new Map<string, Grant[]>();
  private adminPrincipals = new Set<string>();
  private principalRecords = new Map<string, PrincipalRecord>();
  private bootstrapAdmins = new Set<string>();
  private loaded = false;

  constructor(private persistence: AuthGraphPersistence = inMemoryPersistence()) {}

  setPersistence(persistence: AuthGraphPersistence): void {
    this.persistence = persistence;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** Bootstrap admins from env; held separately so they survive graph rebuilds. */
  setBootstrapAdmins(principals: readonly string[]): void {
    this.bootstrapAdmins = new Set(principals);
    this.rebuildIndexes();
  }

  async load(options: { seedGrantsPath?: string } = {}): Promise<void> {
    const nquads = await this.persistence.load();
    this.store = new oxigraph.Store();
    if (nquads.trim()) {
      this.store.load(nquads, { format: 'application/n-quads' });
    }

    // "Has the seed run?" is recorded in the graph, not inferred from whether
    // grants exist. Inferring it means revoking every seeded grant resurrects
    // them all on the next restart — a revocation that silently undoes itself.
    if (options.seedGrantsPath && !this.hasSeedMarker()) {
      await this.loadSeed(options.seedGrantsPath);
    }

    this.rebuildIndexes();
    this.loaded = true;
  }

  /**
   * Loads a Turtle seed file into the auth graph exactly once, recording a
   * durable marker so later boots skip it whatever the grants now look like.
   */
  private async loadSeed(seedPath: string): Promise<void> {
    let contents: string;
    try {
      contents = await fs.readFile(seedPath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read SQLIB_AUTH_SEED_GRANTS file ${seedPath}: ${(error as Error).message}`);
    }

    const graph = iriTerm(AUTH_GRAPH_IRI);
    try {
      this.store.load(contents, { format: 'text/turtle', to_graph_name: graph });
    } catch (error) {
      throw new Error(`Failed to parse SQLIB_AUTH_SEED_GRANTS file ${seedPath}: ${(error as Error).message}`);
    }

    this.store.add(
      oxigraph.quad(
        iriTerm(SEED_MARKER_IRI),
        iriTerm(auth.seenAt),
        oxigraph.literal(new Date().toISOString(), iriTerm(XSD_DATETIME)),
        graph
      )
    );

    const seeded = this.store.dump({ format: 'application/n-quads' }).trim();
    if (seeded) {
      await this.persistence.apply({ insert: seeded });
    }
  }

  private hasSeedMarker(): boolean {
    return (
      this.store.match(iriTerm(SEED_MARKER_IRI), null, null, iriTerm(AUTH_GRAPH_IRI)).length > 0
    );
  }

  private serializeQuad(quad: oxigraph.Quad): string {
    const single = new oxigraph.Store([quad]);
    return single.dump({ format: 'application/n-quads' }).trim();
  }

  private rebuildIndexes(): void {
    this.grants = new Map();
    this.byPrincipal = new Map();
    this.byLibrary = new Map();
    this.byBackend = new Map();
    this.adminPrincipals = new Set(this.bootstrapAdmins);
    this.principalRecords = new Map();

    const graph = iriTerm(AUTH_GRAPH_IRI);

    for (const quad of this.store.match(null, iriTerm(RDF_TYPE), iriTerm(auth.Grant), graph)) {
      const grant = this.readGrant(quad.subject.value);
      if (grant) this.indexGrant(grant);
    }

    for (const quad of this.store.match(null, iriTerm(RDF_TYPE), iriTerm(auth.Principal), graph)) {
      const record = this.readPrincipal(quad.subject.value);
      if (record) this.principalRecords.set(record.iri, record);
    }
  }

  private objectsOf(subject: string, predicate: string): string[] {
    const results: string[] = [];
    for (const quad of this.store.match(
      iriTerm(subject),
      iriTerm(predicate),
      null,
      iriTerm(AUTH_GRAPH_IRI)
    )) {
      results.push(quad.object.value);
    }
    return results;
  }

  private readGrant(id: string): Grant | null {
    const principal = this.objectsOf(id, auth.principal)[0];
    if (!principal) return null;

    let resourceKind: GrantResourceKind;
    let resource: string;

    const library = this.objectsOf(id, auth.onLibrary)[0];
    const backend = this.objectsOf(id, auth.onBackend)[0];
    const everything = this.objectsOf(id, auth.onEverything)[0];

    if (library) {
      resourceKind = 'library';
      resource = library;
    } else if (backend) {
      resourceKind = 'backend';
      resource = backend;
    } else if (everything) {
      resourceKind = 'everything';
      resource = RESOURCE_EVERYTHING;
    } else {
      return null;
    }

    const modes = new Set<string>();
    for (const modeIri of this.objectsOf(id, auth.mode)) {
      const mode =
        resourceKind === 'backend'
          ? (backendModeFromIri(modeIri) ?? libraryModeFromIri(modeIri))
          : (libraryModeFromIri(modeIri) ?? backendModeFromIri(modeIri));
      if (mode) modes.add(mode);
    }
    if (modes.size === 0) return null;

    return {
      id,
      principal,
      resourceKind,
      resource,
      modes,
      grantedBy: this.objectsOf(id, auth.grantedBy)[0],
      grantedAt: this.objectsOf(id, auth.grantedAt)[0],
    };
  }

  private readPrincipal(iri: string): PrincipalRecord | null {
    const rawClaim = this.objectsOf(iri, auth.rawClaim)[0];
    if (!rawClaim) return null;
    return {
      iri,
      rawClaim,
      kind: this.objectsOf(iri, auth.principalKind)[0] ?? 'user',
      seenAt: this.objectsOf(iri, auth.seenAt)[0],
    };
  }

  private indexGrant(grant: Grant): void {
    this.grants.set(grant.id, grant);

    const forPrincipal = this.byPrincipal.get(grant.principal) ?? [];
    forPrincipal.push(grant);
    this.byPrincipal.set(grant.principal, forPrincipal);

    if (grant.resourceKind === 'library') {
      const forLibrary = this.byLibrary.get(grant.resource) ?? [];
      forLibrary.push(grant);
      this.byLibrary.set(grant.resource, forLibrary);
    } else if (grant.resourceKind === 'backend') {
      const forBackend = this.byBackend.get(grant.resource) ?? [];
      forBackend.push(grant);
      this.byBackend.set(grant.resource, forBackend);
    } else if (grant.modes.has('control')) {
      this.adminPrincipals.add(grant.principal);
    }
  }

  grantsForPrincipals(principals: readonly string[]): Grant[] {
    const results: Grant[] = [];
    for (const principal of principals) {
      const found = this.byPrincipal.get(principal);
      if (found) results.push(...found);
    }
    return results;
  }

  isAdmin(principals: readonly string[]): boolean {
    return principals.some(principal => this.adminPrincipals.has(principal));
  }

  getGrant(id: string): Grant | null {
    return this.grants.get(id) ?? null;
  }

  listGrants(filter: { library?: string; backend?: string; principal?: string } = {}): Grant[] {
    if (filter.library) return [...(this.byLibrary.get(filter.library) ?? [])];
    if (filter.backend) return [...(this.byBackend.get(filter.backend) ?? [])];
    if (filter.principal) return [...(this.byPrincipal.get(filter.principal) ?? [])];
    return [...this.grants.values()];
  }

  listPrincipals(query?: string): PrincipalRecord[] {
    const records = [...this.principalRecords.values()];
    if (!query) return records;
    const needle = query.toLowerCase();
    return records.filter(record => record.rawClaim.toLowerCase().includes(needle));
  }

  async createGrant(input: CreateGrantInput): Promise<Grant> {
    const modes = validateModes(input.resourceKind, input.modes);
    const id = `urn:sqlib:grant:${randomUUID()}`;
    const grantedAt = new Date().toISOString();

    const graph = iriTerm(AUTH_GRAPH_IRI);
    const subject = iriTerm(id);
    const quads: oxigraph.Quad[] = [
      oxigraph.quad(subject, iriTerm(RDF_TYPE), iriTerm(auth.Grant), graph),
      oxigraph.quad(subject, iriTerm(auth.principal), iriTerm(input.principal), graph),
      oxigraph.quad(
        subject,
        iriTerm(auth.grantedAt),
        oxigraph.literal(grantedAt, iriTerm(XSD_DATETIME)),
        graph
      ),
    ];

    if (input.resourceKind === 'library') {
      quads.push(oxigraph.quad(subject, iriTerm(auth.onLibrary), iriTerm(input.resource), graph));
    } else if (input.resourceKind === 'backend') {
      quads.push(oxigraph.quad(subject, iriTerm(auth.onBackend), iriTerm(input.resource), graph));
    } else {
      quads.push(oxigraph.quad(subject, iriTerm(auth.onEverything), iriTerm(RESOURCE_EVERYTHING), graph));
    }

    for (const mode of modes) {
      quads.push(oxigraph.quad(subject, iriTerm(auth.mode), iriTerm(modeIriFor(input.resourceKind, mode)), graph));
    }

    if (input.grantedBy) {
      quads.push(oxigraph.quad(subject, iriTerm(auth.grantedBy), iriTerm(input.grantedBy), graph));
    }

    const serialized = quads.map(quad => this.serializeQuad(quad)).join('\n');
    await this.persistence.apply({ insert: serialized });
    for (const quad of quads) this.store.add(quad);
    this.rebuildIndexes();

    const created = this.grants.get(id);
    if (!created) {
      throw new Error(`Grant ${id} failed to index after creation.`);
    }
    return created;
  }

  async deleteGrant(id: string): Promise<boolean> {
    if (!this.grants.has(id)) return false;

    const quads = [...this.store.match(iriTerm(id), null, null, iriTerm(AUTH_GRAPH_IRI))];
    if (quads.length === 0) return false;

    const serialized = quads.map(quad => this.serializeQuad(quad)).join('\n');
    await this.persistence.apply({ delete: serialized });
    for (const quad of quads) this.store.delete(quad);
    this.rebuildIndexes();
    return true;
  }

  /** Removes every grant naming a library. Called when the library is deleted. */
  async deleteGrantsForLibrary(libraryIri: string): Promise<number> {
    const grants = this.byLibrary.get(libraryIri) ?? [];
    let removed = 0;
    for (const grant of [...grants]) {
      if (await this.deleteGrant(grant.id)) removed += 1;
    }
    return removed;
  }

  /**
   * Records a principal so admins can find it in the share dialog. Written at
   * most once per principal per process — this is not a hot write path.
   */
  async recordPrincipal(iri: string, rawClaim: string, kind: string): Promise<void> {
    if (this.principalRecords.has(iri)) return;

    const graph = iriTerm(AUTH_GRAPH_IRI);
    const subject = iriTerm(iri);
    const quads = [
      oxigraph.quad(subject, iriTerm(RDF_TYPE), iriTerm(auth.Principal), graph),
      oxigraph.quad(subject, iriTerm(auth.rawClaim), oxigraph.literal(rawClaim), graph),
      oxigraph.quad(subject, iriTerm(auth.principalKind), oxigraph.literal(kind), graph),
      oxigraph.quad(
        subject,
        iriTerm(auth.seenAt),
        oxigraph.literal(new Date().toISOString(), iriTerm(XSD_DATETIME)),
        graph
      ),
    ];

    await this.persistence.apply({ insert: quads.map(quad => this.serializeQuad(quad)).join('\n') });
    for (const quad of quads) this.store.add(quad);
    this.principalRecords.set(iri, { iri, rawClaim, kind });
  }

  /** Test seam: drops all state without touching persistence. */
  reset(): void {
    this.store = new oxigraph.Store();
    this.bootstrapAdmins = new Set();
    this.rebuildIndexes();
    this.loaded = false;
  }
}

let authStore: AuthStore | null = null;

export function getAuthStore(): AuthStore {
  if (!authStore) {
    authStore = new AuthStore();
  }
  return authStore;
}

export function setAuthStore(store: AuthStore | null): void {
  authStore = store;
}
