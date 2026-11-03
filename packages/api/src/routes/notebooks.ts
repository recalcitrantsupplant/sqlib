/**
 * `/notebooks` — prose and cells over the library's entities, saved.
 *
 * The pointer + immutable version pattern every library entity uses: a
 * Notebook carries the name and the library, a NotebookVersion the document.
 * Unsaved edits stay in the browser as a draft layered on the saved notebook,
 * the way a query's do, so a version is cut only when someone presses Save.
 * Access is the library's, through the same guard as every other entity.
 */
import type { FastifyInstance } from 'fastify';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { createNotebookSchema, updateNotebookSchema } from '@sparql-query-lib/contracts/schema';
import { annotateNotebookVersion, createNotebookVersion } from '../lib/NotebookVersionWriter.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';

export const notebookResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    currentVersion: { type: 'string', nullable: true },
    currentVersionNumber: { type: 'integer', nullable: true },
    isPartOf: { type: 'array', items: { type: 'string' } },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    createdBy: { type: 'string', nullable: true },
    modifiedBy: { type: 'string', nullable: true },
    tags: { type: 'array', items: { type: 'string' }, nullable: true },
  },
  required: ['id', 'name', 'isPartOf'],
  additionalProperties: false,
} as const;

const notebookVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    contentString: { type: 'string' },
    byteSize: { type: 'integer', nullable: true },
    comment: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    createdBy: { type: 'string', nullable: true },
    modifiedBy: { type: 'string', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'contentString'],
  additionalProperties: false,
} as const;

const createNotebookVersionBodySchema = {
  type: 'object',
  properties: {
    contentString: { type: 'string' },
    comment: { type: 'string', nullable: true },
  },
  required: ['contentString'],
  additionalProperties: false,
} as const;

/** Content is accepted by the wire schema so the handler can answer it with the 409 that says why. */
const annotateNotebookVersionBodySchema = {
  type: 'object',
  properties: {
    contentString: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
  },
  additionalProperties: false,
} as const;

export default async function (fastify: FastifyInstance) {
  // Nothing here executes and nothing is a stateless helper, so nothing is exempt.
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  registerVersionedEntityRoutes(fastify, {
    noun: 'notebook',
    type: 'Notebook',
    versionType: 'NotebookVersion',
    idKind: 'notebook',
    schemas: {
      list: { tags: ['Notebook'], summary: 'List notebooks', response: { 200: { type: 'array', items: notebookResponseSchema } } },
      create: { tags: ['Notebook'], summary: 'Create notebook', body: createNotebookSchema.body, response: { 201: notebookResponseSchema } },
      get: { tags: ['Notebook'], summary: 'Get notebook', response: { 200: notebookResponseSchema } },
      update: { tags: ['Notebook'], summary: 'Update notebook', body: updateNotebookSchema.body, response: { 200: notebookResponseSchema } },
      delete: { tags: ['Notebook'], summary: 'Delete notebook and all its versions (cascading delete)', response: { 204: { type: 'null' } } },
      listVersions: { tags: ['Notebook'], summary: 'List notebook versions', response: { 200: { type: 'array', items: notebookVersionResponseSchema } } },
      createVersion: { tags: ['Notebook'], summary: 'Save a notebook version', body: createNotebookVersionBodySchema, response: { 201: notebookVersionResponseSchema } },
      getVersion: { tags: ['Notebook'], summary: 'Get notebook version', response: { 200: notebookVersionResponseSchema } },
      patchVersion: {
        tags: ['Notebook'],
        summary: 'Annotate a notebook version (comment only; content is immutable)',
        body: annotateNotebookVersionBodySchema,
        response: { 200: notebookVersionResponseSchema },
      },
      deleteVersion: { tags: ['Notebook'], summary: 'Delete notebook version', response: { 204: { type: 'null' } } },
    },
    createVersion: async ({ parent, body }) => {
      const created = await createNotebookVersion(parent.$id, {
        contentString: String(body.contentString ?? ''),
        comment: (body.comment as string | null | undefined) ?? null,
      });
      return { created: created as unknown as StoredEntity };
    },
    annotateVersion: async (version, annotations) => await annotateNotebookVersion(version.$id, {
      comment: annotations.comment as string | null | undefined,
    }) as unknown as StoredEntity,
  });
}
