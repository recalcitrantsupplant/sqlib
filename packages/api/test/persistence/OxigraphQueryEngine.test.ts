import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';
import { OxigraphQueryEngine } from '../../src/persistence/OxigraphQueryEngine.js';

function collectStream(stream: Readable): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const out: any[] = [];
    stream.on('data', (chunk) => out.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(out));
  });
}

describe('OxigraphQueryEngine', () => {
  it('streams bindings results', async () => {
    const bindings = [new Map([['?s', 'foo']]), new Map([['?s', 'bar']])];
    const store = { query: vi.fn(() => bindings) } as any;
    const engine = new OxigraphQueryEngine(store);

    const stream = await engine.queryBindings('SELECT *');
    const items = await collectStream(stream);

    expect(store.query).toHaveBeenCalledWith('SELECT *');
    expect(items).toEqual(bindings);
  });

  it('streams quad results', async () => {
    const quads = [{ subject: 's' }, { subject: 'o' }];
    const store = { query: vi.fn(() => quads) } as any;
    const engine = new OxigraphQueryEngine(store);

    const stream = await engine.queryQuads('CONSTRUCT { }');
    const items = await collectStream(stream);

    expect(items).toEqual(quads);
  });

  it('returns boolean responses correctly', async () => {
    const store = { query: vi.fn(() => true) } as any;
    const engine = new OxigraphQueryEngine(store);

    await expect(engine.queryBoolean('ASK { }')).resolves.toBe(true);
  });

  it('executes update operations', async () => {
    const store = { query: vi.fn(() => true), update: vi.fn() } as any;
    const engine = new OxigraphQueryEngine(store);

    await engine.queryVoid('INSERT DATA { }');
    expect(store.update).toHaveBeenCalledWith('INSERT DATA { }');
  });
});
