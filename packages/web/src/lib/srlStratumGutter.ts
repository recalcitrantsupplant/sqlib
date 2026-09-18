import { StateEffect, StateField, type Text } from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { STRATUM_NONE, stratumColor, stratumLabel } from '@/composables/useStratumPalette';

/**
 * The stratum band, in the editor gutter.
 *
 * The old rules screen drew strata as coloured columns beside a stack of rule
 * cards. There are no cards any more — a rule set is one document — so the
 * signal moves to the only column the document still has: a strip beside the
 * line numbers, using the same `--stratum-*` ramp the graph and the outline
 * use, so one colour means one stratum everywhere on the screen.
 *
 * Bands are pushed in rather than computed here: working out which lines are a
 * rule means parsing SRL, which happens once per pause in typing on the server
 * (see `useSrlAnalysis`) and is shared by the gutter, the outline and the DAG.
 */
export interface StratumBand {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** 0-based stratum as the stratifier reports it; null for a DATA block. */
  stratum: number | null;
  kind: 'rule' | 'data';
  /** Hover text — what this block asserts. */
  label: string;
}

/** Replace the bands a view is showing. */
export const setStratumBands = StateEffect.define<StratumBand[]>();

const bandsField = StateField.define<StratumBand[]>({
  create: () => [],
  update(bands, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setStratumBands)) return effect.value;
    }
    return bands;
  },
});

/**
 * Strata are 0-based in the stratifier and 1-based to a reader.
 *
 * Re-exported rather than defined here: it now has readers that must not pull
 * CodeMirror in with it (the replay timeline, for one), so it lives beside the
 * palette it labels.
 */
export { stratumLabel };

class BandMarker extends GutterMarker {
  constructor(private readonly band: StratumBand, private readonly first: boolean) {
    super();
  }

  /*
   * One marker per line, but only the first line of a block is labelled: a
   * column of repeated "1"s beside a seven-line rule is noise, where an
   * unbroken block of colour with one number at the top reads as one rule.
   */
  eq(other: BandMarker) {
    return (
      other.band.startLine === this.band.startLine
      && other.band.stratum === this.band.stratum
      && other.band.kind === this.band.kind
      && other.first === this.first
    );
  }

  toDOM() {
    const element = document.createElement('div');
    element.className = 'cm-stratum-band';
    element.style.backgroundColor =
      this.band.kind === 'data' ? STRATUM_NONE : stratumColor(this.band.stratum);
    element.textContent = this.first ? (this.band.kind === 'data' ? 'D' : stratumLabel(this.band.stratum)) : '';
    element.title =
      this.band.kind === 'data'
        ? 'DATA block — no stratum'
        : `${this.band.label} · stratum ${stratumLabel(this.band.stratum)}`;
    return element;
  }
}

const stratumTheme = EditorView.baseTheme({
  '.cm-stratum-gutter': {
    width: '20px',
    padding: '0',
  },
  '.cm-stratum-band': {
    display: 'flex',
    justifyContent: 'center',
    width: '20px',
    height: '100%',
    fontSize: '10px',
    fontWeight: '600',
    lineHeight: 'inherit',
    color: 'var(--ink-secondary)',
  },
});

/**
 * The band a line belongs to, and whether it carries the label.
 *
 * A line inside a block is its own band's. A blank line *between* two blocks in
 * the same stratum is bridged: the bands come back one per rule, so two rules
 * of stratum 1 separated by the blank line SRL is normally written with used to
 * draw as two stripes with a gap, reading as two things where the colour is
 * saying "one stratum". Only whitespace bridges, and only between neighbours
 * that agree — a gap holding a comment, or spanning a change of stratum, is a
 * real break and keeps its gap.
 */
export function bandForLine(bands: StratumBand[], doc: Text, number: number): { band: StratumBand; first: boolean } | null {
  const band = bands.find((entry) => number >= entry.startLine && number <= entry.endLine);
  if (band) return { band, first: number === band.startLine };

  // Nearest on each side, without assuming the bands arrive in document order.
  const before = bands
    .filter((entry) => entry.endLine < number)
    .reduce<StratumBand | null>((best, entry) => (!best || entry.endLine > best.endLine ? entry : best), null);
  const after = bands
    .filter((entry) => entry.startLine > number)
    .reduce<StratumBand | null>((best, entry) => (!best || entry.startLine < best.startLine ? entry : best), null);
  if (!before || !after) return null;
  if (before.kind !== after.kind || before.stratum !== after.stratum) return null;

  for (let line = before.endLine + 1; line < after.startLine; line += 1) {
    if (line > doc.lines) return null;
    if (doc.line(line).text.trim().length > 0) return null;
  }
  return { band: before, first: false };
}

/** The gutter extension: install once, then dispatch {@link setStratumBands}. */
export function stratumGutter() {
  return [
    bandsField,
    gutter({
      class: 'cm-stratum-gutter',
      lineMarker(view, line) {
        const bands = view.state.field(bandsField, false);
        if (!bands?.length) return null;
        const number = view.state.doc.lineAt(line.from).number;
        const match = bandForLine(bands, view.state.doc, number);
        return match ? new BandMarker(match.band, match.first) : null;
      },
      // Without a spacer the gutter collapses to nothing on a document with no
      // rules yet, and the code jumps sideways the moment the first one parses.
      initialSpacer: () => new BandMarker({ startLine: 0, endLine: 0, stratum: null, kind: 'rule', label: '' }, true),
      lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(setStratumBands))),
    }),
    stratumTheme,
  ];
}
