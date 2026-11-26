A property path matches a route through the data of more than one step.

- `:a/:b` is `:a` then `:b`. `^:a` is `:a` backwards. `:a|:b` is either.
- `:a+` is one or more steps of `:a`. `:a*` is zero or more, and `:a?` is zero or one.
- From one start, a path with `+` or `*` returns each end point once, however many routes reach it.
- Each line's `:stops` is an RDF list. `rdf:rest*/rdf:first` walks it.
- Follows [9 Property Paths](https://www.w3.org/TR/sparql11-query/#propertypaths).
