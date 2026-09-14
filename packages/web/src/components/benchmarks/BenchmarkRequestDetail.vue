<script setup lang="ts">
/**
 * One request, in the inspector's Request tab on Runs (§7.3, mockup 2b).
 *
 * The phase breakdown is the part that earns its place: 612ms of an 890ms
 * request being server-side thinking rather than 265ms transferring rows is the
 * difference between a slow store and a slow query. If transfer dominates, the
 * honest fix is a smaller result, not a faster store.
 *
 * The design asks for five phases — DNS, connect, TLS, waiting, transfer. The
 * runner times two things: the whole request, and the backend's own duration
 * where the store reports it. Those two are drawn. Splitting the remainder into
 * a DNS slice and a TLS slice would be a chart of an assumption, so the panel
 * says which numbers are missing instead of inventing them.
 *
 * A rule-set request has neither phase to draw — it sends nothing over a wire —
 * and its breakdown is the fixpoint loop instead: the passes block below is the
 * same question answered against the axis it does have.
 */
import { computed } from 'vue';
import { Crosshair, TriangleAlert } from '@lucide/vue';
import InlineNote from '../shared/InlineNote.vue';
import {
  formatCount,
  formatMs,
  formatOffset,
  requestPhases,
  type PassProfile,
  type RequestRow,
} from '../../lib/benchmarkPlan';

const props = defineProps<{
  request: RequestRow | null;
  /** The query text this request sent, where the case's version is loaded. */
  sent: string | null;
  /** This request's passes to fixpoint, or null where it has none. */
  passes: PassProfile | null;
  colour: string;
}>();

const phases = computed(() => (props.request ? requestPhases(props.request) : []));

const totalLabel = computed(() => formatMs(props.request?.totalMs));

/**
 * The argument set version this request ran against, as its last IRI segment.
 *
 * The plan names a set and the set floats, so "which values did this number
 * come from" is answerable only from the run's own record of what the reference
 * resolved to (issue #246). There is no version *number* to show — the run
 * stores an IRI and the plan screen has no index of argument set versions to
 * look one up in — so the identifier is shown as-is rather than dressed up as
 * something it is not. Absent on the no-arguments sentinel, and on runs
 * recorded before the pin existed.
 */
