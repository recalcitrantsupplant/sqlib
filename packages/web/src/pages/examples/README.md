# SPARQL Query Library Examples

This directory contains interactive examples demonstrating various use cases of the SPARQL Query Library and RDF-based rulesets.

## Available Examples

### 1. Sudoku Solver (`/examples/sudoku-solver`)

An interactive Sudoku puzzle solver that demonstrates:
- RDF data model design for constraint problems
- Two-way synchronization between visual UI and RDF representation
- Toggling between RDF serialization formats (Turtle and N-Triples)
- Integration with ruleset-based inference

**Features:**
- Interactive 9x9 Sudoku grid with keyboard navigation
- Live RDF editor supporting both Turtle and N-Triples formats
- Automatic bidirectional sync between grid and RDF
- Multiple example puzzles (Easy, Medium, Hard)
- Copy to clipboard for use with rulesets
- Integration point for rule-based solving

**Learning Objectives:**
- How to model constraint satisfaction problems in RDF
- Using CONSTRUCT rules for inference
- Iterative rule application
- Working with the inference graph

See [docs/examples/sudoku-solver-ruleset.md](../../../../../docs/examples/sudoku-solver-ruleset.md) for detailed documentation on creating solving rulesets.

## Adding New Examples

To add a new example:

1. Create a new page in `/packages/web/src/pages/examples/[example-name].vue`
2. Add the example to the list in `/packages/web/src/pages/examples/index.vue`
3. Create documentation in `/docs/examples/[example-name].md` if needed
4. Update this README with a brief description

### Example Structure

Each example page should include:
- Clear title and description
- Interactive components demonstrating functionality
- RDF data visualization
- Links to relevant documentation
- Copy-to-clipboard functionality for integration with rulesets

### Design Guidelines

- Use consistent styling with other examples
- Support both light and dark modes
- Provide helpful error messages
- Include example data/puzzles/scenarios
- Make it easy to copy RDF for use in rulesets
- Document the data model clearly

## Future Example Ideas

- **Chess Position Validator**: Model chess rules as RDF constraints
- **Family Tree Reasoner**: Infer family relationships from parent/child data
- **Supply Chain Optimizer**: Model inventory and shipping constraints
- **Schedule Conflict Detector**: Find conflicts in calendar events
- **Graph Traversal**: Shortest path, connected components, etc.
- **Data Quality Checker**: Validate datasets against SHACL-like rules
- **Semantic Search**: Query expansion using ontology relationships

## Technology Stack

Examples are built with:
- **Vue 3 Composition API**: Reactive components
- **Nuxt 4**: Page routing; the app is a single-page application, with `ssr: false`
- **CodeMirror 6**: RDF syntax highlighting and editing
- **Tailwind CSS**: Styling (via scoped styles)

## Development

Run the development server:

```bash
just run-frontend
```

Then visit `http://localhost:3001/examples` to see all examples.

## Contributing

When contributing new examples:
1. Ensure code is well-commented
2. Provide clear documentation
3. Test with various screen sizes
4. Include accessibility features (ARIA labels, keyboard navigation)
5. Add TypeScript types for all props and data
