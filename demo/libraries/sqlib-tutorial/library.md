Learn what sqlib adds to SPARQL: five lessons on parameters, saved queries and their versions, and argument sets. Each lesson has objectives, worked examples you can run and change, and most have an exercise that checks your answer.

The queries are plain SPARQL 1.1. Any SPARQL store runs them as they are written. sqlib reads two forms in them as parameters: a `VALUES` clause whose only row is `UNDEF`, and a `LIMIT` or `OFFSET` written with leading zeros. The data is the Rail network library's store. The *Learn SPARQL* tutorial teaches the SPARQL that these lessons use.

The lessons are this library's numbered tags. Each exercise is a test: its query's first version is where you start, its current version is a solution, and the test's cases hold the arguments and the expected results. Open the tutorial from an MCP client that renders MCP Apps with `app_tutorial_open`, or browse it here.

PREFIX : <https://example.org/rail/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
