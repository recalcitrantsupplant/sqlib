`MINUS` removes each station that is on the Red line. Change it to `FILTER NOT EXISTS { ?station :onLine :red }`: the result is the same, because the two patterns share `?station`.
