/**
 * The draft gate: the assistant's write tools.
 *
 * These are the only writes the assistant has, and none of them reach the API.
 * They stage into the session and return a concrete draft id, which is the
 * whole mechanical argument for running the loop ourselves — the service holds
 * a fact about what it wrote, so the `changed` event the browser receives is
 * not something the client inferred from a tool name.
 *
 * A staged draft lands in the browser's `useCallableDrafts`, the same store the
 * sidebar dot, the header pill and the Build rows already read. One store means
 * a receipt cannot disagree with a row, which is the rule that store exists to
 * keep.
 *
 * There is no save tool, and adding one would be the mistake. §8 of the
 * screen design says saving "should probably require explicit user consent
 * rather than being assistant-callable"; consent is the Save button that
 * already exists, and the assistant simply has no way to press it.
 */
import { randomUUID } from 'node:crypto';
import type { ToolCallResult } from '@sparql-query-lib/tools';
import type { ListedTool } from '@sparql-query-lib/tools';
import { detectSparqlOperation } from '../lib/queryTypeDetector.js';
import { QueryTypeIri } from '../constants/queryTypes.js';

/** Scratch items are library-less until the save moment picks one. */
export const UNASSIGNED_LIBRARY_ID = 'unassigned';

export type StagedDraft = {
  id: string;
  /** 'draft' edits a saved entity; 'scratch' has no server identity yet. */
  kind: 'draft' | 'scratch';
  section: 'query';
  name: string;
  description: string | null;
  /** The SPARQL body. */
  body: string;
  /** The saved entity this is an edit of, when kind is 'draft'. */
  basedOn: string | null;
  libraryId: string;
  createdAt: string;
  updatedAt: string;
};

export interface DraftStore {
  list(): StagedDraft[];
  get(id: string): StagedDraft | null;
  put(draft: StagedDraft): void;
  remove(id: string): boolean;
}

export function createDraftStore(): DraftStore {
  const drafts = new Map<string, StagedDraft>();
  return {
    list: () => [...drafts.values()],
    get: (id) => drafts.get(id) ?? null,
    put: (draft) => {
      drafts.set(draft.id, draft);
    },
    remove: (id) => drafts.delete(id),
  };
}

export type DraftToolContext = {
  drafts: DraftStore;
  /** The library a save would land in — scratch inherits it, per the nav doc. */
  libraryId: string | null;
  /** Runs a read-only SPARQL body against a backend. */
  runSparql: (input: { query: string; backendId: string }) => Promise<ToolCallResult>;
};

const draftIdArg = { type: 'string', description: 'The id returned by drafts.createQuery' } as const;

/**
 * A staged body has to parse.
 *
 * Fail closed, the stance `drafts.runQuery` already takes before reaching a
 * backend, for the same reason: a body that does not parse is not a query. The
 * alternative was observed rather than imagined — an unparseable draft was
 * staged, the receipt went green, and the assistant told the user it had
 * written them a query. Nothing downstream contradicts a green receipt, so the
 * check belongs at the point the body arrives.
 *
 * The parser's own message goes back, because "invalid" tells the model nothing
 * it can act on and "Variable item used more than once in SELECT clause" tells
 * it everything.
 */
