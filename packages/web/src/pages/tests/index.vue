<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
    <header class="space-y-2">
      <h1 class="text-2xl font-bold">UI Experiments</h1>
      <p class="text-sm text-muted-foreground">
        Ad hoc playground pages used while rebuilding the query tooling. These pages mount in isolation and are not part of the production navigation.
      </p>
    </header>

    <section>
      <h2 class="mb-3 text-lg font-semibold">Query Results</h2>
      <ul class="space-y-2 text-sm">
        <li>
          <NuxtLink to="/tests/test-query-results-100" class="text-primary underline-offset-2 hover:underline">
            100 Results Performance Fixture
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="mb-3 text-lg font-semibold">Component Mockups</h2>
      <ul class="space-y-2 text-sm">
        <li>
          <NuxtLink to="/tests/rule-viewer-mockups" class="text-primary underline-offset-2 hover:underline">
            Rule & Data Block Viewer Design Variations
          </NuxtLink>
        </li>
        <li>
          <NuxtLink to="/tests/codemirror-rdf" class="text-primary underline-offset-2 hover:underline">
            CodeMirror RDF Playground
          </NuxtLink>
        </li>
        <li>
          <NuxtLink to="/tests/sparql-diff" class="text-primary underline-offset-2 hover:underline">
            SPARQL Query Diff Viewer
          </NuxtLink>
        </li>
        <li>
          <NuxtLink to="/tests/query-group-canvas-sandbox" class="text-primary underline-offset-2 hover:underline">
            Query Group Canvas Sandbox
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="mb-3 text-lg font-semibold">ETL Diagnostics</h2>
      <ul class="space-y-2 text-sm">
        <li>
          <NuxtLink to="/tests/etl-timing-bench" class="text-primary underline-offset-2 hover:underline">
            ETL Timing Bench (Crossref)
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
