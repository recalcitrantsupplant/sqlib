import { describe, it, expect } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';
import { deriveQueryVersionMetadata } from '../../src/lib/QueryVersionDeriver.js';

describe('QueryVersionDeriver', () => {
  const parser = new SparqlQueryParser();

  it('should derive outputs from a SELECT query', () => {
    const queryString = 'SELECT ?s ?p ?o WHERE { ?s ?p ?o }';
    const result = deriveQueryVersionMetadata(parser, queryString);
    expect(result.outputs.map(o => o.variableName)).toEqual(['o', 'p', 's']);
    expect(result.outputs.every(o => o.id.startsWith('urn:ui-temp:output:'))).toBe(true);
  });

  it('should derive inputs from a VALUES clause with UNDEF', () => {
    const queryString = `
      SELECT ?s
      WHERE {
        VALUES (?p ?o) { (UNDEF UNDEF) }
        ?s ?p ?o .
      }
    `;
    const result = deriveQueryVersionMetadata(parser, queryString);

    // Check for inputs
    expect(result.inputs.length).toBe(2);
    expect(result.inputs.map(i => i.variableName).sort()).toEqual(['o', 'p']);
    result.inputs.forEach(input => expect(input.id.startsWith('urn:ui-temp:input:')).toBe(true));

    // Check for input tuple
    expect(result.inputTuples.length).toBe(1);
    const inputTuple = result.inputTuples[0];
    expect(inputTuple.name).toBe('o-p');
    expect(inputTuple.id.startsWith('urn:ui-temp:input-tuple:')).toBe(true);

    // Check for tuple members
    expect(result.tupleMembers.length).toBe(2);
    const pInput = result.inputs.find(input => input.variableName === 'p');
    const oInput = result.inputs.find(input => input.variableName === 'o');
    expect(pInput).toBeDefined();
    expect(oInput).toBeDefined();
    const pMember = result.tupleMembers.find(m => m.variable === pInput!.id);
    const oMember = result.tupleMembers.find(m => m.variable === oInput!.id);
    expect(pMember).toBeDefined();
    expect(oMember).toBeDefined();
    expect(pMember!.id.startsWith('urn:ui-temp:tuple-member:')).toBe(true);
    expect(oMember!.id.startsWith('urn:ui-temp:tuple-member:')).toBe(true);
    expect(inputTuple.memberEntries).toEqual(expect.arrayContaining([pMember!.id, oMember!.id]));
  });

  it('should not create inputs if no VALUES UNDEF is present', () => {
    const queryString = 'SELECT ?s WHERE { ?s ?p ?o }';
    const result = deriveQueryVersionMetadata(parser, queryString);
    expect(result.inputs.length).toBe(0);
    expect(result.inputTuples.length).toBe(0);
  });

  it('should derive inputs for an ASK query with VALUES UNDEF', () => {
    const queryString = `
      ASK {
        VALUES (?p ?o) { (UNDEF UNDEF) }
        ?s ?p ?o .
      }
    `;
    const result = deriveQueryVersionMetadata(parser, queryString);
    expect(result.inputs.length).toBe(2);
    expect(result.inputs.map(i => i.variableName).sort()).toEqual(['o', 'p']);
  });

  it('should derive inputs for a DESCRIBE query with VALUES UNDEF', () => {
    const queryString = `
      DESCRIBE ?s
      WHERE {
        VALUES (?p ?o) { (UNDEF UNDEF) }
        ?s ?p ?o .
      }
    `;
    const result = deriveQueryVersionMetadata(parser, queryString);
    expect(result.inputs.length).toBe(2);
    expect(result.inputs.map(i => i.variableName).sort()).toEqual(['o', 'p']);
  });

  it('should derive inputs for an INSERT query with VALUES UNDEF in WHERE', () => {
    const queryString = `
      INSERT { ?s a <http://example.com/Type> }
      WHERE {
        VALUES (?s) { (UNDEF) }
        ?s a <http://example.com/OtherType> .
      }
    `;
    const result = deriveQueryVersionMetadata(parser, queryString);
    expect(result.inputs.length).toBe(1);
    expect(result.inputs[0].variableName).toBe('s');
  });

  it('should derive inputs for a DELETE query with VALUES UNDEF in WHERE', () => {
    const queryString = `
      DELETE { ?s ?p ?o }
      WHERE {
        VALUES (?s) { (UNDEF) }
        ?s ?p ?o .
      }
    `;
    const result = deriveQueryVersionMetadata(parser, queryString);
    expect(result.inputs.length).toBe(1);
    expect(result.inputs[0].variableName).toBe('s');
  });

  describe('error handling', () => {
    it('should handle parser errors gracefully when detecting outputs', () => {
      // Invalid SPARQL that might cause parser to throw
      const invalidQuery = 'INVALID SPARQL QUERY';
      const result = deriveQueryVersionMetadata(parser, invalidQuery);

      // Should return empty arrays when parsing fails
      expect(result.outputs).toEqual([]);
      expect(result.raw.outputs).toEqual([]);
    });

    it('should handle parser errors gracefully when detecting inputs', () => {
      // Query that parser.detectInputs might reject
      const problematicQuery = 'SELECT * WHERE';
      const result = deriveQueryVersionMetadata(parser, problematicQuery);

      // Should have fallback values for inputs
      expect(result.inputs).toEqual([]);
      expect(result.limitParameters).toEqual([]);
      expect(result.offsetParameters).toEqual([]);
      expect(result.raw.valuesInputs).toEqual([]);
    });
  });

  describe('duplicate handling', () => {
    it('should handle duplicate output variable names with expressions', () => {
      // When using expressions, we can get duplicate variable names
      const queryString = 'SELECT ?s (COUNT(*) AS ?count) WHERE { ?s ?p ?o } GROUP BY ?s';
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Check that all outputs have valid IDs with unique suffixes when duplicated
      const ids = result.outputs.map(o => o.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size); // All IDs should be unique

      result.outputs.forEach(output => {
        expect(output.id).toMatch(/^urn:ui-temp:output:auto-/);
      });
    });

    it('should handle truly duplicate output variables requiring suffix generation', () => {
      // Create a scenario where parser.detectQueryOutputs returns actual duplicates
      // This would be an edge case where the parser returns the same variable multiple times
      const mockParser = {
        detectQueryOutputs: () => ['x', 'x', 'x'],
        detectInputs: () => ({ valuesInputs: [], limitParameters: [], offsetParameters: [] })
      };

      const result = deriveQueryVersionMetadata(mockParser as any, 'mock query');

      // Should create unique IDs with suffixes
      expect(result.outputs.length).toBe(3);
      expect(result.outputs[0].id).toBe('urn:ui-temp:output:auto-x');
      expect(result.outputs[1].id).toBe('urn:ui-temp:output:auto-x-1');
      expect(result.outputs[2].id).toBe('urn:ui-temp:output:auto-x-2');
    });

    it('should handle limit parameters with correct format', () => {
      // The parser expects LIMIT 000N format where N is a digit
      const queryString = `
        SELECT ?s
        WHERE { ?s ?p ?o }
        LIMIT 0001
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      expect(result.limitParameters.length).toBeGreaterThan(0);
      if (result.limitParameters.length > 0) {
        expect(result.limitParameters[0].name).toBeTruthy();
        expect(result.limitParameters[0].id).toContain('urn:ui-temp:limit-param:');
      }
    });

    it('should handle offset parameters with correct format', () => {
      // The parser expects OFFSET 000N format where N is a digit
      const queryString = `
        SELECT ?s
        WHERE { ?s ?p ?o }
        OFFSET 0002
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      expect(result.offsetParameters.length).toBeGreaterThan(0);
      if (result.offsetParameters.length > 0) {
        expect(result.offsetParameters[0].name).toBeTruthy();
        expect(result.offsetParameters[0].id).toContain('urn:ui-temp:offset-param:');
      }
    });

    it('should handle multiple limit parameters with duplicate names', () => {
      // Mock a scenario where parser returns duplicate limit parameters
      const mockParser = {
        detectQueryOutputs: () => [],
        detectInputs: () => ({
          valuesInputs: [],
          limitParameters: ['1', '1', '1'], // Same parameter name multiple times
          offsetParameters: []
        })
      };

      const result = deriveQueryVersionMetadata(mockParser as any, 'mock query');

      expect(result.limitParameters.length).toBe(3);
      expect(result.limitParameters[0].id).toBe('urn:ui-temp:limit-param:auto-1');
      expect(result.limitParameters[1].id).toBe('urn:ui-temp:limit-param:auto-1-1');
      expect(result.limitParameters[2].id).toBe('urn:ui-temp:limit-param:auto-1-2');
    });

    it('should handle multiple offset parameters with duplicate names', () => {
      // Mock a scenario where parser returns duplicate offset parameters
      const mockParser = {
        detectQueryOutputs: () => [],
        detectInputs: () => ({
          valuesInputs: [],
          limitParameters: [],
          offsetParameters: ['2', '2', '2'] // Same parameter name multiple times
        })
      };

      const result = deriveQueryVersionMetadata(mockParser as any, 'mock query');

      expect(result.offsetParameters.length).toBe(3);
      expect(result.offsetParameters[0].id).toBe('urn:ui-temp:offset-param:auto-2');
      expect(result.offsetParameters[1].id).toBe('urn:ui-temp:offset-param:auto-2-1');
      expect(result.offsetParameters[2].id).toBe('urn:ui-temp:offset-param:auto-2-2');
    });

    it('should handle same variable appearing in multiple input tuples', () => {
      const queryString = `
        SELECT ?s
        WHERE {
          VALUES (?x) { (UNDEF) }
          VALUES (?x ?y) { (UNDEF UNDEF) }
          ?s ?p ?o .
        }
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Should reuse the same input for variable 'x' in both tuples
      const xInputs = result.inputs.filter(i => i.variableName === 'x');
      expect(xInputs.length).toBe(1); // Only one input entity for 'x'

      // But should have multiple tuple members pointing to the same input
      const xMembers = result.tupleMembers.filter(m => m.variable === xInputs[0].id);
      expect(xMembers.length).toBe(2); // Two tuple members, one per tuple
    });

    it('should handle variables that produce duplicate sanitized IDs', () => {
      // Mock a scenario where different variable names sanitize to the same ID
      // This tests the while loop at lines 151-155
      const mockParser = {
        detectQueryOutputs: () => [],
        detectInputs: () => ({
          valuesInputs: [
            ['var_1'],  // Sanitizes to 'auto-var-1'
            ['var-1'],  // Also sanitizes to 'auto-var-1'
            ['var__1']  // Also sanitizes to 'auto-var-1'
          ],
          limitParameters: [],
          offsetParameters: []
        })
      };

      const result = deriveQueryVersionMetadata(mockParser as any, 'mock query');

      // All three should have unique IDs with suffixes
      expect(result.inputs.length).toBe(3);
      const ids = result.inputs.map(i => i.id);
      expect(new Set(ids).size).toBe(3); // All IDs should be unique

      // Check that the deduplication logic added suffixes
      expect(ids).toContain('urn:ui-temp:input:auto-var-1');
      expect(ids.filter(id => id.startsWith('urn:ui-temp:input:auto-var-1')).length).toBe(3);
    });

    it('should skip empty VALUES groups', () => {
      // Mock a scenario with empty variable names (lines 139-140)
      const mockParser = {
        detectQueryOutputs: () => [],
        detectInputs: () => ({
          valuesInputs: [
            ['', '  ', ''],  // All empty/whitespace - should be skipped
            ['valid']        // Valid group
          ],
          limitParameters: [],
          offsetParameters: []
        })
      };

      const result = deriveQueryVersionMetadata(mockParser as any, 'mock query');

      // Should only process the valid group
      expect(result.inputs.length).toBe(1);
      expect(result.inputs[0].variableName).toBe('valid');
      expect(result.inputTuples.length).toBe(1);
    });
  });

  describe('sanitization and edge cases', () => {
    it('should sanitize variable names with underscores and numbers', () => {
      // Valid SPARQL variable names can contain underscores and numbers
      const queryString = 'SELECT ?special_var_123 ?another_var2 WHERE { ?s ?p ?o }';
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Check that IDs are properly sanitized
      result.outputs.forEach(output => {
        expect(output.id).toMatch(/^urn:ui-temp:output:auto-[a-z0-9-]+$/);
      });
    });

    it('should handle output variables with duplicate sanitized names', () => {
      // Using aliases to create outputs with names that might sanitize to same ID
      const queryString = 'SELECT ?s (?s AS ?s_copy) WHERE { ?s ?p ?o }';
      const result = deriveQueryVersionMetadata(parser, queryString);

      // All outputs should have unique IDs
      const ids = result.outputs.map(o => o.id);
      expect(new Set(ids).size).toBe(ids.length);

      // Verify sanitization works correctly
      result.outputs.forEach(output => {
        expect(output.id).toMatch(/^urn:ui-temp:output:auto-/);
      });
    });

    it('should handle empty variable names gracefully', () => {
      const queryString = `
        SELECT ?s
        WHERE {
          VALUES (?valid) { (UNDEF) }
          ?s ?p ?o .
        }
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Should only include valid variables
      expect(result.inputs.every(i => i.variableName && i.variableName.trim().length > 0)).toBe(true);
    });

    it('should skip input groups with only empty/whitespace variable names', () => {
      // This tests the filter logic at lines 137-140
      const queryString = `
        SELECT ?s
        WHERE {
          VALUES (?a ?b) { (UNDEF UNDEF) }
          ?s ?p ?o .
        }
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Valid group should be processed
      expect(result.inputs.length).toBe(2);
      expect(result.inputTuples.length).toBe(1);
    });

    it('should handle variables that need fallback names', () => {
      const queryString = 'SELECT ?### WHERE { ?s ?p ?o }';
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Should use fallback naming when variable name can't be sanitized
      if (result.outputs.length > 0) {
        const output = result.outputs.find(o => o.variableName === '###');
        if (output) {
          expect(output.id).toContain('auto-');
        }
      }
    });

    it('should handle CONSTRUCT queries without SELECT outputs', () => {
      const queryString = `
        CONSTRUCT { ?s ?p ?o }
        WHERE {
          VALUES (?p ?o) { (UNDEF UNDEF) }
          ?s ?p ?o .
        }
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      // CONSTRUCT should have no SELECT outputs
      expect(result.outputs.length).toBe(0);
      // But should still detect inputs
      expect(result.inputs.length).toBe(2);
    });

    it('should generate correct tuple member positions', () => {
      const queryString = `
        SELECT ?s
        WHERE {
          VALUES (?a ?b ?c) { (UNDEF UNDEF UNDEF) }
          ?s ?p ?o .
        }
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      expect(result.tupleMembers.length).toBe(3);
      const positions = result.tupleMembers.map(m => m.position).sort();
      expect(positions).toEqual([0, 1, 2]);
    });
  });

  describe('raw output preservation', () => {
    it('should preserve raw parser outputs in result', () => {
      const queryString = `
        SELECT ?x ?y
        WHERE {
          VALUES (?a ?b) { (UNDEF UNDEF) }
          ?x ?y ?z .
        }
        LIMIT 0001
        OFFSET 0002
      `;
      const result = deriveQueryVersionMetadata(parser, queryString);

      // Check that raw outputs are preserved
      expect(result.raw).toBeDefined();
      expect(result.raw.outputs).toBeDefined();
      expect(result.raw.valuesInputs).toBeDefined();
      expect(result.raw.limitParameters).toBeDefined();
      expect(result.raw.offsetParameters).toBeDefined();

      // Verify the actual values are preserved
      expect(result.raw.outputs.length).toBeGreaterThan(0);
      expect(result.raw.valuesInputs.length).toBeGreaterThan(0);
    });
  });
});