function assertParses(tool: string, queryString: string): void {
  try {
    detectSparqlOperation(queryString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${tool}: will not stage a body that does not parse — ${message}`);
  }
}

export const DRAFT_TOOL_DEFINITIONS: ListedTool[] = [
  {
    name: 'drafts.createQuery',
    title: 'Stage a query draft',
    description:
      'Stage a new SPARQL query as an unsaved draft. It appears in the user’s library immediately as a draft and is never saved to the server until the user presses Save. Returns the draft id.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A short human name for the query' },
        queryString: { type: 'string', description: 'The SPARQL body' },
        description: { type: 'string' },
        basedOn: {
          type: 'string',
          description: 'The id of an existing query this edits. Omit for a brand-new query.',
        },
      },
      required: ['name', 'queryString'],
      additionalProperties: false,
    },
  },
  {
    name: 'drafts.updateQuery',
    title: 'Update a query draft',
    description: 'Replace the body, name or description of a draft you already staged.',
    inputSchema: {
      type: 'object',
      properties: {
        draftId: draftIdArg,
        queryString: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['draftId'],
      additionalProperties: false,
    },
  },
  {
    name: 'drafts.list',
    title: 'List staged drafts',
    description: 'List the drafts staged in this session.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'drafts.discard',
    title: 'Discard a draft',
    description: 'Throw away a draft you staged.',
    inputSchema: {
      type: 'object',
      properties: { draftId: draftIdArg },
      required: ['draftId'],
      additionalProperties: false,
    },
  },
  {
    name: 'drafts.runQuery',
    title: 'Run a draft',
    description:
      'Run a staged draft against a backend to check it works. Read-only: SPARQL updates are refused. Use backends.list to find a backend id.',
    inputSchema: {
      type: 'object',
      properties: { draftId: draftIdArg, backendId: { type: 'string' } },
      required: ['draftId', 'backendId'],
      additionalProperties: false,
    },
  },
];

export const DRAFT_TOOL_NAMES: readonly string[] = DRAFT_TOOL_DEFINITIONS.map((tool) => tool.name);

/** What a draft tool did, so the caller can emit the right `changed` event. */
export type DraftToolOutcome = {
  text: string;
  /** Set when a draft was created or updated. */
  changed?: StagedDraft;
  /** Set when a draft was discarded. */
  removed?: string;
};

function nowIso() {
  return new Date().toISOString();
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function callDraftTool(
  name: string,
  args: Record<string, unknown>,
  context: DraftToolContext
): Promise<DraftToolOutcome> {
  switch (name) {
    case 'drafts.createQuery': {
      const queryName = asString(args.name)?.trim();
      const queryString = asString(args.queryString);
      if (!queryName) throw new Error('drafts.createQuery: name is required');
      if (!queryString?.trim()) throw new Error('drafts.createQuery: queryString is required');
      assertParses('drafts.createQuery', queryString);

      const basedOn = asString(args.basedOn) ?? null;
      const draft: StagedDraft = {
        id: `urn:ui-temp:${randomUUID()}`,
        // Editing something saved is a draft of it; anything else is
        // scratch, and scratch has no library until save.
        kind: basedOn ? 'draft' : 'scratch',
        section: 'query',
        name: queryName,
        description: asString(args.description) ?? null,
        body: queryString,
        basedOn,
        libraryId: basedOn ? (context.libraryId ?? UNASSIGNED_LIBRARY_ID) : UNASSIGNED_LIBRARY_ID,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      context.drafts.put(draft);
      return {
        changed: draft,
        text: JSON.stringify(
          {
            draftId: draft.id,
            status: 'staged',
            note: 'Not saved to the server. The user saves it from the Build screen.',
          },
          null,
          2
        ),
      };
    }

    case 'drafts.updateQuery': {
      const draftId = asString(args.draftId);
      const existing = draftId ? context.drafts.get(draftId) : null;
      if (!existing) throw new Error(`drafts.updateQuery: no staged draft with id ${draftId ?? '(missing)'}`);

      // Only when a body is being replaced: renaming a draft must not be
      // refused because of a body this call is not touching.
      const nextBody = asString(args.queryString);
      if (nextBody !== undefined) assertParses('drafts.updateQuery', nextBody);

      const updated: StagedDraft = {
        ...existing,
        name: asString(args.name)?.trim() || existing.name,
        description: asString(args.description) ?? existing.description,
        body: nextBody ?? existing.body,
        updatedAt: nowIso(),
      };
      context.drafts.put(updated);
      return { changed: updated, text: JSON.stringify({ draftId: updated.id, status: 'staged' }, null, 2) };
    }

    case 'drafts.list': {
      const listed = context.drafts.list().map((draft) => ({
        draftId: draft.id,
        name: draft.name,
        kind: draft.kind,
        basedOn: draft.basedOn,
      }));
      return { text: JSON.stringify(listed, null, 2) };
    }

    case 'drafts.discard': {
      const draftId = asString(args.draftId);
      if (!draftId || !context.drafts.remove(draftId)) {
        throw new Error(`drafts.discard: no staged draft with id ${draftId ?? '(missing)'}`);
      }
      return { removed: draftId, text: JSON.stringify({ draftId, status: 'discarded' }, null, 2) };
    }

    case 'drafts.runQuery': {
      const draftId = asString(args.draftId);
      const backendId = asString(args.backendId);
      const draft = draftId ? context.drafts.get(draftId) : null;
      if (!draft) throw new Error(`drafts.runQuery: no staged draft with id ${draftId ?? '(missing)'}`);
      if (!backendId) throw new Error('drafts.runQuery: backendId is required');

      /*
       * The one place the assistant reaches a real backend with a body it wrote.
       * `/sparql` executes updates, so refusing anything that is not a read is
       * what keeps this from being a write channel around the draft gate.
       */
      let operation: string;
      try {
        operation = detectSparqlOperation(draft.body);
      } catch (error) {
        // Fail closed. If we cannot tell what the body is, we do not send it to
        // a backend — an unparseable body is the assistant's to fix, not the
        // triplestore's to interpret.
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`drafts.runQuery: will not run a body that does not parse — ${message}`);
      }
      if (operation === QueryTypeIri.update) {
        throw new Error(
          'drafts.runQuery: refusing to run a SPARQL update. Only read queries can be run from a draft.'
        );
      }

      const result = await context.runSparql({ query: draft.body, backendId });
      return { text: result.text };
    }

    default:
      throw new Error(`Unknown draft tool: ${name}`);
  }
}
