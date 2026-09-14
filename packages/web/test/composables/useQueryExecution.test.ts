import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { QueryTypeIri } from '@sparql-query-lib/types';
import { useQueryExecution } from '@/composables/useQueryExecution';

/**
 * What a run sends, and in particular whether it sends the arguments.
 *
 * A query with unsaved edits — or one never saved at all — runs as text
 * through `POST /sparql`, because there is no version for `POST /execute` to
 * name. That path used to drop the arguments panel's values on the floor: a
 * `VALUES (?city) { (UNDEF) }` left unbound returns every row, so the query
 * appeared to run and quietly ignored what the user had typed.
 */

const RESPONSE = {
  body: JSON.stringify({ head: { vars: [] }, results: { bindings: [] } }),
  contentType: 'application/sparql-results+json',
};

const PATCH_RESPONSE = {
  body: 'H id <urn:uuid:1>\nD <http://ex/a> <http://ex/status> "draft" .\n',
  contentType: 'text/rdf-patch',
};

const PAYLOAD = {
  arguments: [
    {
      head: { vars: ['city'] },
      arguments: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Paris' } }] },
    },
  ],
  limits: [{ name: '1', value: 10 }],
};

function harness(overrides: Record<string, unknown> = {}) {
  const executeTarget = vi.fn().mockResolvedValue(RESPONSE);
  const executeSparqlDirect = vi.fn().mockResolvedValue(RESPONSE);
  const previewUpdatePatch = vi.fn().mockResolvedValue(PATCH_RESPONSE);
  const execution = useQueryExecution({
    apiClient: { executeTarget, executeSparqlDirect, previewUpdatePatch },
    toast: { success: vi.fn(), error: vi.fn() },
    queryId: ref('urn:query:1'),
    selectedBackend: ref('urn:backend:1'),
    selectedMediaType: ref('application/sparql-results+json'),
    selectedVersion: ref(null),
    currentVersion: ref('urn:query-version:1'),
    queryCode: ref('SELECT ?city WHERE { VALUES (?city) { (UNDEF) } ?city ?p ?o }'),
    isDirty: ref(false),
    getSelectedArgumentSetId: () => null,
    getInlineArguments: () => null,
    getAdHocArguments: () => PAYLOAD,
    ...overrides,
  } as Parameters<typeof useQueryExecution>[0]);
  return { execution, executeTarget, executeSparqlDirect, previewUpdatePatch };
}

describe('useQueryExecution', () => {
  /**
   * An update's one output is the diff it would make (#290). Picking it has to
   * change *which call* a run makes, not just the Accept header: the proxy runs
   * an update, and the whole point of the format is that nothing is written.
   */
  describe('an update asked for its patch', () => {
    const asUpdate = {
      queryCode: ref('DELETE { ?s <http://ex/status> "draft" } WHERE { ?s <http://ex/status> "draft" }'),
      queryType: ref(QueryTypeIri.update),
      selectedMediaType: ref('text/rdf-patch'),
      isDirty: ref(true),
    };

    it('derives it instead of running the update', async () => {
      const { execution, previewUpdatePatch, executeSparqlDirect } = harness(asUpdate);

      await execution.executeQuery();

      expect(executeSparqlDirect).not.toHaveBeenCalled();
      expect(previewUpdatePatch).toHaveBeenCalledWith({
        updateString: asUpdate.queryCode.value,
        backendId: 'urn:backend:1',
      });
      expect(execution.executionResult.value?.contentType).toBe('text/rdf-patch');
    });

    it('still runs the update when another format is picked', async () => {
      const { execution, previewUpdatePatch, executeSparqlDirect } = harness({
        ...asUpdate,
        selectedMediaType: ref('application/sparql-results+json'),
      });

      await execution.executeQuery();

      expect(previewUpdatePatch).not.toHaveBeenCalled();
      expect(executeSparqlDirect).toHaveBeenCalled();
    });

    it('names the saved version when there is one, so /execute derives it', async () => {
      const { execution, executeTarget, previewUpdatePatch } = harness({
        ...asUpdate,
        isDirty: ref(false),
      });

      await execution.executeQuery();

      expect(previewUpdatePatch).not.toHaveBeenCalled();
      expect(executeTarget).toHaveBeenCalledWith(expect.anything(), 'text/rdf-patch');
    });
  });

  it('sends the values on screen with an edited query, which runs ad-hoc', async () => {
    const { execution, executeSparqlDirect, executeTarget } = harness({ isDirty: ref(true) });

    await execution.executeQuery();

    expect(executeTarget).not.toHaveBeenCalled();
    expect(executeSparqlDirect).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('VALUES'),
        backendId: 'urn:backend:1',
        arguments: PAYLOAD.arguments,
        limits: PAYLOAD.limits,
      }),
      'application/sparql-results+json',
    );
  });

  it('sends them for a query that was never saved either', async () => {
    const { execution, executeSparqlDirect } = harness({ currentVersion: ref(null) });

    await execution.executeQuery();

    expect(executeSparqlDirect).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: PAYLOAD.arguments }),
      expect.anything(),
    );
  });

  it('still names the saved version when there is nothing to run ad-hoc', async () => {
    const { execution, executeTarget, executeSparqlDirect } = harness({
      getSelectedArgumentSetId: () => 'urn:argument-set-version:1',
    });

    await execution.executeQuery();

    expect(executeSparqlDirect).not.toHaveBeenCalled();
    expect(executeTarget).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'urn:query:1',
        argumentSetIds: ['urn:argument-set-version:1'],
      }),
      'application/sparql-results+json',
    );
  });

  it('falls back to the draft payload when no ad-hoc getter is wired', async () => {
    const { execution, executeSparqlDirect } = harness({
      isDirty: ref(true),
      getAdHocArguments: undefined,
      getInlineArguments: () => PAYLOAD,
    });

    await execution.executeQuery();

    expect(executeSparqlDirect).toHaveBeenCalledWith(
      expect.objectContaining({ arguments: PAYLOAD.arguments }),
      expect.anything(),
    );
  });
});
