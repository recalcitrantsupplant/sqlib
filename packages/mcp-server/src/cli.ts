// The server modules are imported with `import()` inside `main`, after
// `loadTelemetry`: they import Fastify, and the OpenTelemetry Fastify
// instrumentation only sees instances built after the SDK has started.
import 'dotenv/config';

type TransportMode = 'stdio' | 'streamable-http' | 'dual-http';

// For stdio mode, redirect all console.log to stderr to keep stdout clean for JSON-RPC
function patchConsoleForStdio() {
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    console.error(...args);
  };
  return () => {
    console.log = originalLog;
  };
}

function resolveTransportMode(): TransportMode {
  const fromEnv = (process.env.MCP_TRANSPORT ?? '').toLowerCase();
  if (fromEnv === 'stdio') return 'stdio';
  if (fromEnv === 'dual-http' || fromEnv === 'http+api') return 'dual-http';
  if (fromEnv === 'http' || fromEnv === 'streamable-http') return 'streamable-http';
  return process.env.NODE_ENV === 'production' ? 'streamable-http' : 'stdio';
}

/**
 * Start the API's OpenTelemetry bootstrap before any server module loads. It
 * decides for itself whether telemetry is on (see `otel-setup.ts` in the API);
 * with it off this loads one small module and starts nothing. Resolved the
 * same way `dual-http-server.ts` resolves the API: the source checkout outside
 * production, the built package inside it.
 */
async function loadTelemetry(): Promise<void> {
  const sourcePath = new URL('../../api/src/otel-setup.ts', import.meta.url).href;
  if (process.env.NODE_ENV !== 'production') {
    try {
      await import(sourcePath);
      return;
    } catch {
      // No source checkout beside us; fall through to the package.
    }
  }
  try {
    await import('@sparql-query-lib/api/dist/otel-setup.js');
  } catch (error) {
    console.error('Could not start OpenTelemetry; continuing without it.', error);
  }
}

async function main() {
  const mode = resolveTransportMode();
  await loadTelemetry();
  const cleanupFns: Array<() => Promise<void>> = [];

  // Patch console.log early for stdio mode before any imports/initialization
  if (mode === 'stdio') {
    patchConsoleForStdio();
  }

  if (mode === 'dual-http') {
    const { startDualHttpServer } = await import('./dual-http-server.js');
    const { shutdown, host, port } = await startDualHttpServer();
    cleanupFns.push(shutdown);
    console.log(`Dual HTTP server listening on http://${host}:${port} (API + MCP at /mcp)`);
  } else if (mode === 'streamable-http') {
    const { startStreamableHttpMcpServer } = await import('./http-server.js');
    const { shutdown, host, port } = await startStreamableHttpMcpServer();
    cleanupFns.push(shutdown);
    console.log(`MCP server (streamable HTTP) listening on http://${host}:${port}/mcp`);
  } else {
    const { startStdioMcpServer } = await import('./index.js');
    const { shutdown } = await startStdioMcpServer();
    cleanupFns.push(shutdown);
    console.error('MCP server running over stdio (local dev default)');
  }

  const cleanup = async () => {
    for (const fn of cleanupFns) {
      try {
        await fn();
      } catch (err) {
        console.error('Error during MCP shutdown', err);
      }
    }
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    console.error(`Received ${signal}, shutting down MCP server...`);
    cleanup()
      .catch(() => {
        /* ignore */
      })
      .finally(() => process.exit(0));
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);
}

main().catch((err) => {
  console.error('Failed to start MCP server', err);
  process.exit(1);
});
