import type { FastifyInstance } from 'fastify';
import { RouteError } from './route-helpers.js';
import { registerVersionedEntityRoutes, type StoredEntity } from './versionedEntity.js';
import { createDataBlockSchema, updateDataBlockSchema } from '@sparql-query-lib/contracts/schema';
import { createDataBlockVersion, annotateDataBlockVersion } from '../lib/DataBlockVersionWriter.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';

export const dataBlockResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    currentVersion: { type: 'string', nullable: true },
    isPartOf: {
      type: 'array',
      items: { type: 'string' },
    },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    tags: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
  },
  required: ['id', 'name', 'isPartOf'],
  additionalProperties: false,
} as const;

const dataBlockVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    dataString: { type: 'string' },
    normalizedInsertData: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    grammarValid: { type: 'boolean', nullable: true },
    validationError: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'dataString'],
  additionalProperties: false,
} as const;

const createDataBlockVersionBodySchema = {
  type: 'object',
  properties: {
    dataString: { type: 'string' },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    allowInvalidSave: { type: 'boolean', nullable: true },
  },
  required: ['dataString'],
  additionalProperties: false,
} as const;


const annotateDataBlockVersionBodySchema = {
  type: 'object',
  properties: {
    dataString: { type: 'string', nullable: true },
    comment: { type: 'string', nullable: true },
    defaultBackend: { type: 'string', nullable: true },
    immutable: { type: 'boolean', nullable: true },
    allowInvalidSave: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

export default async function (fastify: FastifyInstance) {
  /*
   * Both lists are empty because this plugin mounts nothing they would reach:
   * no route here executes, and none is a stateless helper. They carried
   * `/execute`, `/execute/stream`, `/run`, `/preview` and `/preview/normalize`,
   * copied from a plugin that has them — an exemption with no route behind it
   * is not inert, it is one waiting for the first route whose path ends that
   * way (`/rule-sets` left `POST /:id/srl/preview` unguarded exactly so).
   */
  registerEntityAuthGuard(fastify, { executeSuffixes: [], exemptSuffixes: [] });

  registerVersionedEntityRoutes(fastify, {
    noun: 'data block',
    type: 'DataBlock',
    versionType: 'DataBlockVersion',
    idKind: 'dataBlock',
    schemas: {
      list: { tags: ['DataBlock'], summary: 'List data blocks', response: { 200: { type: 'array', items: dataBlockResponseSchema } } },
      create: { tags: ['DataBlock'], summary: 'Create data block', body: createDataBlockSchema.body, response: { 201: dataBlockResponseSchema } },
      get: { tags: ['DataBlock'], summary: 'Get data block', response: { 200: dataBlockResponseSchema } },
      update: { tags: ['DataBlock'], summary: 'Update data block', body: updateDataBlockSchema.body, response: { 200: dataBlockResponseSchema } },
      delete: { tags: ['DataBlock'], summary: 'Delete data block and all its versions (cascading delete)', response: { 204: { type: 'null' } } },
      listVersions: { tags: ['DataBlock'], summary: 'List data block versions', response: { 200: { type: 'array', items: dataBlockVersionResponseSchema } } },
      createVersion: { tags: ['DataBlock'], summary: 'Create data block version', body: createDataBlockVersionBodySchema, response: { 201: dataBlockVersionResponseSchema } },
      getVersion: { tags: ['DataBlock'], summary: 'Get data block version', response: { 200: dataBlockVersionResponseSchema } },
      patchVersion: {
        tags: ['DataBlock'],
        summary: 'Annotate a data block version (comment only; content is immutable)',
        body: annotateDataBlockVersionBodySchema,
        response: { 200: dataBlockVersionResponseSchema },
      },
      deleteVersion: { tags: ['DataBlock'], summary: 'Delete data block version', response: { 204: { type: 'null' } } },
    },
    createVersion: async ({ parent, body }) => {
      const dataString = String(body.dataString || '');
      if (!dataString.trim()) {
        throw new RouteError(400, { error: 'dataString must be provided' });
      }
      const created = await createDataBlockVersion(parent.$id, {
        dataString,
        comment: (body.comment as string | null | undefined) ?? null,
        defaultBackend: (body.defaultBackend as string | null | undefined) ?? null,
        immutable: (body.immutable as boolean | null | undefined) ?? undefined,
        allowInvalidSave: (body.allowInvalidSave as boolean | null | undefined) ?? undefined,
      });
      return { created: created as unknown as StoredEntity };
    },
    // A version is a snapshot (issue #192): `dataString` is what the block was
    // when it was saved, and a rule set version that names this version was
    // validated against exactly those triples. Only the comment is writable.
    annotateVersion: async (version, annotations) => await annotateDataBlockVersion(version.$id, {
      comment: annotations.comment as string | null | undefined,
      immutable: annotations.immutable as boolean | undefined,
    }) as unknown as StoredEntity,
  });
}
