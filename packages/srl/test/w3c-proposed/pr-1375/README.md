# The suite's `GROUP` syntax tests, with commas

The 26 `syntax-rule-elements-group-*` tests of the W3C SPARQL-RL suite as they
stand on [w3c/data-shapes#1375](https://github.com/w3c/data-shapes/pull/1375)
(branch `srl-aggregation-comma`, commit
`a3eac70d93f94007f23d99c328f667c0e6a0b271`), copied unedited.

#1375 puts a comma between the assignments of a `GROUP` block. It rewrites
`group-14` to use one, and adds `group-bad-09` (two assignments with no comma)
and `group-bad-10` (a trailing comma). The other 23 tests are those of
[w3c/data-shapes#1347](https://github.com/w3c/data-shapes/pull/1347) as merged
into `gh-pages`, which also fixed the missing braces in `group-bad-04` to
`-08`.

`syntax/manifest.ttl` lists the tests with the ids and types of the upstream
manifest at that commit. The vendored suite in `../../w3c/` predates #1347, so
these run separately until the suite is refreshed past #1375.
