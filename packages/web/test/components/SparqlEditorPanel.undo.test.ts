import { describe, it, expect } from 'vitest';
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { mount } from '@vue/test-utils';
import { redo, undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';

import SparqlEditorPanel from '@/components/shared/SparqlEditorPanel.vue';
import { useEditorDocumentKey } from '@/composables/useEditorDocumentKey';

/**
 * The editor here is the real CodeMirror, not a textarea standing in for one:
 * the bug being pinned is in its undo history, which a stub does not have.
 */
const QUERY_A = 'SELECT * WHERE { ?a ?b ?c }';
const QUERY_B = 'ASK { ?s ?p ?o }';

function mountPanel(options: { keyed: boolean }) {
  const identity = ref('query-a');
  const code = ref(QUERY_A);
  // Shallow: a reactive proxy around the view hands `undo` a proxied state,
  // and CodeMirror refuses a transaction that did not start from its own.
  const view = shallowRef<EditorView | null>(null);
  const { documentKey, noteUserEdit } = useEditorDocumentKey(
    () => identity.value,
    () => code.value,
  );

  const Harness = defineComponent({
    setup() {
      return () =>
        h(SparqlEditorPanel, {
          editorTitle: 'Query Editor',
          chrome: 'minimal',
          sparqlCode: code.value,
          versionComment: '',
          selectedVersion: null,
          versionOptions: [],
          isNewEntity: false,
          isSaving: false,
          isLoading: false,
          editorOverlayActive: false,
          editorOverlayMessage: '',
          extensions: [],
          showQueryOutputs: false,
          documentKey: options.keyed ? documentKey.value : undefined,
          'onUpdate:sparqlCode': (value: string) => {
            noteUserEdit();
            code.value = value;
          },
          onEditorReady: (ready: EditorView) => {
            view.value = ready;
          },
        });
    },
  });

  const wrapper = mount(Harness, { attachTo: document.body });
  return { wrapper, identity, code, view, documentKey };
}

/** Types at the end of the document, the way a person would. */
function typeAtEnd(view: EditorView, text: string) {
  view.dispatch({ changes: { from: view.state.doc.length, insert: text } });
}

/** Selects another query: the id changes now, its body when the fetch lands. */
async function selectOtherQuery(
  identity: { value: string },
  code: { value: string },
  body: string,
) {
  identity.value = 'query-b';
  await nextTick();
  code.value = body;
  await nextTick();
}

describe('SparqlEditorPanel undo history', () => {
  it('leaves the previous query out of the undo history', async () => {
    const { wrapper, identity, code, view } = mountPanel({ keyed: true });
    await nextTick();

    typeAtEnd(view.value!, ' # mine');
    await nextTick();
    expect(code.value).toBe(`${QUERY_A} # mine`);

    await selectOtherQuery(identity, code, QUERY_B);
    expect(view.value!.state.doc.toString()).toBe(QUERY_B);

    undo(view.value!);
    await nextTick();

    // Nothing to undo: this document has not been edited yet, and the one that
    // was is not this one.
    expect(view.value!.state.doc.toString()).toBe(QUERY_B);
    expect(code.value).toBe(QUERY_B);

    wrapper.unmount();
  });

  it('still undoes and redoes edits made to the query on screen', async () => {
    const { wrapper, identity, code, view } = mountPanel({ keyed: true });
    await nextTick();

    await selectOtherQuery(identity, code, QUERY_B);
    typeAtEnd(view.value!, ' # mine');
    await nextTick();
    expect(code.value).toBe(`${QUERY_B} # mine`);

    undo(view.value!);
    await nextTick();
    expect(view.value!.state.doc.toString()).toBe(QUERY_B);
    expect(code.value).toBe(QUERY_B);

    redo(view.value!);
    await nextTick();
    expect(code.value).toBe(`${QUERY_B} # mine`);

    wrapper.unmount();
  });

  it('reproduces the quirk when the editor is not keyed to the document', async () => {
    const { wrapper, identity, code, view } = mountPanel({ keyed: false });
    await nextTick();

    typeAtEnd(view.value!, ' # mine');
    await nextTick();
    await selectOtherQuery(identity, code, QUERY_B);

    undo(view.value!);
    await nextTick();

    // What the report describes: one Ctrl-Z and the editor is showing a query
    // that was never selected — and says so through `update:sparqlCode`, which
    // is what puts it in the current query's draft.
    expect(view.value!.state.doc.toString()).toContain('SELECT');
    expect(code.value).toContain('SELECT');

    wrapper.unmount();
  });
});
