# The syntax tests of w3c/data-shapes#1347

The 25 `syntax-rule-elements-group-*` tests of
[w3c/data-shapes#1347](https://github.com/w3c/data-shapes/pull/1347), copied
unedited from the pull request's head commit
`3a26f06b76076ffb4b569a9adada6da743914b0a`. `syntax/manifest.ttl` lists them
with the types the pull request's own manifest gives them, so they can run
before the pull request is merged; once it is, they arrive with the vendored
suite and this folder can go.

Five of the negative tests, `group-bad-04` to `group-bad-08`, lack the closing
`}` of the rule's `WHERE`. They are rejected for that whether or not the fault
each one is meant to show is caught: an expression in `COUNT` or `SUM`, an empty
`BY`, and `DISTINCT` in `MIN`, `MAX` or `SUM`. With the brace restored, this
implementation rejects each for its own fault, and `../aggregates/` and the SRL
package's unit tests cover those faults with well-formed documents.
