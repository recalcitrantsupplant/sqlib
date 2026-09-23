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
  /**
   * On a cycle that stops the document stratifying. There is no stratum to
   * show then — the layering does not exist — so the band marks membership of
   * the cycle instead of a number.
   */
  inCycle?: boolean;
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
   * One marker per line, but only the first line of an unbroken run is
   * labelled: a column of repeated "1"s down four rules in the same stratum is
   * noise, where one band of colour with a single number at its top says the
   * same thing. The number changes exactly where the stratum does.
   */
  eq(other: BandMarker) {
    return (
      other.band.startLine === this.band.startLine
      && other.band.stratum === this.band.stratum
      && other.band.kind === this.band.kind
      && other.band.inCycle === this.band.inCycle
      && other.first === this.first
    );
  }

  toDOM() {
    const element = document.createElement('div');
    element.className = 'cm-stratum-band';
    if (this.band.inCycle) {
      element.classList.add('cm-stratum-cycle');
      element.textContent = this.first ? '⊘' : '';
      element.title = `${this.band.label} · on a dependency cycle — the rule set does not stratify`;
      return element;
    }
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
  '.cm-stratum-band.cm-stratum-cycle': {
    backgroundColor: 'var(--danger-surface)',
    color: 'var(--danger)',
    fontSize: '12px',
  },
});

/** Whether everything strictly between two bands is whitespace. */
function onlyBlankBetween(doc: Text, endLine: number, startLine: number) {
  for (let line = endLine + 1; line < startLine; line += 1) {
    if (line > doc.lines) return false;
    if (doc.line(line).text.trim().length > 0) return false;
  }
  return true;
}

/** The nearest band ending above `line`, without assuming document order. */
const bandBefore = (bands: StratumBand[], line: number) =>
  bands
    .filter((entry) => entry.endLine < line)
    .reduce<StratumBand | null>((best, entry) => (!best || entry.endLine > best.endLine ? entry : best), null);

/** The nearest band starting below `line`. */
const bandAfter = (bands: StratumBand[], line: number) =>
  bands
    .filter((entry) => entry.startLine > line)
    .reduce<StratumBand | null>((best, entry) => (!best || entry.startLine < best.startLine ? entry : best), null);

/** Two bands are one run when they agree and nothing but blank lines divides them. */
const joins = (doc: Text, above: StratumBand, below: StratumBand) =>
  // Every rule on a cycle carries its own mark: they are not one stratum, and
  // "which rules are involved" is exactly what the mark is there to answer.
  !above.inCycle
  && !below.inCycle
  && above.kind === below.kind
  && above.stratum === below.stratum
  && onlyBlankBetween(doc, above.endLine, below.startLine);

/**
 * The band a line belongs to, and whether it carries the label.
 *
 * Bands arrive one per block, but a reader does not see blocks — they see a
 * column of colour, and a colour that does not change is saying "still the same
 * stratum". So neighbouring blocks that agree are treated as one run: the blank
 * line SRL is normally written with is painted through, and the number is drawn
 * once, at the top, where it is the answer to "which stratum does this start?".
 * Repeating it beside every rule in the run restates what the unbroken colour
 * already said.
 *
 * A run ends where the meaning does. A gap holding a comment, or a change of
 * stratum or kind, is a real break: the colour stops, and the next run opens
 * with its own number.
 */
export function bandForLine(bands: StratumBand[], doc: Text, number: number): { band: StratumBand; first: boolean } | null {
  const band = bands.find((entry) => number >= entry.startLine && number <= entry.endLine);
  if (!band) {
    // A blank line between two blocks of one run — painted, never labelled.
    const above = bandBefore(bands, number);
    const below = bandAfter(bands, number);
    if (!above || !below || !joins(doc, above, below)) return null;
    return { band: above, first: false };
  }

  if (number !== band.startLine) return { band, first: false };

  // The label belongs to the run, so a block that continues one does not carry it.
  const above = bandBefore(bands, band.startLine);
  return { band, first: !above || !joins(doc, above, band) };
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
