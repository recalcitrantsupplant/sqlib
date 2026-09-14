/**
 * Compiling a library's query groups into an export bundle.
 *
 * A group's nodes run queries, and a query in a bundle is a compiled template —
 * so exporting a group is mostly the query export again, pointed at the versions
 * the group's nodes pin rather than at each query's current version. Those are
 * often the same text, which is why a node reuses an existing bundle entry when
 * it pins the version that entry was compiled from, and adds one when it does
 * not. The group itself is then three lists of keys.
 *
 * A group is committed all at once. Compiling its nodes into a staging map first
 * means a group that turns out to be un-exportable halfway through leaves no
 * half-added queries behind — the bundle either carries the whole group or knows
 * nothing about it.
 *
 * See `docs/guides/static-export.md`.
 */

import type {
  ExportBundle,
  ExportedGroup,
  ExportedGroupEdge,
  ExportedQuery,
} from '@sparql-query-lib/runtime';
import { SparqlQueryParser } from '../parser.js';
import { QueryExportError, compileExportQuery, slugify } from './queryBundle.js';
import type { ExportGroupInput, SkippedGroup } from './collectLibraryGroups.js';

export interface AttachGroupsOptions {
  parser?: SparqlQueryParser;
}

/** A node's query as it will appear in the bundle: an existing key, or a new entry. */
interface StagedNode {
  key: string;
  query?: ExportedQuery;
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/**
 * Reserve a bundle key for a query the group brought in.
 *
 * Collides with the library's own queries deliberately rather than
 * namespacing: two entries for the same name are two queries, and the numeric
 * suffix is the same answer `buildExportBundle` gives.
 */
function reserveKey(name: string, taken: Set<string>): string {
  const base = slugify(name);
  let key = base;
  for (let suffix = 2; taken.has(key); suffix++) key = `${base}-${suffix}`;
  taken.add(key);
  return key;
}

/**
 * Compile one group's nodes and edges, or explain why it cannot be exported.
 *
 * Throws {@link QueryExportError} — the caller turns it into a skip, because an
 * un-exportable group is reported rather than fatal (see `collectLibraryGroups`).
 */
async function compileGroup(
  group: ExportGroupInput,
  bundle: ExportBundle,
  staged: Map<string, StagedNode>,
  keys: Set<string>,
  parser: SparqlQueryParser,
): Promise<ExportedGroup> {
  // Existing entries are reused by the version they were compiled from: same
  // QueryVersion, same text, same spans, so a second copy would only be a second
  // thing to keep in step.
  const byVersion = new Map<string, string>();
  for (const [key, query] of Object.entries(bundle.queries)) {
    if (query.sourceVersion) byVersion.set(query.sourceVersion, key);
  }

  const nodes: Record<string, { query: string; sourceNode?: string }> = {};
  const local = new Map<string, StagedNode>();

  for (const node of group.nodes) {
    const existing =
      byVersion.get(node.sourceVersion) ??
      staged.get(node.sourceVersion)?.key ??
      local.get(node.sourceVersion)?.key;
    if (existing) {
      nodes[node.key] = { query: existing, sourceNode: node.sourceNode };
      continue;
    }

    const compiled = await compileExportQuery(
      {
        name: node.name,
        queryString: node.queryString,
        ...(node.sourceQuery ? { sourceQuery: node.sourceQuery } : {}),
        sourceVersion: node.sourceVersion,
        ...(node.tags ? { tags: node.tags } : {}),
        ...(node.description ? { description: node.description } : {}),
      },
      parser,
    );
    const key = reserveKey(node.name, keys);
    local.set(node.sourceVersion, { key, query: compiled });
    nodes[node.key] = { query: key, sourceNode: node.sourceNode };
  }

  const queryFor = (nodeKey: string): ExportedQuery => {
    const key = nodes[nodeKey].query;
    const staging = [...local.values(), ...staged.values()].find((entry) => entry.key === key);
    return staging?.query ?? bundle.queries[key];
  };

  const edges: ExportedGroupEdge[] = group.edges.map((edge) => {
    const source = queryFor(edge.from);
    if (source.queryType !== 'SELECT') {
      throw new QueryExportError(
        `Group '${group.name}' chains a ${source.queryType} out of node '${edge.from}', which produces no rows to splice.`,
      );
    }

    // The stored tuple and the query text can drift: a slot renamed in the text
    // leaves the tuple naming variables the query no longer declares, and the
    // runtime would have no slot to fill. Catch it here, where the group can be
    // named, rather than in the runtime's structural check at someone's site.
    const target = queryFor(edge.to);
    if (!target.template.slots.some((slot) => sameOrder(slot.vars, edge.targetVars))) {
      throw new QueryExportError(
        `Group '${group.name}' feeds [${edge.targetVars.join(', ')}] into node '${edge.to}', whose query declares no such parameter slot. The node's input tuple and its query text have drifted apart.`,
      );
    }

    return {
      from: edge.from,
      to: edge.to,
      targetVars: edge.targetVars,
      mappings: edge.mappings,
      ...(edge.whenEmpty ? { whenEmpty: edge.whenEmpty } : {}),
      sourceEdge: edge.sourceEdge,
    };
  });

  // Only now, with every node compiled and every edge checked, do the group's
  // new queries become part of the bundle.
  for (const [version, entry] of local) staged.set(version, entry);

  return {
    name: group.name,
    ...(group.description ? { description: group.description } : {}),
    nodes,
    edges,
    resultNode: group.resultNode,
    ...(group.tags && group.tags.length > 0 ? { tags: group.tags } : {}),
    sourceGroup: group.sourceGroup,
    sourceVersion: group.sourceVersion,
  };
}

/**
 * Add compiled groups to a bundle, along with any query they brought with them.
 *
 * Mutates and returns the bundle, as `attachExamplesToBundle` does, so the route
 * builds one artifact rather than merging two.
 */
export async function attachGroupsToBundle(
  bundle: ExportBundle,
  groups: readonly ExportGroupInput[],
  options: AttachGroupsOptions = {},
): Promise<{ bundle: ExportBundle; skipped: SkippedGroup[] }> {
  if (groups.length === 0) return { bundle, skipped: [] };

  const parser = options.parser ?? new SparqlQueryParser();
  const keys = new Set(Object.keys(bundle.queries));
  const staged = new Map<string, StagedNode>();
  const compiled: Record<string, ExportedGroup> = {};
  const groupKeys = new Set<string>();
  const skipped: SkippedGroup[] = [];

  for (const group of groups) {
    try {
      const exported = await compileGroup(group, bundle, staged, keys, parser);
      compiled[reserveKey(group.name, groupKeys)] = exported;
    } catch (error) {
      if (error instanceof QueryExportError) {
        skipped.push({ id: group.sourceGroup, name: group.name, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  for (const entry of staged.values()) {
    if (entry.query) bundle.queries[entry.key] = entry.query;
  }
  if (Object.keys(compiled).length > 0) {
    bundle.groups = { ...(bundle.groups ?? {}), ...compiled };
  }

  return { bundle, skipped };
}
