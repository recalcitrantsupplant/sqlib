declare module '@sparql-query-lib/api' {
  export const app: any;
  export const start: any;
  export const configureApp: any;
  // The ajv configuration fastify validates every request with. Phase C2 has the
  // MCP registry validate tool arguments with the same one, so a payload MCP
  // accepts is a payload the HTTP API accepts.
  export const createValidatorAjv: any;
  // Logger options for a Fastify instance built here, so its request logs carry
  // trace ids and follow the API's log destination.
  export const fastifyLoggerOptions: any;
}

// Imported for its side effect: starts OpenTelemetry when it is configured.
declare module '@sparql-query-lib/api/dist/otel-setup.js' {
  export const shutdownTelemetry: () => Promise<void>;
}
