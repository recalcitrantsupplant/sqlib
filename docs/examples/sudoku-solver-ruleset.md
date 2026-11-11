# Example: a Sudoku solver as a rule set

This SRL rule set derives Sudoku cell values by inference. It shows three
features of the language: negation over the evaluation graph, negation over the
*ground* graph, and computed bindings with `SET`. It also shows one limit: SRL
cannot count.

This example uses no extension syntax. It contains no `TUPLE( … )`, so it needs
no feature flag. `ruleTuples` (`FEATURE_RULE_TUPLES`) can stay at its default,
off.

The rule set below was checked against the current grammar. It parses with
`parseRuleSet`, reports no well-formedness issues, and stratifies into two strata
with no cycle.

## The data model

Each of the 81 cells is a resource with a row index and a column index. A filled
cell also has a value.

```turtle
@prefix ex: <http://example.org/sudoku#> .

<urn:square/1> ex:hasIndexI 1 ;
    ex:hasIndexJ 1 ;
    ex:hasValue 5 .

<urn:square/2> ex:hasIndexI 1 ;
    ex:hasIndexJ 2 .
```

- `ex:hasIndexI`: row index, 1 to 9.
- `ex:hasIndexJ`: column index, 1 to 9.
- `ex:hasValue`: the digit in the cell, present only for a filled cell.

Cells are numbered 1 to 81, row by row from the top left. Cell 1 is (1, 1), cell
9 is (1, 9), cell 10 is (2, 1) and cell 81 is (9, 9).

The rules also need the nine digits as data, because an SRL rule body has no
`VALUES` clause. Add this to the same data graph as the puzzle:

```turtle
@prefix ex: <http://example.org/sudoku#> .

ex:digits ex:digit 1, 2, 3, 4, 5, 6, 7, 8, 9 .
```

Put it in the data graph. A `DATA { … }` block of the rule set does not work
here. The executor takes a snapshot of the ground graph *before* it runs the data
blocks of the rule set, so the triples of a `DATA` block are inference output.
The first rule below reads the ground graph only.

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

**`ex:candidate`** records, for each empty cell, each digit that no filled cell in
its row, its column or its 3×3 box holds. `SET` calculates box membership. It
binds a variable to the value of an expression, as `BIND` does in SPARQL. The
rule calculates the box of the cell and the box of the other cell, and compares
them inside the negated block.

`WHERE DATA` makes the whole body match against the **ground** graph. The rule
reads the puzzle as given, and never reads what the other rules infer. This keeps
the rule set stratifiable. It also means that one run calculates the candidates
once, from the puzzle as given.

**`ex:nakedSingle`** assigns a digit to a cell that has exactly one candidate.
The rule does not count. It states that there is a candidate, and that the same
cell has no *other* candidate.

**`ex:hiddenSingleInRow`** and **`ex:hiddenSingleInColumn`** assign a digit that
only one cell in a row or column can take. This cell has the digit as a
candidate, and no other cell in the same row or column does. The same rule for a
box is not included here, to keep the example short. Write it as the row rule,
with the box comparison from `ex:candidate` in place of the shared row.

### What it will and will not solve

One execution is one pass. The candidates come from the ground puzzle, and the
single-cell rules fire against those candidates. To continue, take the inference
graph, add the new `ex:hasValue` triples to the data graph, and run again. Each
round gives fewer candidates to the next round.

The rules are safe but not complete. Inference only adds triples, so a derived
candidate is never removed. The derived candidate set is therefore a superset of
the true set. A cell with one recorded candidate thus has only one possible
digit, and both single rules give correct values. On a hard puzzle, the process
stops with empty cells. It does not give a wrong answer.

An SRL rule body has no aggregation, so it cannot express techniques that need
counting (pointing pairs, box/line reduction, X-Wing). It also cannot express
backtracking, which needs a search. A rule set only computes a fixpoint.

## Running it

1. Open `/examples/sudoku-solver` in the web app. It is a grid editor: enter a
   puzzle or load an example, and it renders the RDF in the shape above, as Turtle
   or N-Triples, with a **Copy to Data Block** button that puts it on the
   clipboard. The **Solve** button of the page runs a local solver in the browser.
   It does not call the rule engine. Use it to check a puzzle.
2. Create a **data graph** in your library from that RDF, adding the `ex:digits`
   triples above.
3. Create a **rule set** and paste the rules above into it.
4. Run the rule set against the data graph. The inference graph holds the derived
   `ex:hasCandidate` and `ex:hasValue` triples.
5. Merge the new `ex:hasValue` triples into the data graph and run again, until no
   new values appear.

To see the state after a round, paste the final RDF into the editor of the page.
The grid updates.

## The SRL rule body, compared with SPARQL

The rule body accepts less than a SPARQL group graph pattern. It accepts triple
patterns, `FILTER`, `NOT { … }` and `NOT DATA { … }`, `SET ( ?v := expr )`, and,
with the `ruleTuples` extension on, `TUPLE( … )`. It does **not** accept
`VALUES`, `BIND`, `OPTIONAL`, `UNION` or a sub-`SELECT`. The parser refuses each
of these, and the message names the keyword it did not expect.

The translations this example uses:

| SPARQL | SRL |
| --- | --- |
| `BIND(expr AS ?v)` | `SET ( ?v := expr )` |
| `FILTER NOT EXISTS { … }` | `NOT { … }` (`FILTER NOT EXISTS` also parses) |
| `VALUES ?v { 1 2 3 … }` | a triple pattern over data that enumerates the values |
| a sub-`SELECT` with `COUNT` | no equivalent; rewrite as a negation, or do it outside the rule set |

`NOT DATA { … }` negates against the ground graph. `NOT { … }` negates against the
evaluation graph. `WHERE DATA { … }` applies the ground-graph limit to a whole
rule body.
