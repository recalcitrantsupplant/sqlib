import { Store, Quad, Term } from 'oxigraph';
import { Readable } from 'stream';
import { markStoreWritten } from '../lib/storeWrites.js';

export class OxigraphQueryEngine {
  private storeFactory: () => Promise<Store>;
  private storePromise: Promise<Store> | null = null;

  constructor(storeOrFactory?: Store | (() => Promise<Store> | Store)) {
    if (typeof storeOrFactory === 'function') {
      this.storeFactory = async () => {
        const store = await storeOrFactory();
        if (!(store instanceof Store)) {
          throw new Error('OxigraphQueryEngine factory must return an oxigraph Store instance');
        }
        return store;
      };
    } else {
      const store = storeOrFactory ?? new Store();
      this.storeFactory = () => Promise.resolve(store);
    }
  }

  private getStore(): Promise<Store> {
    if (!this.storePromise) {
      this.storePromise = this.storeFactory();
    }
    return this.storePromise;
  }

  queryBindings(query: string): Promise<Readable> {
    return (async () => {
      const store = await this.getStore();
      const results = store.query(query);
      if (typeof results === 'boolean' || typeof results === 'string') {
        throw new Error('Unexpected query result type for bindings');
      }
      const readable = new Readable({
        objectMode: true,
        read() {
          for (const binding of results as Map<string, Term>[]) {
            this.push(binding);
          }
          this.push(null);
        },
      });
      return readable;
    })();
  }

  queryQuads(query: string): Promise<Readable> {
    return (async () => {
      const store = await this.getStore();
      const results = store.query(query);
      if (typeof results === 'boolean' || typeof results === 'string') {
        throw new Error('Unexpected query result type for quads');
      }
      const readable = new Readable({
        objectMode: true,
        read() {
          for (const quad of results as Quad[]) {
            this.push(quad);
          }
          this.push(null);
        },
      });
      return readable;
    })();
  }

  async queryBoolean(query: string): Promise<boolean> {
    const store = await this.getStore();
    return store.query(query) as boolean;
  }

  async queryVoid(query: string): Promise<void> {
    const store = await this.getStore();
    store.update(query);
    // The store arrives from a factory, so this engine cannot know whether it
    // is one the store manager checkpoints. Declaring the write costs a map
    // entry and removes the question (#443).
    markStoreWritten(store);
  }
}
