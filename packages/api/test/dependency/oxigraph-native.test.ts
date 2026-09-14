import { describe, it, expect } from 'vitest';
import oxigraph from 'oxigraph';

/**
 * Dependency Sanity Checks
 * 
 * These tests verify that critical native dependencies (like oxigraph) 
 * are correctly installed and functioning in the current environment.
 */
describe('Oxigraph Native Dependency', () => {
  
  it('should instantiate a Store', () => {
    const store = new oxigraph.Store();
    expect(store).toBeDefined();
    expect(store.size).toBe(0);
  });

  it('should load and query triples (smoke test)', () => {
    const store = new oxigraph.Store();
    const triple = '<http://example.org/s> <http://example.org/p> <http://example.org/o> .';
    
    store.load(triple, { format: 'nt' });
    expect(store.size).toBe(1);

    const results = store.query('SELECT * WHERE { ?s ?p ?o }');
    
    // Verify it's an array (SELECT query result)
    expect(Array.isArray(results)).toBe(true);
    
    if (Array.isArray(results)) {
      expect(results).toHaveLength(1);
      const binding = results[0];
      
      expect(binding.get('s')?.value).toBe('http://example.org/s');
      expect(binding.get('p')?.value).toBe('http://example.org/p');
      expect(binding.get('o')?.value).toBe('http://example.org/o');
    }
  });

  it('should handle basic SPARQL syntax', () => {
    const store = new oxigraph.Store();
    // Simple query parse check
    expect(() => store.query('SELECT * WHERE { ?s ?p ?o } LIMIT 1')).not.toThrow();
  });
});
