<template>
  <SparqlEditorPanel
    editor-title="Query Editor"
    :sparql-code="queryCode"
    :selected-version="selectedVersion"
    :version-options="versionOptions"
    :is-new-entity="isNewQuery"
    :is-saving="isSaving"
    :is-loading="queryLoading"
    :editor-overlay-active="editorOverlayActive"
    :editor-overlay-message="editorOverlayMessage"
    :editor-height="editorHeight"
    :document-key="documentKey"
    :extensions="extensions"
    :show-execution-row="true"
    :selected-backend="selectedBackend"
    :backend-options="backendOptions"
    :selected-media-type="selectedMediaType"
    :backends-loading="backendsLoading"
    @update:sparql-code="emit('update:queryCode', $event)"
    @update:selected-version="emit('update:selectedVersion', $event)"
    @save="emit('save-query')"
    @save-new-version="emit('save-new-version')"
    @delete="emit('delete-query')"
    @clone="emit('clone-query')"
    @move="emit('move-query')"
    @request-focus="emit('request-focus')"
    @update:selected-backend="emit('update:selectedBackend', $event)"
    @update:selected-media-type="emit('update:selectedMediaType', $event)"
    @execute="emit('execute-query')"
    @request-code-dialog="emit('request-code-dialog')"
    @request-benchmark="emit('request-benchmark')"
  />
</template>

<script setup lang="ts">
import type { Extension } from '@codemirror/state';
import SparqlEditorPanel from '../shared/SparqlEditorPanel.vue';

type BackendOption = { value: string; label: string };
type VersionOption = { value: string; label: string; dateModified?: string | null };

const emit = defineEmits<{
  (e: 'update:queryCode', value: string): void;
  (e: 'update:selectedBackend', value: string): void;
  (e: 'update:selectedVersion', value: string): void;
  (e: 'update:selectedMediaType', value: string): void;
  (e: 'save-query'): void;
  (e: 'save-new-version'): void;
  (e: 'delete-query'): void;
  (e: 'clone-query'): void;
  (e: 'move-query'): void;
  (e: 'request-focus'): void;
  (e: 'request-code-dialog'): void;
  (e: 'request-benchmark'): void;
  (e: 'execute-query'): void;
}>();

defineProps<{
  queryCode: string;
  selectedBackend: string;
  backendOptions: BackendOption[];
  selectedMediaType: string;
  selectedVersion: string | null;
  versionOptions: VersionOption[];
  isNewQuery: boolean;
  isSaving: boolean;
  queryLoading: boolean;
  backendsLoading: boolean;
  editorOverlayActive: boolean;
  editorOverlayMessage: string;
  editorHeight: number;
  /** Names the document in the editor; see `useEditorDocumentKey`. */
  documentKey?: string | null;
  extensions: Extension[];
}>();
</script>
