<template>
  <!--
    What this build is, for a deployment that ships the rules suite alone: no
    queries, groups or ETL to open, so the pane explains the one thing it does.
  -->
  <div class="content-placeholder rules-suite-overview">
    <div class="overview-inner">
      <h2>SHACL Rules</h2>
      <div class="overview-sections">
        <section class="overview-section">
          <h3>Grammars & translation</h3>
          <ul>
            <li>This implementation uses a single rules dialect: the Shape Rules Language (SRL) from the current shacl12-rules draft, which includes negation (<code>NOT</code>) natively.
            The grammar is implemented as an extension of the <a href="https://github.com/comunica/traqula" target="_blank" rel="noreferrer">Traqula</a> SPARQL 1.2 parser, so SPARQL 1.2 / RDF-star support comes for free.
              In addition, a rule to SPARQL converter is added, a ruleset stratifier, and well-formedness checks. Aggregation and the <code>FOR</code> clause are not supported.</li>
            <li>The SHACL rules draft spec is available here <a href="https://www.w3.org/TR/shacl12-rules/" target="_blank" rel="noreferrer">w3.org/TR/shacl12-rules</a>.</li>
            <li>The translator turns SRL rules and <code>DATA</code> blocks into SPARQL <code>INSERT</code> / <code>INSERT DATA</code>; raw SPARQL updates are also accepted as-is. If it parses, it can be saved and run.</li>
            <li>Invalid rules can be stored via “Save my sins” in the Save dropdown—kept on here to support negative-rule syntax tests that are expected to fail validation.</li>
          </ul>
        </section>
        <section class="overview-section">
          <h3>Stratifier</h3>
          <ul>
            <li>Classifies each rule as monotone or negation by walking the parsed body.</li>
            <li>Builds a dependency graph by matching rule heads to bodies; non-monotone edges force a stratum gap.</li>
            <li>Assigns strata iteratively and flags non-stratifiable cycles using a strongly-connected-components check.</li>
          </ul>
        </section>
        <section class="overview-section">
          <h3>Execution flow</h3>
          <ul>
            <li>Loads DataBlocks into an in-memory Oxigraph store.</li>
            <li>Normalises rules (when possible) to SPARQL updates, orders them by stratum, and runs them until no new triples are produced or a max-iteration guard trips (5 iterations).</li>
            <li>Per-rule execution captures deltas and samples to make debugging and provenance easier.</li>
          </ul>
        </section>
        <section class="overview-section">
          <h3>Blank nodes & convergence</h3>
          <ul>
            <li>A rule whose head mints a blank node (or whose body assigns with <code>SET</code>) has no fixpoint of its own —
              every pass would mint a fresh node. Such rules are scheduled <code>SL.once</code>: they fire on the pass that activates
              their stratum and never again, which is the draft spec's own evaluation loop. Nothing needs to be enabled for this.</li>
            <li>Test assertions compare graphs up to blank-node relabelling (RDFC-1.1 canonicalisation), so a rule that mints
              blank nodes does not fail on labels.</li>
          </ul>
        </section>
        <section class="overview-section">
          <h3>Background</h3>
          <ul>
            <li>This implementation is an extension to a SPARQL Query Library which runs on Node.js and is intended to be deployed close to triplestores, as such,
              the libraries/rules are shared and there is no browser based execution or storage.</li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.content-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: var(--space-8);
  text-align: center;
  color: var(--ink-muted);
}

.content-placeholder h2 {
  font-size: var(--text-display);
  font-weight: 600;
  margin: 0 0 var(--space-6) 0;
  color: var(--ink-secondary);
}

.content-placeholder p {
  font-size: var(--text-title);
  margin: var(--space-4) 0;
  max-width: 500px;
}

.rules-suite-overview {
  align-items: flex-start;
  justify-content: flex-start;
  text-align: left;
  color: var(--ink);
}

.overview-inner {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
}

.rules-suite-overview p {
  max-width: none;
}

.overview-sections {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  width: 100%;
}

.overview-section {
  background: linear-gradient(90deg, var(--surface-subtle) 0%, var(--surface) 100%);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  padding: var(--space-6) var(--space-7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), 0 6px 18px rgba(0, 0, 0, 0.03);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.overview-section:hover {
  transform: translateY(-1px);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65), 0 10px 24px rgba(0, 0, 0, 0.05);
}

.rules-suite-overview h3 {
  margin: 0 0 var(--space-3) 0;
  font-size: var(--text-heading);
  color: var(--ink);
}

.rules-suite-overview ul {
  margin: 0;
  padding-left: var(--space-6);
  color: var(--ink-secondary);
  display: grid;
  gap: 0.35rem;
  list-style: disc;
  list-style-position: outside;
}

.overview-section a {
  color: var(--action-ink);
  text-decoration: none;
}

.overview-section a:hover {
  text-decoration: underline;
}
</style>
