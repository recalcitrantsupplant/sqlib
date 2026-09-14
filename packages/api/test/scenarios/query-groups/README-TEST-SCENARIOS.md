# Query Group Scenario Tests - Progressive Complexity

This directory contains scenario tests for query groups, organised by increasing complexity. Each test builds on concepts from previous tests by adding **one additional piece of complexity** at a time.

## Test Progression

### Base Tests (Already Existing)

1. **02-simple-ab-integration.test.ts** - Simplest SELECT → CONSTRUCT chain
   - Two nodes: SELECT → CONSTRUCT
   - Basic VARIABLE_BINDINGS edge
   - RDF_GRAPH output to EndNode
   - Foundation for all other tests

2. **01-basic-linear-chain-unmocked.test.ts** - Verify auto-generated data structures
   - Tests inferredOutputs, outputTuples, tupleMembers
   - Validates QueryVersion entity structure

### New Progressive Tests

3. **03-select-to-select-chain.test.ts** - SELECT → SELECT Chain
   - **New complexity:** VARIABLE_BINDINGS between two SELECT queries
   - **Concept tested:** Tuple-based query chaining with positional mapping
   - **Output:** SPARQL JSON instead of RDF

4. **04-three-node-linear-chain.test.ts** - Three-Node Linear Chain
   - **New complexity:** Three queries in sequence (SELECT → SELECT → CONSTRUCT)
   - **Concept tested:** Multiple VARIABLE_BINDINGS edges in series
   - **Learning:** Data flowing through intermediate transformations

5. **05-parallel-branch-merge.test.ts** - Parallel Branch and Merge
   - **New complexity:** DAG structure with parallel execution
   - **Concept tested:** One source branches to two nodes, then merges
   - **Learning:** Multiple inbound edges targeting same input tuple

6. **06-multiple-input-tuples.test.ts** - Multiple Input Tuples
   - **New complexity:** Single query with multiple distinct VALUES clauses
   - **Concept tested:** Different upstream queries feeding different input tuples
   - **Learning:** Tuple-specific edge targeting on same node

7. **07-parallel-construct.test.ts** - Mixed Output Types
   - **New complexity:** CONSTRUCT query producing both RDF and variable outputs
   - **Concept tested:** Single node with multiple output types consumed differently
   - **Learning:** Multi-output capability and parallel consumption

8. **08-diamond-pattern-dag.test.ts** - Diamond Pattern DAG
   - **New complexity:** Classic diamond (split → parallel → merge)
   - **Concept tested:** Execution ordering and data flow convergence
   - **Learning:** Proper parallel execution and merge semantics

9. **09-external-parameters.test.ts** - External Parameters via StartNode
   - **New complexity:** Runtime parameters passed through StartNode
   - **Concept tested:** Query group parameterization at execution time
   - **Learning:** StartNode outputs and runtime argument passing

10. **10-multiple-end-outputs.test.ts** - Multiple EndNode Outputs
    - **New complexity:** Multiple nodes feeding EndNode in parallel
    - **Concept tested:** RDF concatenation from multiple CONSTRUCT queries
    - **Learning:** Multi-predecessor EndNode handling

11. **11-complex-multi-stage-pipeline.test.ts** - Complex Multi-Stage Pipeline
    - **New complexity:** Combines all previous patterns
    - **Combines:**
      - External parameters (StartNode)
      - Diamond pattern (branch/merge)
      - Multiple input tuples
      - Mixed SELECT/CONSTRUCT
      - Multi-level depth (4 stages)
    - **Demonstrates:** Realistic end-to-end workflow

12. **13-start-node-data-graph.test.ts** - Data graphs as start node inputs
    - **New complexity:** an RDF input on the StartNode, filled by the run's
      `dataGraphs`
    - **Concept tested:** a start node's tuple inputs and data graph inputs are
      independent slots, so one run fills both
    - **Demonstrates:** handing a group RDF to work over, beside the arguments
      that choose its rows

## Concepts Tested

### Data Flow Patterns
- Linear chains (3, 4)
- Parallel branches (5, 8)
- Merge points (5, 6, 8)
- Diamond patterns (8, 11)

### Input/Output Types
- VARIABLE_BINDINGS (3, 4, 5, 6, 9, 11)
- RDF_GRAPH (1, 4, 7, 10, 11)
- CONTROL_FLOW (all tests)
- Multiple input tuples (6, 11)
- Multiple output types (7)

### Execution Semantics
- Sequential execution (3, 4)
- Parallel execution (5, 8, 10)
- Positional mapping (all with VARIABLE_BINDINGS)
- Tuple merging (5, 6, 8)
- External parameters (9, 11)
- External data graphs (13)

### Graph Structures
- 2-node linear (1)
- 3-node linear (4)
- 4-node DAG (5, 8)
- 5-node complex DAG (11)

## Test Data

All tests use existing Turtle and SPARQL files from `test/scenarios/data/`:
- `people-skills-projects.ttl` - Rich dataset with people, skills, and projects
- `simple-ab-data.ttl` - Minimal A-B test data

## Running Tests

```bash
# Run all scenario tests
npm test test/scenarios/query-groups

# Run specific test
npm test test/scenarios/query-groups/03-select-to-select-chain.test.ts

# Run with verbose output
npm test test/scenarios/query-groups -- --reporter=verbose
```

## What These Tests Reveal

These tests demonstrate the "new user intuition" when learning the query group system:

1. **Starting simple** - Basic two-node chains (tests 1-3)
2. **Adding depth** - Multi-stage pipelines (test 4)
3. **Adding breadth** - Parallel execution (test 5)
4. **Combining inputs** - Multiple data sources (test 6)
5. **Understanding I/O** - Different output types (test 7)
6. **Complex patterns** - Common DAG structures (test 8)
7. **Parameterization** - Runtime configuration (test 9)
8. **Multiple outputs** - Parallel final results (test 10)
9. **Real workflows** - Production-like scenarios (test 11)

## API Patterns Used

Based on inspection of documentation and generated schemas, these tests use:

- `POST /queries/` - Create query entity
- `POST /queries/{id}/v` - Create query version with auto-inference
- `POST /query-groups/` - Create query group
- `POST /query-groups/{id}/v` - Create query group version
- `PUT /query-groups/{id}` - Set currentVersion
- `POST /execute/` - Execute query group with parameters

Key payload patterns discovered:
- `inferredOutputs` and `inferredInputs` are auto-generated
- Temporary URNs (`urn:ui-temp:*`) in nodes/edges for pre-persistence references
- `__START__` and `__END__` special identifiers
- `dataFlowType` determines edge semantics
- Tuple identification by finding members with specific variable names

## Notes on Test Creation

These tests were created by:
1. Reading documentation thoroughly (query-group-execution.md, query-chaining.md, etc.)
2. Inspecting API schemas and TypeScript interfaces
3. Examining existing test patterns (02-simple-ab-integration.test.ts)
4. Inferring payload structures from generated types
5. Building progressively without executing

**Important:** These tests have NOT been executed yet. They represent the "intuition test" - what would a new user create based solely on documentation and API inspection?
