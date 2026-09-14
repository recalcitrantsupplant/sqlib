# Example: a Sudoku solver as a rule set

A worked SRL rule set that derives Sudoku cell values by inference. It is a
compact demonstration of three things the language does — negation over the
evaluation graph, negation over the *ground* graph, and computed bindings with
`SET` — and of one thing it does not do, which is count.

This example uses no extension syntax. It contains no `TUPLE( … )`, so it needs
no feature flag; `ruleTuples` (`FEATURE_RULE_TUPLES`) can stay at its default of
off.

The rule set below has been checked against the current grammar: it parses with
`parseRuleSet`, reports no well-formedness issues, and stratifies cleanly into two
strata with no cycle.

## The data model

Each of the 81 cells is a resource with a row index, a column index, and — for a
filled cell — a value.

```turtle
@prefix ex: <http://example.org/sudoku#> .

<urn:square/1> ex:hasIndexI 1 ;
    ex:hasIndexJ 1 ;
    ex:hasValue 5 .

<urn:square/2> ex:hasIndexI 1 ;
    ex:hasIndexJ 2 .
```

- `ex:hasIndexI` — row index, 1 to 9.
- `ex:hasIndexJ` — column index, 1 to 9.
- `ex:hasValue` — the digit in the cell, present only for a filled cell.

Cells are numbered 1 to 81 row by row from the top left: cell 1 is (1, 1), cell 9
is (1, 9), cell 10 is (2, 1), cell 81 is (9, 9).

The rules also need the nine digits as data, because SRL's rule body has no
`VALUES` clause. Add this alongside the puzzle, in the same data graph:

```turtle
@prefix ex: <http://example.org/sudoku#> .

ex:digits ex:digit 1, 2, 3, 4, 5, 6, 7, 8, 9 .
```

It has to be in the data graph rather than in a `DATA { … }` block of the rule
set. The executor snapshots the ground graph *before* it runs the rule set's data
blocks, so a `DATA` block's triples are inference output rather than ground input,
and the first rule below reads the ground graph.

## The rule set

```sparql
PREFIX ex: <http://example.org/sudoku#>

RULE ex:candidate {
  ?cell ex:hasCandidate ?digit .
}
WHERE DATA {
  ?cell ex:hasIndexI ?row ;
        ex:hasIndexJ ?col .
  ex:digits ex:digit ?digit .
  NOT { ?cell ex:hasValue ?anyValue . }

  SET ( ?boxRow := FLOOR((?row - 1) / 3) )
  SET ( ?boxCol := FLOOR((?col - 1) / 3) )

  NOT { ?rowCell ex:hasIndexI ?row ; ex:hasValue ?digit . }
  NOT { ?colCell ex:hasIndexJ ?col ; ex:hasValue ?digit . }
  NOT {
    ?boxCell ex:hasIndexI ?otherRow ;
             ex:hasIndexJ ?otherCol ;
             ex:hasValue ?digit .
    SET ( ?otherBoxRow := FLOOR((?otherRow - 1) / 3) )
    SET ( ?otherBoxCol := FLOOR((?otherCol - 1) / 3) )
    FILTER (?otherBoxRow = ?boxRow && ?otherBoxCol = ?boxCol)
  }
}

RULE ex:nakedSingle {
  ?cell ex:hasValue ?digit .
}
WHERE {
  ?cell ex:hasCandidate ?digit .
  NOT {
    ?cell ex:hasCandidate ?otherDigit .
    FILTER (?otherDigit != ?digit)
  }
}

RULE ex:hiddenSingleInRow {
  ?cell ex:hasValue ?digit .
}
WHERE {
  ?cell ex:hasCandidate ?digit ;
        ex:hasIndexI ?row .
  NOT {
    ?otherCell ex:hasCandidate ?digit ;
               ex:hasIndexI ?row .
    FILTER (?otherCell != ?cell)
  }
}

RULE ex:hiddenSingleInColumn {
  ?cell ex:hasValue ?digit .
}
WHERE {
  ?cell ex:hasCandidate ?digit ;
        ex:hasIndexJ ?col .
  NOT {
    ?otherCell ex:hasCandidate ?digit ;
               ex:hasIndexJ ?col .
    FILTER (?otherCell != ?cell)
  }
}
```

