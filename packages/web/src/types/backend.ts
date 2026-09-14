import type { Backend } from '@sparql-query-lib/contracts';

export type BackendFormInput = Pick<Backend, 'name' | 'description' | 'backendType' | 'endpoint' | 'authEnvKey' | 'queryMethod' | 'oxigraphConfig'>;
