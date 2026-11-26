Learn SPARQL 1.1 queries on a small city rail network: ten lessons, each with objectives, worked examples you can run and change, and an exercise that checks your answer.

The data is the Rail network library's store: 16 stations on 4 lines, in the default graph, and a weekday and a weekend timetable, each in a named graph. Each lesson names the sections of the [SPARQL 1.1 Query Language](https://www.w3.org/TR/sparql11-query/) recommendation that it follows.

The lessons are this library's numbered tags. Each exercise is a test: its query's first version is where you start, its current version is a solution, and the test holds the expected result. Open the tutorial from an MCP client that renders MCP Apps with `app_tutorial_open`, or browse it here.

PREFIX : <https://example.org/rail/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