### How it works

**`ex:candidate`** records, for every empty cell, each digit that no filled cell in
its row, its column or its 3×3 box already holds. Box membership is computed with
`SET`, which binds a variable to the value of an expression — this is SRL's
spelling of what SPARQL writes as `BIND`. Both the cell's box and the other cell's
box are computed and compared inside the negated block.

`WHERE DATA` makes the whole body match against the **ground** graph: the rule
reads the puzzle as given and never what the other rules infer. That is what keeps
the rule set stratifiable, and it is why candidates are a property of one pass
rather than of a fixpoint.

**`ex:nakedSingle`** assigns a digit to a cell that has exactly one candidate,
expressed without counting: there is a candidate, and there is no *other* candidate
for the same cell.

**`ex:hiddenSingleInRow`** and **`ex:hiddenSingleInColumn`** assign a digit that
only one cell in a row or column can take: this cell has it as a candidate, and no
other cell in the same row or column does. The same rule for a box needs the box
computation again and is left out for brevity; it follows the row rule exactly,
with the box comparison from `ex:candidate` in place of the shared row.

### What it will and will not solve

One execution is one pass: candidates are derived from the ground puzzle and the
single-cell rules fire against those candidates. To go further, take the inference
graph, fold the new `ex:hasValue` triples back into the data graph, and run again.
Each round narrows the candidates the next round derives.

The rules are conservative rather than complete. Inference only adds triples, so a
candidate once derived is never withdrawn; the derived candidate set is therefore a
superset of the true one, which makes both single rules safe — a cell with one
recorded candidate truly has one — and makes the process stall on a hard puzzle
rather than answer wrongly.

Techniques that require counting (pointing pairs, box/line reduction, X-Wing) are
not expressible in an SRL rule body, which has no aggregation. Neither is
backtracking, which needs a search rather than a fixpoint.

## Running it

1. Open `/examples/sudoku-solver` in the web app. It is a grid editor: enter a
   puzzle or load an example, and it renders the RDF in the shape above, as Turtle
   or N-Triples, with a **Copy to Data Block** button that puts it on the
   clipboard. The page's own **Solve** button runs a local solver in the browser —
   it does not call the rule engine, so it is a way to check a puzzle rather than a
   demonstration of these rules.
2. Create a **data graph** in your library from that RDF, adding the `ex:digits`
   triples above.
3. Create a **rule set** and paste the rules above into it.
4. Run the rule set against the data graph. The inference graph holds the derived
   `ex:hasCandidate` and `ex:hasValue` triples.
5. Merge the new `ex:hasValue` triples into the data graph and run again, until no
   new values appear.

Pasting the final RDF back into the page's editor updates the grid, which is a
quick way to see where a round got to.

## The SRL rule body, compared with SPARQL

The rule body is deliberately smaller than a SPARQL group graph pattern. It admits
triple patterns, `FILTER`, `NOT { … }` and `NOT DATA { … }`, `SET ( ?v := expr )`,
and — with the `ruleTuples` extension enabled — `TUPLE( … )`. It does **not**
admit `VALUES`, `BIND`, `OPTIONAL`, `UNION`, or a sub-`SELECT`; the parser rejects
each of those with a message naming the keyword it did not expect.

The translations this example uses:

| SPARQL | SRL |
| --- | --- |
| `BIND(expr AS ?v)` | `SET ( ?v := expr )` |
| `FILTER NOT EXISTS { … }` | `NOT { … }` (`FILTER NOT EXISTS` also parses) |
| `VALUES ?v { 1 2 3 … }` | a triple pattern over data that enumerates the values |
| a sub-`SELECT` with `COUNT` | no equivalent; rewrite as a negation, or do it outside the rule set |

`NOT DATA { … }` negates against the ground graph rather than the evaluation graph,
and `WHERE DATA { … }` applies the same restriction to a whole rule body.
