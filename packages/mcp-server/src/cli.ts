import { startStreamableHttpMcpServer } from './http-server.js';
import { startStdioMcpServer } from './index.js';
import { startDualHttpServer } from './dual-http-server.js';

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

async function main() {
  const mode = resolveTransportMode();
  const cleanupFns: Array<() => Promise<void>> = [];

  // Patch console.log early for stdio mode before any imports/initialization
  if (mode === 'stdio') {
    patchConsoleForStdio();
  }

  if (mode === 'dual-http') {
    const { shutdown, host, port } = await startDualHttpServer();
    cleanupFns.push(shutdown);
    // eslint-disable-next-line no-console
    console.log(`Dual HTTP server listening on http://${host}:${port} (API + MCP at /mcp)`);
  } else if (mode === 'streamable-http') {
    const { shutdown, host, port } = await startStreamableHttpMcpServer();
    cleanupFns.push(shutdown);
    // eslint-disable-next-line no-console
    console.log(`MCP server (streamable HTTP) listening on http://${host}:${port}/mcp`);
  } else {
    const { shutdown } = await startStdioMcpServer();
    cleanupFns.push(shutdown);
    // eslint-disable-next-line no-console
    console.error('MCP server running over stdio (local dev default)');
  }

  const cleanup = async () => {
    for (const fn of cleanupFns) {
      try {
        await fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error during MCP shutdown', err);
      }
    }
  };

  const handleSignal = (signal: NodeJS.Signals) => {
    // eslint-disable-next-line no-console
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
  // eslint-disable-next-line no-console
  console.error('Failed to start MCP server', err);
  process.exit(1);
});