const argumentVersionLabel = computed(() => {
  const id = props.request?.argumentVersionId;
  if (!id) return null;
  return id.split(/[:/#]/).filter(Boolean).pop() ?? id;
});

/**
 * The data graph version, on the requests that have a graph axis at all.
 *
 * The same pin as the argument set's, and shown the same way and for the same
 * reason: a rules plan names a floating `DataGraph`, so "which content did this
 * number come from" is answerable only from the run's own record.
 */
const graphVersionLabel = computed(() => {
  const id = props.request?.dataGraphVersionId;
  if (!id) return null;
  return id.split(/[:/#]/).filter(Boolean).pop() ?? id;
});

/**
 * What the other repeats of this request did, where they disagree.
 *
 * §5's canary: repeats of one request that took nine passes once and twelve
 * another time were not measuring the same thing twice, and the counts are
 * printed rather than averaged into a number describing neither.
 */
const repeatCountsLabel = computed(() => props.passes?.repeatCounts.join(', ') ?? '');

/**
 * The passes' own total against the request's.
 *
 * A pass is timed around itself, so the passes account for most of a run but
 * never all of it — seeding the store and reading the result out sit outside
 * the loop. Naming the remainder stops the two totals reading as a discrepancy.
 *
 * Null where there is no remainder to name, rather than a line saying 0ms went
 * somewhere.
 */
const outsideLoopMs = computed(() => {
  const total = props.request?.totalMs;
  const inLoop = props.passes?.totalMs;
  if (total == null || inLoop == null) return null;
  const outside = total - inLoop;
  return outside > 0 ? outside : null;
});

/**
 * The rest of a pass's row, as its hover title.
 *
 * `rulesEvaluated` is what separates a slow pass from a wide one — `SL.once`
 * rules and finished strata drop out of later passes, so a pass costing more
 * while running fewer rules is a different finding from one costing more
 * because it ran more. It is a fifth number in a 348px column, which is a
 * column too many, so it is reachable rather than drawn.
 */
const passTitle = (pass: PassProfile['passes'][number]) => {
  const parts: string[] = [];
  if (pass.rulesEvaluated != null) {
    parts.push(`${pass.rulesEvaluated} rule${pass.rulesEvaluated === 1 ? '' : 's'} evaluated`);
  }
  if (pass.triples != null) parts.push(`${formatCount(pass.triples)} triples after`);
  if (pass.tuples != null) parts.push(`${formatCount(pass.tuples)} tuples after`);
  return parts.join(' · ');
};
</script>

<template>
  <div class="request-panel" data-testid="benchmark-request-detail">
    <div class="panel-head">
      <Crosshair :size="13" class="head-icon" />
      <span class="head-title">{{ request ? 'Request' : 'No request selected' }}</span>
      <span v-if="request" class="head-sub">{{ formatOffset(request.offsetMs) }}</span>
    </div>

    <div class="panel-body">
      <InlineNote v-if="!request">
        Pick a row in the requests table to see where its time went.
      </InlineNote>

      <template v-else>
        <section class="block">
          <span class="block-label">Where the {{ totalLabel }} went</span>

          <template v-if="phases.length > 1">
            <div class="phase-bar">
              <span
                v-for="phase in phases"
                :key="phase.name"
                class="phase-slice"
                :class="phase.tone === 'server' ? 'phase-server' : 'phase-client'"
                :style="{ width: `${phase.percent}%` }"
                :title="phase.name"
              />
            </div>
            <div class="phase-list">
              <span v-for="phase in phases" :key="phase.name" class="phase-row">
                <span
                  class="phase-dot"
                  :class="phase.tone === 'server' ? 'phase-server' : 'phase-client'"
                />
                <span class="phase-name">{{ phase.name }}</span>
                <span class="phase-ms">{{ formatMs(phase.ms) }}</span>
              </span>
            </div>
            <InlineNote>
              The store's own time against everything else — connection setup,
              transferring rows, parsing them. DNS, connect and TLS are not timed
              separately yet, so they sit inside the second bar.
            </InlineNote>
          </template>

          <template v-else>
            <div class="phase-bar">
              <span class="phase-slice phase-server phase-full" />
            </div>
            <InlineNote v-if="passes">
              A rule set runs in-process against an ephemeral store, so there is
              no store time to hold against a transfer. Its breakdown is the
              fixpoint loop below.
            </InlineNote>
            <InlineNote v-else>
              Only the total is timed for this request — the store did not report
              its own duration, so there is nothing to split.
            </InlineNote>
          </template>
        </section>

        <!--
          The passes, where the request is a run to fixpoint.

          A run that takes 400ms because one pass is slow and a run that takes
          400ms because it needs eleven of them are the same row in the table
          and are not the same problem. This is the block that tells them apart,
          which is what the rows were recorded for.
        -->
        <section v-if="passes" class="block" data-testid="benchmark-request-passes-detail">
          <span class="block-label">Passes</span>
          <span class="block-sub">
            {{ passes.passes.length }} to fixpoint · {{ formatMs(passes.totalMs) }} in the loop
          </span>

          <div class="pass-list">
            <span
              v-for="pass in passes.passes"
              :key="pass.key"
              class="pass-row"
              :class="{ 'pass-slowest': pass.index === passes.slowestIndex }"
              :title="passTitle(pass)"
            >
              <span class="pass-index">
                #{{ pass.index }}<template v-if="pass.stratum != null"> · s{{ pass.stratum }}</template>
              </span>
              <span class="pass-track">
                <span class="pass-fill" :style="{ width: `${pass.percent}%` }" />
              </span>
              <span class="pass-ms">{{ formatMs(pass.durationMs) }}</span>
              <span class="pass-derived" :class="{ 'pass-spent': pass.derived === 0 }">
                {{ pass.derived == null ? '—' : `+${formatCount(pass.derived)}` }}
              </span>
            </span>
          </div>

          <InlineNote>
            One row per pass of the loop, longest bar the slowest. The number on
            the right is what that pass <em>derived</em> — deltas falling away is
            convergence; deltas flat while the times climb is a rule set
            re-deriving what it already has.
          </InlineNote>
          <InlineNote v-if="outsideLoopMs != null">
            {{ formatMs(outsideLoopMs) }} of the request sits outside the loop —
            seeding the store and reading the result back.
          </InlineNote>

          <!--
            Reported, never averaged: the pass count is decided by the data
            rather than by the plan, so two repeats disagreeing on it is a
            finding about the rule set, not noise to smooth (§5).
          -->
          <div v-if="passes.countsVary" class="warning-strip">
            <TriangleAlert :size="13" class="warning-icon" />
            <span class="warning-text">
              Repeats of this request took {{ repeatCountsLabel }} passes. A rule
              set that needs a different number of passes each time was not
              measuring the same thing twice.
            </span>
          </div>
          <InlineNote v-else-if="passes.repeatCounts.length > 1">
            Every repeat of this request took the same {{ passes.passes.length }}
            passes.
          </InlineNote>
        </section>

        <section class="block">
          <span class="block-label">Identity</span>
          <div class="fact-list">
            <span class="fact">
              <span class="fact-key">Case</span>
              <span class="fact-value">{{ request.caseLabel }}</span>
            </span>
            <span class="fact">
              <span class="fact-key">Backend</span>
              <span class="fact-value">
                <span class="fact-dot" :style="{ background: colour }" />{{ request.backendLabel }}
              </span>
            </span>
            <span class="fact">
              <span class="fact-key">Argument</span>
              <span class="fact-value">{{ request.argumentLabel }}</span>
            </span>
            <span v-if="argumentVersionLabel" class="fact">
              <span class="fact-key">Argument version</span>
              <span class="fact-value" :title="request.argumentVersionId ?? undefined">
                {{ argumentVersionLabel }}
              </span>
            </span>
            <span v-if="request.dataGraphLabel" class="fact">
              <span class="fact-key">Data graph</span>
              <span class="fact-value" :title="request.dataGraphId ?? undefined">
                {{ request.dataGraphLabel }}
              </span>
            </span>
            <span v-if="graphVersionLabel" class="fact">
              <span class="fact-key">Graph version</span>
              <span class="fact-value" :title="request.dataGraphVersionId ?? undefined">
                {{ graphVersionLabel }}
              </span>
            </span>
            <span class="fact">
              <span class="fact-key">Repetition</span>
              <span class="fact-value">{{ request.runIndex ?? '—' }}</span>
            </span>
          </div>
          <!--
            The five names below are the OTel boundary (§9). A benchmark request
            and a production span carry the same attributes, so a later Alerts
            page compares like with like for free — which costs nothing today
            and is expensive to retrofit. A rules request adds its graph above,
            which has no production counterpart and so is not one of them.
          -->
          <InlineNote>
            library · case · query version · backend · argument set — the same
            attributes a production span would carry.
          </InlineNote>
        </section>

        <section class="block">
          <span class="block-label">Sent</span>
          <pre v-if="sent" class="code-block">{{ sent }}</pre>
          <InlineNote v-else>The query text for this case is not loaded.</InlineNote>
          <InlineNote>
            The case's query as stored. Argument binding is done by the runner
            and the bound text is not kept, so this is the query before its
            values were substituted.
          </InlineNote>
        </section>

        <section class="block">
          <span class="block-label">Response</span>
          <div class="fact-list">
            <span class="fact">
              <span class="fact-key">Status</span>
              <span class="fact-value" :class="{ 'fact-bad': !request.ok }">
                {{ request.ok ? 'ok' : request.status }}
              </span>
            </span>
            <span class="fact">
              <span class="fact-key">Rows</span>
              <span class="fact-value">{{ request.rows ?? '—' }}</span>
            </span>
            <span class="fact">
              <span class="fact-key">Result hash</span>
              <span class="fact-value fact-absent">not captured</span>
            </span>
          </div>
        </section>

        <div v-if="!request.ok" class="warning-strip">
          <TriangleAlert :size="13" class="warning-icon" />
          <span class="warning-text">
            {{ request.errorMessage || 'The request failed. It is counted, not averaged into the statistic.' }}
          </span>
        </div>

        <InlineNote>
          The equivalence diff — which rows this store returned that the
          reference did not — needs a result hash and the kept body of a
          mismatching response. Neither is recorded yet.
        </InlineNote>
      </template>
    </div>
  </div>
</template>

<style scoped>
.request-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 348px;
  min-height: 0;
  background: var(--surface);
  border-left: 1px solid var(--border-default);
}

.panel-head {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  box-sizing: border-box;
  height: 40px;
  flex-shrink: 0;
  padding: 0 var(--space-5);
  background: var(--surface-subtle);
  border-bottom: 1px solid var(--border-default);
}

.head-icon {
  flex-shrink: 0;
  color: var(--ink-muted);
}

.head-title {
  color: var(--ink);
  font-size: var(--text-body);
  font-weight: var(--weight-semibold);
  white-space: nowrap;
}

.head-sub {
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-label);
}

.panel-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 15px;
  min-height: 0;
  padding: var(--space-5);
  overflow: auto;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.block-label {
  color: var(--ink);
  font-size: var(--text-label);
  font-weight: var(--weight-semibold);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.block-sub {
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.pass-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.pass-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.pass-index {
  flex-shrink: 0;
  width: 54px;
  color: var(--ink-muted);
  font-family: var(--font-mono);
  font-size: var(--text-micro);
  white-space: nowrap;
}

.pass-track {
  flex: 1;
  min-width: 0;
  height: 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.pass-fill {
  display: block;
  height: 10px;
  border-radius: var(--radius-sm);
  background: var(--series-1);
}

/* The pass the run spent most of itself in — the one worth reading first. */
.pass-slowest .pass-fill {
  background: var(--series-3);
}

.pass-ms {
  flex-shrink: 0;
  width: 52px;
  color: var(--ink);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.pass-derived {
  flex-shrink: 0;
  width: 48px;
  color: var(--ink-muted);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/*
 * A pass that derived nothing is the one that proved the fixpoint — it cost
 * time and produced no triples, which is a fact about the loop rather than a
 * fault, so it is dimmed rather than flagged.
 */
.pass-spent {
  color: var(--ink-muted);
}

.phase-bar {
  display: flex;
  overflow: hidden;
  height: 16px;
  border-radius: var(--radius);
  background: var(--surface-sunken);
}

.phase-slice {
  height: 16px;
}

.phase-full {
  width: 100%;
}

.phase-server {
  background: var(--series-3);
}

.phase-client {
  background: var(--series-1);
}

.phase-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.phase-row {
  display: flex;
  align-items: center;
  gap: 7px;
}

.phase-dot {
  flex-shrink: 0;
  width: 9px;
  height: 9px;
  border-radius: var(--radius-sm);
}

.phase-name {
  color: var(--ink-secondary);
  font-size: var(--text-label);
}

.phase-ms {
  margin-left: auto;
  color: var(--ink);
  font-size: var(--text-label);
  font-variant-numeric: tabular-nums;
}

.fact-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.fact {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
}

.fact-key {
  flex-shrink: 0;
  width: 96px;
  color: var(--ink-muted);
  font-size: var(--text-label);
}

.fact-value {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  overflow: hidden;
  color: var(--ink);
  font-size: var(--text-label);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.fact-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: var(--radius-sm);
}

.fact-bad {
  color: var(--danger-ink);
}

.fact-absent {
  color: var(--ink-muted);
  font-style: italic;
}

.code-block {
  box-sizing: border-box;
  max-height: 220px;
  margin: 0;
  padding: var(--space-4) var(--space-5);
  overflow: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--surface-subtle);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: var(--text-label);
  line-height: 1.65;
  white-space: pre;
}

.warning-strip {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  padding: var(--space-5);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-lg);
  background: var(--warning-surface);
}

.warning-icon {
  flex-shrink: 0;
  color: var(--warning-ink);
}

.warning-text {
  color: var(--warning-ink);
  font-size: var(--text-label);
  line-height: var(--leading-normal);
}
</style>
