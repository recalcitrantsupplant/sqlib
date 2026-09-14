import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { unreachableScopedRules } from '../lib/harness/scopedCss';
import SectionLabel from '../../src/components/shared/SectionLabel.vue';
import StatusBadge from '../../src/components/shared/StatusBadge.vue';
import EmptyState from '../../src/components/shared/EmptyState.vue';
import InlineNote from '../../src/components/shared/InlineNote.vue';
import Toolbar from '../../src/components/shared/Toolbar.vue';
import PanelHeader from '../../src/components/shared/PanelHeader.vue';
import CanvasSurface from '../../src/components/shared/CanvasSurface.vue';
import CanvasShell from '../../src/components/shared/CanvasShell.vue';
import { stratumColor, STRATUM_NONE, STRATUM_PALETTE } from '../../src/composables/useStratumPalette';

const SRC = resolve(import.meta.dirname, '../../src');

/*
 * The mockup pages, out of every guard that closes over `src`. A scope rather
 * than a suppression: none of them renders in the product. The label guard and
 * the disabled-ink guard each excluded them with a predicate of their own when
 * they were written in parallel; this is the one list both read.
 */
const MOCKUPS = /^pages\/(tests\/|wireframe-)/;

/*
 * The opening tags for one component in a template. Quote-aware because a
 * binding may hold the delimiter: `v-if="draftCount > 0"` ends a `[^>]*` tag
 * match four attributes early, and the half-tag left over is missing whichever
 * prop the guard came to read.
 */
function openingTags(template: string, component: string): string[] {
  const tags: string[] = [];
  const open = new RegExp(`<${component}(?=[\\s/>])`, 'g');
  for (const match of template.matchAll(open)) {
    let quote = '';
    for (let i = match.index + match[0].length; i < template.length; i += 1) {
      const char = template[i];
      if (quote) {
        if (char === quote) quote = '';
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        tags.push(template.slice(match.index, i + 1));
        break;
      }
    }
  }
  return tags;
}

function vueFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) vueFiles(full, out);
    else if (entry.name.endsWith('.vue')) out.push(full);
  }
  return out;
}

describe('design system primitives', () => {
  describe('SectionLabel', () => {
    it('renders as a div by default and honours the `as` prop', () => {
      expect(mount(SectionLabel, { slots: { default: 'Rules' } }).element.tagName).toBe('DIV');
      expect(mount(SectionLabel, { props: { as: 'h3' }, slots: { default: 'Rules' } }).element.tagName).toBe('H3');
    });

    it('renders a count only when one is supplied', () => {
      expect(mount(SectionLabel, { slots: { default: 'Rules' } }).find('.section-label__count').exists()).toBe(false);
      const withCount = mount(SectionLabel, { props: { count: 0 }, slots: { default: 'Rules' } });
      expect(withCount.find('.section-label__count').text()).toBe('0');
    });
  });

  describe('StatusBadge', () => {
    /*
     * The paint is keyed on the tone, and the five statuses are five of the
     * tones under the app's own names. So this asserts the mapping rather than
     * the identity it used to be — `stale` is the warning triple, and the
     * screen that says "Slow" reaches for that triple without borrowing the
     * word.
     */
    const TONE_OF_STATUS = {
      valid: 'success',
      invalid: 'danger',
      stale: 'warning',
      running: 'action',
      idle: 'neutral',
    } as const;

    it('paints a status through its tone', () => {
      for (const [status, tone] of Object.entries(TONE_OF_STATUS)) {
        const w = mount(StatusBadge, { props: { status: status as 'valid' } });
        expect(w.classes()).toContain(`status-badge--${tone}`);
      }
    });

    it('paints a tone, and says nothing else', () => {
      for (const tone of ['success', 'warning', 'danger', 'action', 'neutral'] as const) {
        const w = mount(StatusBadge, { props: { tone }, slots: { default: 'Unreachable' } });
        expect(w.classes()).toContain(`status-badge--${tone}`);
        expect(w.text()).toBe('Unreachable');
      }
    });

    /*
     * The one place the two vocabularies would have been folded together.
     * `running` and the action tone are the same colour and not the same
     * claim: a version number tinted from the action family is the interesting
     * value, not a thing that is running, so only the status throbs.
     */
    it('pulses for the running status and not for the action tone', () => {
      const running = mount(StatusBadge, { props: { status: 'running' } });
      const action = mount(StatusBadge, { props: { tone: 'action' }, slots: { default: 'v3' } });
      expect(running.classes()).toContain('status-badge--running');
      expect(action.classes()).not.toContain('status-badge--running');
      expect(action.classes()).toContain('status-badge--action');
    });

    it('falls back to a default label for a status, and to none for a tone', () => {
      expect(mount(StatusBadge, { props: { status: 'invalid' } }).text()).toBe('Invalid');
      expect(mount(StatusBadge, { props: { status: 'invalid' }, slots: { default: '3 errors' } }).text()).toBe('3 errors');
      expect(mount(StatusBadge, { props: { tone: 'warning' } }).text()).toBe('');
    });

    it('takes the control height by default and the dense step on request', () => {
      expect(mount(StatusBadge, { props: { status: 'idle' } }).classes()).toContain('status-badge--sm');
      expect(mount(StatusBadge, { props: { tone: 'neutral', size: 'xs' } }).classes()).toContain('status-badge--xs');
    });

    it('omits the dot when disabled', () => {
      expect(mount(StatusBadge, { props: { status: 'valid', dot: false } }).find('.status-badge__dot').exists()).toBe(false);
    });
  });

  describe('EmptyState', () => {
    it('renders the description only when supplied', () => {
      expect(mount(EmptyState, { props: { title: 'No rules' } }).find('.empty-state__description').exists()).toBe(false);
      expect(mount(EmptyState, { props: { title: 'No rules', description: 'Add one to begin.' } }).text()).toContain('Add one to begin.');
    });

    /*
     * `boxed` is orthogonal to `size`: the well is what the state paints, the
     * size is how much room it takes. Every site that adopted it wanted the
     * two independently, and the four it replaced had them fused.
     */
    it('paints the well only when boxed, without disturbing the size', () => {
      expect(mount(EmptyState, { props: { title: 'No tuples' } }).classes()).not.toContain('empty-state--boxed');
      const boxed = mount(EmptyState, { props: { title: 'No tuples', size: 'sm', boxed: true } });
      expect(boxed.classes()).toContain('empty-state--boxed');
      expect(boxed.classes()).toContain('empty-state--sm');
    });
  });

  describe('Toolbar', () => {
    it('renders only the groups that have slot content', () => {
      const w = mount(Toolbar, { slots: { start: 'A' } });
      expect(w.findAll('.toolbar__group')).toHaveLength(1);
      const both = mount(Toolbar, { slots: { start: 'A', end: 'B' } });
      expect(both.findAll('.toolbar__group')).toHaveLength(2);
    });
  });

  describe('PanelHeader', () => {
    it('renders the title and hides the subtitle when absent', () => {
      const w = mount(PanelHeader, { props: { title: 'Rule Editor' } });
      expect(w.find('.panel-header__title').text()).toBe('Rule Editor');
      expect(w.find('.panel-header__subtitle').exists()).toBe(false);
    });

    /*
     * `size` is orthogonal to `sunken`, the same way `EmptyState`'s `boxed` is
     * to its own `size`: one says how much room the bar takes, the other what
     * it is painted on. Every focus-mode title bar wanted both, and the six it
     * replaced had them fused into one rule.
     */
    it('defaults to md and carries the size independently of the chrome', () => {
      expect(mount(PanelHeader, { props: { title: 'Rule Editor' } }).classes()).toContain('panel-header--md');
      const lg = mount(PanelHeader, { props: { title: 'Query Results', size: 'lg', sunken: true } });
      expect(lg.classes()).toContain('panel-header--lg');
      expect(lg.classes()).toContain('panel-header--sunken');
    });
  });

  describe('CanvasSurface', () => {
    it('draws the layers only when something is given to put in them', () => {
      const bare = mount(CanvasSurface);
      expect(bare.find('.canvas-surface__underlay').exists()).toBe(false);
      expect(bare.find('.canvas-surface__overlay').exists()).toBe(false);

      const layered = mount(CanvasSurface, { slots: { underlay: 'bands', overlay: 'palette' } });
      expect(layered.find('.canvas-surface__underlay').text()).toBe('bands');
      expect(layered.find('.canvas-surface__overlay').text()).toBe('palette');
    });

    /*
     * The empty state is a prop rather than the presence of the slot, because
     * a canvas is empty at a moment rather than by construction: the consumer
     * supplies the copy once and says when it applies.
     */
    it('shows the empty state on the prop, not on the slot', () => {
      const supplied = mount(CanvasSurface, { slots: { empty: 'nothing here' } });
      expect(supplied.find('.canvas-surface__empty').exists()).toBe(false);
      expect(mount(CanvasSurface, { props: { empty: true }, slots: { empty: 'nothing here' } }).text())
        .toBe('nothing here');
    });

    it('falls back to EmptyState when no empty slot is supplied', () => {
      const w = mount(CanvasSurface, { props: { empty: true, emptyTitle: 'No rules to stratify yet.' } });
      expect(w.findComponent(EmptyState).props('title')).toBe('No rules to stratify yet.');
    });

    it('carries the tone and the control density as modifiers', () => {
      expect(mount(CanvasSurface).classes()).toContain('canvas-surface--default');
      const panel = mount(CanvasSurface, { props: { tone: 'subtle', dense: true } });
      expect(panel.classes()).toContain('canvas-surface--subtle');
      expect(panel.classes()).toContain('canvas-surface--dense');
    });
  });

  describe('CanvasShell', () => {
    /*
     * The one arithmetic the shell has, and the one that would be silent if it
     * were wrong: a width given as a share of the shell is a basis the main
     * column must hold, so it must not also be told to grow. A canvas with no
     * rail is the other case and takes the pane.
     */
    it('holds a given width and fills the pane without one', () => {
      const split = mount(CanvasShell, { props: { mainWidthPercent: 60 } });
      expect(split.find('.canvas-shell__main').attributes('style')).toContain('width: 60%');
      expect(split.find('.canvas-shell__main').classes()).not.toContain('canvas-shell__main--fill');

      const solo = mount(CanvasShell);
      expect(solo.find('.canvas-shell__main').attributes('style')).toBeUndefined();
      expect(solo.find('.canvas-shell__main').classes()).toContain('canvas-shell__main--fill');
    });

    it('forwards the surface slots without inventing them', () => {
      expect(mount(CanvasShell).find('.canvas-surface__overlay').exists()).toBe(false);
      const w = mount(CanvasShell, {
        slots: { toolbar: 'bars', default: 'flow', overlay: 'palette', rail: 'inspector' },
      });
      expect(w.find('.canvas-surface__overlay').text()).toBe('palette');
      expect(w.text()).toContain('bars');
      expect(w.text()).toContain('flow');
      expect(w.text()).toContain('inspector');
    });

    /*
     * Both elements are the shell's now, and both have a caller that measures
     * them — `usePanelResize` against the root, an overlay's coordinates
     * against the surface. Exposing them is the contract, not an accident.
     */
    it('hands back the elements its consumers measure', () => {
      const w = mount(CanvasShell, { attachTo: document.body });
      expect(w.vm.rootEl).toBe(w.find('.canvas-shell').element);
      expect(w.vm.surfaceEl).toBe(w.find('.canvas-surface').element);
    });
  });
});

/*
 * Issue #37, one work area at a time. A file listed here has had its private
 * label and empty-state rules deleted in favour of the primitives, and the
 * point of doing that is that the next one cannot be hand-written back in —
 * which is exactly how `.iterations-section` ended up grouped into a label rule
 * and wearing its uppercase type and underline.
 */
describe('primitive adoption', () => {
  const ADOPTED = [
    'components/RuleSetExecutionResults.vue',
    'components/rules/StratificationPanel.vue',
    'components/rules/RuleSetInputsPanel.vue',
    'components/rules/RuleSetInspectorPanel.vue',
    'components/rules/RuleSetSparqlPanel.vue',
  ];

  it.each(ADOPTED)('%s defines no uppercase label of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*text-transform:\s*uppercase[^{}]*)\}/g)]
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '))
      // A table header cell is table chrome, not a section label: it cannot be
      // a component, and its uppercase belongs to the `th`.
      .filter((selector) => !/\bth\b/.test(selector));
    expect(offenders, `${file} re-grew a private uppercase label — use SectionLabel`).toEqual([]);
  });

  /*
   * The fifth pass: the empty states that sit in a well. The previous pass
   * left these alone because absorbing them meant changing the primitive's
   * contract rather than sweeping markup — `boxed` is that change, and this is
   * what stops the well being hand-drawn again a file at a time.
   *
   * The guard looks for the well, not for the word "empty": the four sites it
   * replaced were named `.empty-state`, `.empty-state-compact` and nothing at
   * all, so a name test would have missed one of them outright.
   */
  const BOXED = [
    'components/shared/TupleValuesEditor.vue',
    'components/EtlPlayground.vue',
    'components/QueryGroupWorkArea.vue',
  ];

  it.each(BOXED)('%s draws no dashed well of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => /border:[^;]*dashed/.test(body) && /background:\s*var\(--surface-subtle\)/.test(body))
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
    expect(offenders, `${file} re-grew a private well — use <EmptyState boxed>`).toEqual([]);
  });

  it.each(BOXED)('%s reaches for EmptyState', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    expect(source).toMatch(/import EmptyState from '[^']*EmptyState\.vue';/);
  });

  /*
   * The sixth pass: the focus-mode title bars. Four files each held a byte-for-
   * byte copy of the same overlay, and the header was the part of it the
   * primitives could already absorb — once `size="lg"` existed to carry the
   * dialog scale.
   *
   * As with the well above, the guard looks for the spec rather than the name.
   * The shape is unambiguous: panel chrome (a bottom rule on `--surface-subtle`)
   * laid out as a title against trailing actions, at the dialog padding step.
   * `.focus-diff-controls` in `QueryWorkArea` shares three of those four and is
   * not a header — it centres its contents rather than spacing them apart,
   * which is what keeps it out.
   */
  const FOCUS_HEADERS = [
    'components/QueryWorkArea.vue',
    'components/query-work-area/QueryFocusOverlay.vue',
    'components/EtlPlayground.vue',
    'components/RuleSetExecutionResults.vue',
  ];

  it.each(FOCUS_HEADERS)('%s draws no focus title bar of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) =>
        /justify-content:\s*space-between/.test(body) &&
        /border-bottom:/.test(body) &&
        /background:\s*var\(--surface-subtle\)/.test(body) &&
        /padding:\s*var\(--space-6\)\s+var\(--space-7\)/.test(body))
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
    expect(offenders, `${file} re-grew a private focus header — use <PanelHeader size="lg" sunken>`).toEqual([]);
  });

  it.each(FOCUS_HEADERS)('%s reaches for PanelHeader', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    expect(source).toMatch(/import PanelHeader from '[^']*PanelHeader\.vue';/);
  });

  /*
   * The seventh pass: the panel headers the sixth pass left alone, and the
   * padding decision it deferred. `md` — `--space-3 --space-5` — is the answer,
   * so this guard drops the sixth's padding clause: inside these files a bar
   * with panel chrome laid out as a title against trailing actions is a panel
   * header at any step, and there is one way to draw it.
   *
   * The narrowing clause that replaces it: a bar with a `0` in its padding is a
   * tab strip, not a title bar — the tabs sit on the rule, so the step beneath
   * them is zero. It is load-bearing: drop it and the guard fails on
   * `InspectorPanel`'s live tab strip, which is not a header and not this
   * pass's work.
   */
  const PANEL_HEADERS = [
    'components/shared/SparqlEditorPanel.vue',
    'components/shared/InspectorPanel.vue',
    'components/EtlPlayground.vue',
    'components/QueryWorkArea.vue',
    'components/QueryGroupWorkArea.vue',
  ];

  it.each(PANEL_HEADERS)('%s draws no panel header of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) =>
        /justify-content:\s*space-between/.test(body) &&
        /border-bottom:/.test(body) &&
        /background:\s*var\(--surface-subtle\)/.test(body) &&
        !/padding:([^;]*);/.exec(body)?.[1].trim().split(/\s+/).includes('0'))
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
    expect(offenders, `${file} re-grew a private panel header — use <PanelHeader sunken>`).toEqual([]);
  });

  /*
   * And the defect that pass found, which is a different shape of mistake.
   *
   * Vue gives a child component's ROOT element the parent's scope attribute, so
   * a rule a component writes for its own `.panel-header` also lands on every
   * `<PanelHeader>` it renders — at equal specificity, which leaves the winner
   * to chunk order. `EtlPlayground` had exactly that: a `.panel-header` rule
   * left behind by the `InspectorPanel` extraction, quietly re-padding the two
   * focus headers the sixth pass had just converted (measured: 8/16 where the
   * primitive says 16/24, and a 12px gap where it says 16px).
   *
   * So the primitive's own class is spoken for. Reaching into it deliberately
   * still works and still reads as deliberate — `:deep()`, as EtlPlayground's
   * peek accent does.
   */
  it('no component but PanelHeader writes a rule for .panel-header', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/PanelHeader.vue')) continue;
      const source = readFileSync(file, 'utf8');
      const styleAt = source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      for (const [, selectorGroup] of source.slice(styleAt).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const selector of selectorGroup.split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (!/\.panel-header\b/.test(trimmed) || /:deep\(/.test(trimmed)) continue;
          offenders.push(`${file.slice(SRC.length + 1)}: ${trimmed}`);
        }
      }
    }
    expect(offenders, 'a scoped .panel-header rule lands on every <PanelHeader> the file renders — use :deep() if that is the intent').toEqual([]);
  });

  it('the rules results panel reaches for the primitives, not its own markup', () => {
    const source = readFileSync(resolve(SRC, 'components/RuleSetExecutionResults.vue'), 'utf8');
    expect(source).toContain("import EmptyState from './shared/EmptyState.vue'");
    expect(source).toContain("import SectionLabel from './shared/SectionLabel.vue'");
    // The container is a column again, not a label: 08bffbc grouped it into one.
    expect(source).toMatch(/\.iterations-section\s*\{[^}]*flex-direction:\s*column/);
  });
});

/*
 * The fourth pass took a shape rather than a work area: the blocks that were
 * already a centred column with no chrome of their own, so converting them
 * needed no decision. See docs/reference/ui-design-tokens.md for the
 * test that selected them and for the four kinds of block left alone.
 *
 * The guard is the same bargain as the labels above — the private rules are
 * gone, and what keeps them gone is that re-growing one fails here rather than
 * being noticed at the next audit.
 */
/*
 * The fourteenth pass: the label axis, closed over `src`.
 *
 * The second pass took 98 hand-written uppercase-label rules from 54 distinct
 * specs to 20, three of which cover 70 of them — the three this file pins
 * above, and the three `SectionLabel` renders. It left the other 17 as
 * deliberate residue and normalised rather than converted, so the markup stayed
 * hand-written. What has held the line since is the guard above, which reads
 * five files. Outside those five, 75 scoped rules in 47 files still set
 * `text-transform: uppercase` themselves.
 *
 * So the guard closes over `src`, the ninth and eleventh passes' move applied
 * to the axis issue #37 leads with. What converts here is what converts with no
 * pixel moving: a rule whose whole type IS one of the three canonical specs —
 * size, tracking, weight and ink together. Everything else is recorded below
 * with its reason, because the reasons are the finding: the label scale names
 * three specs and the tree writes five sizes and six tracking values, and no
 * amount of sweeping decides which of those is right.
 *
 * A residue entry is not a suppression. It records a site the primitive cannot
 * take yet AND why, and the list is exact in both directions — a site that
 * leaves it (converted, or renamed) fails here, the way the note guard's does.
 *
 * Two exclusions, both older than this pass. A `th` is table chrome: it cannot
 * be a component and its uppercase belongs to the cell, which is the exemption
 * the five-file guard above already carried. And `pages/tests/` and
 * `pages/wireframe-*` are mockups — a scope rather than a suppression, since
 * none of them renders in the product.
 */
describe('SectionLabel adoption', () => {
  /*
   * Comments come out before the rules are read. The naive `selector { body }`
   * split above treats whatever precedes a rule as part of its selector, so a
   * comment that says WHY a rule is written the way it is would arrive here as
   * part of the rule's name — and the residue key would change every time
   * someone reworded it. Stripping them is what lets a site carry its reason at
   * the site as well as in the list below.
   */
  const styleOf = (source: string) => {
    const at = source.search(/<style[^>]*>/);
    return at < 0 ? '' : source.slice(at).replace(/\/\*[\s\S]*?\*\//g, '');
  };

  /*
   * Grouped by the reason rather than by the file, because the reasons are what
   * the next pass has to decide and there are four of them, not forty-seven.
   *
   * 1. THE DENSE STEP. `--text-micro` is a fourth size the scale does not name,
   *    and the eighteen sites at it disagree on tracking across 0.04–0.08em —
   *    so it is not one unnamed step but an unnamed step with no agreed
   *    tracking. #428 settles the naming for the primitive beside this one
   *    (`xs` is `--text-micro`, `sm` stays `--text-label`); what it cannot
   *    settle is which tracking a label takes there.
   * 2. TRACKING OFF THE SCALE. The type is `--text-label`, the canonical `sm`
   *    size, at a tracking `sm` does not use. Converting moves the glyphs.
   * 3. A NON-MUTED INK. `sm`/`md` are `--ink-muted` and `lg` is
   *    `--ink-secondary`; these labels carry emphasis or state instead, which
   *    is a tone decision rather than a size one.
   * 4. NOT A LABEL. A datum, a pill, a table header row or a control's own
   *    text. The same distinction the note guard draws between a sentence and
   *    a value, one case up.
   */
  const RESIDUE: Record<string, string> = {
    // 1. The dense step: --text-micro, and no agreed tracking at it.
    'components/BackendWorkArea.vue: .backend-section-label':
      'the dense step, 0.06em — renamed off the primitive\u2019s own class by this pass',
    'components/CommandPalette.vue: .palette__heading':
      'the dense step, 0.06em, and on --muted-foreground rather than the ink ramp',
    'components/EntityListSidebar.vue: .cluster-name': 'the dense step, 0.05em',
    'components/EntityListSidebar.vue: .group-name': 'the dense step, 0.04em, at medium weight',
    'components/LibrarySwitcher.vue: .library-menu-heading': 'the dense step, 0.08em — the widest in the tree',
    'components/ShortcutCheatSheet.vue: .sheet__heading':
      'the dense step, 0.06em, and on --muted-foreground rather than the ink ramp',
    'components/benchmarks/BenchmarkPlanSidebar.vue: .zone-name': 'the dense step, 0.05em',
    'components/benchmarks/BenchmarkRunView.vue: .request-head': 'the dense step, 0.04em',
    'components/benchmarks/BenchmarkRunView.vue: .summary-label': 'the dense step, 0.05em',
    'components/build/CallableComposition.vue: .column-label': 'the dense step, 0.04em',
    'components/build/CallableTable.vue: .column-label': 'the dense step, 0.04em',
    'components/build/CallableTryIt.vue: .field-label': 'the dense step, 0.04em',
    'components/library-notebook/SaveAsTestDialog.vue: .field__label': 'the dense step, 0.05em',
    'components/query-group/QueryGroupArgumentsPanel.vue: .data-graph-title':
      'the dense step, 0.04em, with no weight of its own',
    'components/query-work-area/ArgumentSetSwitcher.vue: .menu-heading':
      'the dense step, 0.06em, with no weight of its own',
    'components/shared/CodeSnippetPanel.vue: .arguments-title': 'the dense step, 0.04em',
    'components/shared/CodeSnippetPanel.vue: .snippet-label': 'the dense step, 0.04em',
    'components/shared/InlinePrefixAdder.vue: .popover-label': 'the dense step, 0.06em, at weight 700',

    // 2. --text-label at a tracking `sm` does not use.
    'components/BackendListSidebar.vue: .rail-label': 'the sm size at 0.06em',
    'components/EntityListSidebar.vue: .rail-label': 'the sm size at 0.06em',
    'components/EntityListSidebar.vue: .section-name': 'the sm size at 0.05em',
    'components/PrefixMappingsEditor.vue: .column-label': 'the sm size at 0.06em',
    'components/build/ConfigSection.vue: .section-title': 'the sm size at 0.05em',
    'components/query-group/CanvasObjectEditor.vue: .mapping-title': 'the sm size at 0.03em',
    'components/query-work-area/ArgumentScalarsPanel.vue: .scalars-title': 'the sm size at 0.04em',
    'components/query-work-area/TupleBindingEditor.vue: .clause-title': 'the sm size at 0.04em',
    'components/shared/EntityDetailsPanel.vue: .group-label': 'the sm size at 0.05em',

    // 3. A label the scale has no ink for.
    'components/QueryGroupWorkArea.vue: .validation-issues-title':
      'painted --action-ink: the label of a block that is itself a verdict',
    'components/benchmarks/BenchmarkArgumentSetPanel.vue: .block-label': 'painted --ink, not the muted ramp',
    'components/benchmarks/BenchmarkCaseEditor.vue: .block-label': 'painted --ink, not the muted ramp',
    'components/benchmarks/BenchmarkRequestDetail.vue: .block-label': 'painted --ink, not the muted ramp',
    'components/benchmarks/BenchmarkRunView.vue: .block-label': 'painted --ink, not the muted ramp',
    'components/shared/SparqlEditorPanel.vue: .outputs-label': 'painted --action: it names a live detection, not a section',

    // 4. Not a label: a datum, a pill, table chrome, or a control's own text.
    'components/ArgumentSetWorkArea.vue: .fits-verdict': 'a pill with a state modifier — StatusBadge’s shape',
    'components/EtlPlayground.vue: .peek-badge': 'a pill on --action, reading "LIMIT 10"',
    'components/EtlPlayground.vue: .peek-col-type': 'the column’s DuckDB type, printed inside a th — a datum',
    'components/EtlPlayground.vue: .table-header':
      'the grid row above a table; the uppercase is inherited by its cells',
    'components/QueryWorkArea.vue: .var-nodekind-badge': 'a badge naming a term’s node kind',
    'components/query-group/CanvasObjectEditor.vue: .column-header':
      'a hand-rolled table header row: the cells carry per-column layout, and display:flex on the class would tie with the primitive on specificity',
    'components/query-group/CanvasObjectEditor.vue: .summary-label':
      'a block above its value, and the primitive is inline-flex: a parent override would tie on specificity',
    'components/query-group/QueryGroupCanvasNode.vue: .node-execution-status': 'a run status — StatusBadge’s role',
    'components/query-group/QueryGroupCanvasNode.vue: .node-kind': 'the node’s kind, at --text-content and no weight of its own',
    'components/query-group/QueryGroupCanvasNode.vue: .node-name-label':
      'the sm size and ink, but no weight: it inherits the node’s',
    'components/query-work-area/ArgumentSetSwitcher.vue: .state-badge': 'a badge naming a set’s state',
    'components/rules/SrlPreviewDialog.vue: .tag': 'a tag pill',
    'components/shared/ExpandButton.vue: .expand-button-text':
      'a control’s own text: tracking and case, no type of its own — the -button exemption the note guard draws',
    'pages/examples/index.vue: .badge': 'a badge on the examples index',
  };

  it('every hand-written uppercase label is converted or recorded as residue', () => {
    const found: string[] = [];
    for (const file of vueFiles(SRC)) {
      const rel = file.slice(SRC.length + 1);
      if (rel === 'components/shared/SectionLabel.vue' || MOCKUPS.test(rel)) continue;
      const style = styleOf(readFileSync(file, 'utf8'));
      if (!style) continue;
      for (const [, selector, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/text-transform:\s*uppercase/.test(body)) continue;
        const printed = selector.trim().replace(/\s+/g, ' ');
        // Table chrome: the uppercase belongs to the cell, and a `th` cannot be
        // a component.
        if (/\bth\b/.test(printed)) continue;
        found.push(`${rel}: ${printed}`);
      }
    }
    expect(
      found.sort(),
      'a hand-written uppercase label — use <SectionLabel>, or record it in RESIDUE with its reason',
    ).toEqual(Object.keys(RESIDUE).sort());
  });

  /*
   * The seventh pass's hazard, for this primitive: Vue gives a child
   * component's root element the parent's scope attribute, so a rule a file
   * writes for `.section-label` also lands on every <SectionLabel> it renders,
   * at equal specificity, leaving the winner to chunk order. Passing a class
   * and styling that is the deliberate form.
   */
  it('no component but SectionLabel writes a rule for .section-label', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/SectionLabel.vue')) continue;
      const style = styleOf(readFileSync(file, 'utf8'));
      if (!style) continue;
      for (const [, selectorGroup] of style.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const selector of selectorGroup.split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (!/\.section-label\b/.test(trimmed) || /:deep\(/.test(trimmed)) continue;
          offenders.push(`${file.slice(SRC.length + 1)}: ${trimmed}`);
        }
      }
    }
    expect(
      offenders,
      'a scoped .section-label rule lands on every <SectionLabel> the file renders — pass a class instead',
    ).toEqual([]);
  });
});

describe('EmptyState adoption', () => {
  const ADOPTED = [
    'components/query-work-area/QueryResultsPanel.vue',
    'components/MediaTypeCodeViewer.vue',
    'components/build/CallableTable.vue',
    'components/PrefixMappingsEditor.vue',
    'components/BenchmarkWorkArea.vue',
    'components/tests/TestRunsPanel.vue',
  ];

  /* The codemod's family, so the guard catches `.no-data` as well as `.empty`. */
  const EMPTY_SELECTOR = /\.[a-z0-9-]*(empty|no-results|no-data|placeholder)[a-z0-9-]*(\s*[,:.]|\s*$)/i;

  /**
   * The selector without the comment above it. A rule's prelude runs from the
   * previous `}`, so a comment explaining the rule arrives inside the match —
   * which would put the explanation in the residue key below, and let the word
   * "empty-state" inside a comment read as a rule for it.
   */
  const selectorOf = (selector: string) =>
    selector.replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/\s+/g, ' ');

  it.each(ADOPTED)('%s reaches for EmptyState', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    expect(source).toMatch(/import EmptyState from '[^']*shared\/EmptyState\.vue';/);
  });

  it.each(ADOPTED)('%s defines no empty state of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map(([, selector]) => selectorOf(selector))
      .filter((selector) => EMPTY_SELECTOR.test(selector))
      // A control handed to the `actions` slot is a button, not an empty state —
      // the same distinction the `th` filter draws above.
      .filter((selector) => !/-button\b/.test(selector));
    expect(offenders, `${file} re-grew a private empty state — use EmptyState`).toEqual([]);
  });

  /*
   * The two checks above are closed over the six files that were converted and
   * over nothing else, which is the same shape the note guard was in before it
   * was closed over `src`: a file that never adopted the primitive satisfies
   * nothing here and fails nothing. Five hand-written empty states sat outside
   * the list the whole time — two of them the canvas overlays `CanvasSurface`
   * has since taken, and three that wrote `.empty-state`, the primitive's own
   * class.
   *
   * So the guard reads what an empty state *is* rather than which files were
   * swept. The signature is the pair the primitive states on its title:
   * `--text-body-lg` over a muted or secondary ink. It is narrow on purpose —
   * the family name alone catches `.option-dot-empty` (a dot), `.usage-row--empty`
   * (a row modifier) and `.pick.empty` (an italic stand-in for a value), none of
   * which is a panel; and the step below it, `--text-label` over `--ink-muted`,
   * is a note and belongs to `InlineNote`'s guard rather than to this one.
   */
  const TITLE_TYPE = /font-size:\s*var\(--text-body-lg\)/;
  const TITLE_INK = /color:\s*var\((--ink-muted|--ink-secondary|--ink)\)/;

  /**
   * A hand-written empty state that stays hand-written, and why. Each entry is
   * a decision about the site rather than a straggler, so the guard is exact in
   * both directions: converting one of these fails here until its reason goes.
   */
  const RESIDUE: Record<string, string> = {
    'components/QueryWorkArea.vue: .arguments-empty':
      'a row, not a panel: a glyph beside a sentence, restyled again by the focus overlay',
    'components/VersionedEntitySelector.vue: .loading-state, .error-state, .selector-empty':
      'one 200px well shared with loading and error, which the primitive does not state',
    'components/build/AssistantChat.vue: .chat-empty-title':
      'the chat’s opening address — left-aligned with the turns that replace it, at full ink',
  };

  it('every hand-written empty state is converted or recorded as residue', () => {
    const found: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/EmptyState.vue')) continue;
      const source = readFileSync(file, 'utf8');
      const styleAt = source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      for (const [, selector, body] of source.slice(styleAt).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const printed = selectorOf(selector);
        if (!EMPTY_SELECTOR.test(printed)) continue;
        if (!TITLE_TYPE.test(body) || !TITLE_INK.test(body)) continue;
        if (/-button\b/.test(printed)) continue;
        found.push(`${file.slice(SRC.length + 1)}: ${printed}`);
      }
    }
    expect(found.sort(), 'a hand-written empty state — use <EmptyState>, or record it in RESIDUE with its reason')
      .toEqual(Object.keys(RESIDUE).sort());
  });

  /*
   * The hazard PanelHeader and InlineNote already carry, and the one this pass
   * found live: a scoped `.empty-state` rule written anywhere else lands on
   * every <EmptyState> that file renders, at equal specificity, leaving the
   * winner to chunk order. Three components wrote one — none of them rendering
   * the primitive, which is why nothing had gone wrong yet and why nothing
   * would have said so when it did.
   */
  it('no component but EmptyState writes a rule for .empty-state', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/EmptyState.vue')) continue;
      const source = readFileSync(file, 'utf8');
      const styleAt = source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      for (const [, selectorGroup] of source.slice(styleAt).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const selector of selectorOf(selectorGroup).split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (!/\.empty-state\b/.test(trimmed) || /:deep\(/.test(trimmed)) continue;
          offenders.push(`${file.slice(SRC.length + 1)}: ${trimmed}`);
        }
      }
    }
    expect(offenders, 'a scoped .empty-state rule lands on every <EmptyState> the file renders — name the private block for what it is').toEqual([]);
  });
});

/*
 * The canvas archetype (issue #39, design doc §6 step 5).
 *
 * Two screens draw a graph and neither had a skeleton to be an instance of, so
 * the first one wrote the skeleton into itself. What the shell absorbed is the
 * part that was never query groups' own: the split, the positioned box the
 * flow sits in, the layers its floating chrome is positioned against, and the
 * theming of Vue Flow's own controls.
 *
 * The last two guards take no file list, for the reason `unreachableScopedRules`
 * takes none: a second copy of a global stylesheet request, or a second opinion
 * about `.vue-flow__controls`, is wrong wherever it is written — and the next
 * canvas is what this is for.
 */
describe('canvas archetype adoption', () => {
  const CANVASES = ['components/QueryGroupWorkArea.vue', 'components/rules/StratificationGraph.vue'];

  it.each(CANVASES)('%s reaches for the archetype', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    expect(source).toMatch(/import Canvas(Shell|Surface) from '[^']*Canvas(Shell|Surface)\.vue';/);
  });

  /*
   * And the general form of the two above: rendering a `<VueFlow>` is what
   * makes a screen a canvas, so it is also what puts it under the archetype.
   * A file list would have said "these two"; the point is the third.
   */
  it('every component that draws a flow is an instance of the archetype', () => {
    const offenders = vueFiles(SRC)
      // The archetype itself names the flow in its docblock and mounts none.
      .filter((file) => !/shared\/Canvas(Shell|Surface)\.vue$/.test(file))
      .filter((file) => /<VueFlow[\s>]/.test(readFileSync(file, 'utf8')))
      .filter((file) => !/import Canvas(Shell|Surface) from/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders, 'a canvas is an instance of the canvas archetype — mount the flow in <CanvasSurface>').toEqual([]);
  });

  it('only CanvasSurface asks for the Vue Flow stylesheets', () => {
    const offenders = vueFiles(SRC)
      .filter((file) => !file.endsWith('shared/CanvasSurface.vue'))
      .filter((file) => /@import '@vue-flow\//.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders, 'the Vue Flow stylesheets are global; importing them twice is two requests for one answer').toEqual([]);
  });

  it('only CanvasSurface themes the Vue Flow controls', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/CanvasSurface.vue')) continue;
      const source = readFileSync(file, 'utf8');
      const styleAt = source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      for (const [, selectorGroup] of source.slice(styleAt).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const selector of selectorGroup.split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (!/\.vue-flow__controls/.test(trimmed)) continue;
          offenders.push(`${file.slice(SRC.length + 1)}: ${trimmed}`);
        }
      }
    }
    expect(offenders, 'the controls are the archetype’s chrome — theme them in CanvasSurface').toEqual([]);
  });
});

describe('stratum palette', () => {
  it('wraps around the palette', () => {
    expect(stratumColor(0)).toBe(STRATUM_PALETTE[0]);
    expect(stratumColor(STRATUM_PALETTE.length)).toBe(STRATUM_PALETTE[0]);
    expect(stratumColor(-1)).toBe(STRATUM_PALETTE[1]);
  });

  it('returns the none colour for absent or non-numeric input', () => {
    for (const v of [null, undefined, '', 'abc', NaN]) {
      expect(stratumColor(v as never)).toBe(STRATUM_NONE);
    }
  });

  it('references tokens rather than literals', () => {
    for (const c of STRATUM_PALETTE) expect(c).toMatch(/^var\(--stratum-\d\)$/);
  });
});

describe('token layer', () => {
  const tokens = readFileSync(resolve(SRC, 'assets/css/tokens.css'), 'utf8');

  it('defines every semantic token the components rely on', () => {
    const required = [
      '--surface', '--surface-subtle', '--surface-sunken', '--surface-raised',
      '--ink', '--ink-secondary', '--ink-muted', '--ink-inverse',
      '--border-subtle', '--border-default', '--border-strong',
      '--action', '--success', '--danger', '--warning', '--info',
      '--control-h', '--grid-unit', '--grid-gap',
      '--radius', '--text-body',
    ];
    for (const token of required) {
      expect(tokens, `${token} missing from tokens.css`).toContain(`${token}:`);
    }
  });

  it('redefines the semantic layer for dark mode without touching primitives', () => {
    const dark = tokens.slice(tokens.indexOf('.dark {'));
    expect(dark).toContain('--surface:');
    expect(dark).toContain('--ink:');
    // primitives are theme-independent and must not be overridden
    expect(dark).not.toMatch(/^\s*--gray-\d+:/m);
  });

  it('keeps the grid steps on the (28 x N) + (6 x (N-1)) formula', () => {
    for (let n = 1; n <= 8; n += 1) {
      const expected = 28 * n + 6 * (n - 1);
      expect(tokens).toContain(`--grid-${n}: ${expected}px;`);
    }
  });
});

/*
 * The eighth pass: the title bar of a full-bleed dialog.
 *
 * Three dialogs opt out of shadcn's padded header and corner ✕ — `p-0 gap-0`
 * on the content, `show-close-button` off — and draw a 12px title row of their
 * own above a body that owns its padding and its scrolling. That bar was
 * written out three times, down to the same six declarations.
 *
 * It is not `PanelHeader`: the title has to be `DialogTitle`, because that is
 * what `DialogContent` points `aria-labelledby` at. See
 * docs/reference/ui-design-tokens.md and 2026-08-24-dialogs.md §2.
 */
describe('DialogTitleBar adoption', () => {
  const BAR_DIALOGS = [
    'components/SettingsDialog.vue',
    'components/PrefixSyncDialog.vue',
    'components/PrefixMappingsEditor.vue',
  ];

  it.each(BAR_DIALOGS)('%s reaches for DialogTitleBar', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    expect(source).toMatch(/import DialogTitleBar from '[^']*DialogTitleBar\.vue';/);
  });

  /*
   * The spec rather than the name, as the well and the focus bar are guarded:
   * a row spacing a title against trailing actions, ruled off underneath, at
   * the dialog padding step. `--space-5` all round is what separates it from a
   * panel header (6/12) and from a focus title bar (16/24), so the padding
   * clause is what keeps this guard off both.
   */
  it.each(BAR_DIALOGS)('%s draws no dialog title bar of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) =>
        /justify-content:\s*space-between/.test(body) &&
        /border-bottom:/.test(body) &&
        /padding:\s*var\(--space-5\)\s*;/.test(body))
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '));
    expect(offenders, `${file} re-grew a private dialog title bar — use <DialogTitleBar>`).toEqual([]);
  });

  /*
   * And the reason the group is exactly these three: a dialog that turns the
   * built-in ✕ off has taken responsibility for drawing the close itself,
   * which is the whole of what this bar is for. A fourth one appearing is a
   * fourth copy of the row unless it reaches for the primitive.
   */
  it('every dialog that turns off the built-in close uses the bar', () => {
    const offenders = vueFiles(SRC)
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return /show-close-button="false"/.test(source) && !/DialogTitleBar/.test(source);
      })
      .map((file) => file.slice(SRC.length + 1));
    expect(offenders, 'a dialog drawing its own close should draw it in <DialogTitleBar>').toEqual([]);
  });
});

/*
 * The ninth pass: the CSS the extractions left behind.
 *
 * Each of the three passes before this one found the same leftover in whatever
 * file it happened to be reading — a scoped rule for markup that had moved out
 * into a component of its own. The seventh pass found seven of them in one
 * group of eleven, and one was a live defect rather than clutter: a
 * `.panel-header` rule `EtlPlayground` kept after the `InspectorPanel`
 * extraction was re-padding a `<PanelHeader>` the pass before had just
 * converted.
 *
 * So this stops being an observation and becomes a rule. `unreachableScopedRules`
 * states the proof — the scope attribute lands on the last compound, and only
 * three kinds of element carry it — and the guard is that the tree holds none.
 * Unlike the adoption guards above it takes no file list: a rule that cannot
 * match is wrong wherever it is written, and the next extraction is what this
 * is for.
 */
describe('scoped CSS the template can reach', () => {
  it('no component keeps a scoped rule nothing it renders can match', () => {
    const offenders = unreachableScopedRules(SRC).map((r) => `${r.file}: ${r.selector}  [${r.classes.join(', ')}]`);
    expect(offenders, 'a scoped rule whose classes the file never writes is dead — delete it, or reach in with :deep()').toEqual([]);
  });

  /*
   * And that it bites, on the ways a class arrives that the audit has to keep
   * quiet about as much as on the dead rule it is looking for. A guard this
   * broad is only worth having if its exemptions are the ones it claims.
   *
   * The ancestor rules — which of these the audit spares, and why the question
   * is asked of the compound rather than of each class — are pinned one case at
   * a time in `test/lib/scopedCss.test.ts`.
   */
  it('finds the dead rule and none of the live ones', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'scoped-css-'));
    writeFileSync(resolve(dir, 'Child.vue'), '<template>\n  <div class="child-root" />\n</template>\n');
    /*
     * The tree's own `useTheme`, in miniature: where `.dark` comes from. It is
     * the `classList` call and not `tokens.css` — a stylesheet that declares
     * `.dark` says nothing about any element carrying it, which is why the
     * audit reads the call rather than the declaration.
     */
    writeFileSync(resolve(dir, 'theme.css'), '.dark { color-scheme: dark; }\n');
    writeFileSync(
      resolve(dir, 'useTheme.ts'),
      "export const apply = (on: boolean) => document.documentElement.classList.toggle('dark', on);\n",
    );
    writeFileSync(
      resolve(dir, 'Pane.vue'),
      [
        '<template>',
        '  <div class="pane" :class="`chip--${tone}`">',
        '    <Child />',
        '    <div v-html="rendered" />',
        '    <Transition name="fade"><p v-if="tone">x</p></Transition>',
        '  </div>',
        '</template>',
        '',
        "<script setup lang=\"ts\">",
        "import Child from './Child.vue';",
        'const tone = "warn";',
        'const rendered = "<b class=\'from-html\'>x</b>";',
        '</script>',
        '',
        '<style scoped>',
        '.pane { color: red; }',                       /* written by the template */
        '.dark .pane { color: blue; }',                /* a global ancestor is fine */
        '.chip--warn { color: green; }',               /* named by the interpolated family */
        '.child-root { color: teal; }',                /* the child’s root carries our scope */
        '.pane :deep(.from-html) { color: grey; }',    /* deliberately reaching past it */
        '.fade-enter-active { color: pink; }',          /* minted by <Transition name="fade"> */
        '.fade-leave-to { color: olive; }',             /* and its five siblings */
        '.fade-overlay { color: navy; }',               /* NOT minted — a name, not the family */
        '.gone { color: black; }',                     /* nothing writes this */
        '.ghost .pane { color: white; }',              /* an ancestor that exists nowhere */
        '</style>',
        '',
      ].join('\n'),
    );

    const found = unreachableScopedRules(dir);
    expect(found.map((r) => r.selector).sort()).toEqual(['.fade-overlay', '.ghost .pane', '.gone']);

    rmSync(dir, { recursive: true, force: true });
  });
});


/*
 * The tenth pass: the muted sentence.
 *
 * `SectionLabel` is the 11px uppercase muted label; `InlineNote` is its
 * lowercase twin, and it was the one of the two nobody had written. The same
 * two declarations — `--text-label` on `--ink-muted` — are hand-written 64
 * times across 39 files, `FormField` and `InlineField` among them: the two
 * primitives that exist so a labelled control is not drawn by hand each drew
 * their own hint.
 *
 * The group converted here is complete by directory rather than by count —
 * every note in `components/shared/` and `components/backends/` — which is
 * `FormField`'s own docblock applied to itself: "the existing dozen can move
 * onto it a component at a time without a flag day", starting with the shelf
 * the primitives live on.
 */
describe('InlineNote', () => {
  it('renders a paragraph by default and honours `as`', () => {
    expect(mount(InlineNote, { slots: { default: 'No versions yet' } }).element.tagName).toBe('P');
    expect(mount(InlineNote, { props: { as: 'span' }, slots: { default: 'v3' } }).element.tagName).toBe('SPAN');
  });

  /*
   * `danger` is a tone rather than a second component because that is how the
   * sites wrote it: `InlineField` had `__hint` and `__error` as one spec
   * differing in `color`, and six other files carry a `--error` modifier over
   * their own note class.
   */
  it('carries the tone as a modifier, muted by default', () => {
    expect(mount(InlineNote, { slots: { default: 'x' } }).classes()).toContain('inline-note--muted');
    expect(mount(InlineNote, { props: { tone: 'danger' }, slots: { default: 'x' } }).classes()).toContain('inline-note--danger');
  });

  /*
   * The dense step, and the reason it is named `sm`/`xs` rather than `md`/`sm`:
   * `sm` is `--text-label` on this primitive and on `SectionLabel` alike, so a
   * tile that renders a label over a note (`TestRunResults`) reads one scale
   * name for one size. A `sm` that meant 11px in one and 10px in the other
   * would be a trap at exactly the sites that use both.
   */
  it('carries the size as a modifier, the label step by default', () => {
    expect(mount(InlineNote, { slots: { default: 'x' } }).classes()).toContain('inline-note--sm');
    expect(mount(InlineNote, { props: { size: 'xs' }, slots: { default: 'x' } }).classes()).toContain('inline-note--xs');
  });

  /*
   * The tenth pass closed `components/shared/` and `components/backends/`; the
   * eleventh took the rest of the muted sentences — the work areas, the
   * benchmark panels, the dialogs — leaving seven sites that each need a
   * decision rather than a conversion. They are named in the design note's
   * residue list; the short version is that four are not sentences (two footer
   * counts, a strip summary and a pill), one is an italic placeholder, one is
   * drawn by reka-ui, and one sets a tighter line-height than the primitive
   * states.
   */
  const ADOPTED = [
    'components/shared/FormField.vue',
    'components/shared/CodeSnippetPanel.vue',
    'components/shared/EntityDetailsPanel.vue',
    'components/backends/InlineField.vue',
    'components/backends/MemorySourcesEditor.vue',
    'components/BackendListSidebar.vue',
    'components/BackendWorkArea.vue',
    'components/DataGraphWorkArea.vue',
    'components/RuleSetExecutionResults.vue',
    'components/TupleSetWorkArea.vue',
    'components/benchmarks/BenchmarkArgumentSetPanel.vue',
    'components/benchmarks/BenchmarkCaseEditor.vue',
    'components/benchmarks/BenchmarkPlanDetail.vue',
    'components/benchmarks/BenchmarkRequestDetail.vue',
    'components/benchmarks/BenchmarkRunView.vue',
    'components/build/CallableComposition.vue',
    'components/build/ConfigSection.vue',
    'components/build/ConnectAssistant.vue',
    'components/library-notebook/SaveAsTestDialog.vue',
    'components/query-work-area/TupleSetPicker.vue',
    'components/rules/RuleSetExecutionReplay.vue',
    'components/tags/InheritTagsToggle.vue',
    'components/tags/TagPicker.vue',
    'components/tuple-sets/TupleRowsBuilder.vue',
    // The twelfth pass, at the dense step.
    'components/EntityListSidebar.vue',
    'components/benchmarks/BenchmarkPlanSidebar.vue',
    'components/build/AssistantChat.vue',
    'components/etl/TupleSetSink.vue',
    'components/query-group/QueryGroupArgumentsPanel.vue',
    'components/query-work-area/ArgumentScalarsPanel.vue',
    'components/query-work-area/ArgumentSetFooter.vue',
    'components/query-work-area/ArgumentSetSwitcher.vue',
    'components/query-work-area/TupleBindingEditor.vue',
    'components/tests/RunByTagMenu.vue',
    'components/tests/TestReportExportMenu.vue',
    'components/tests/TestRunBreakdown.vue',
    'components/tests/TestRunExportMenu.vue',
  ];

  it.each(ADOPTED)('%s reaches for InlineNote', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    expect(source).toMatch(/import InlineNote from '[^']*InlineNote\.vue';/);
  });

  /*
   * This guard is by NAME, where the well's and the title bar's are by shape —
   * and the difference is the point rather than a lapse. A well is a shape: a
   * dashed rule on `--surface-subtle` is one thing and nothing else, so a name
   * test would have missed the site called nothing at all. A note is a ROLE, and
   * it shares its whole spec with the datum — `CodeSnippetPanel`'s
   * `.argument-detail` sets exactly these two declarations and renders
   * "integer · LIMIT", which is a value shown small and not a sentence. A shape
   * test would demand it convert; the name is what tells them apart.
   *
   * Both clauses are load-bearing. The colour one used to keep the guard off
   * `EntityDetailsPanel`'s `.group-hint` and `.footer-note` — notes by role at
   * `--ink-disabled`, a tone the tenth pass did not settle. The thirteenth
   * settled it, so both are `<InlineNote>` now and the clause is doing its
   * other job: keeping the guard off a note deliberately painted something
   * else.
   */
  const NOTE_SELECTOR = /\.[a-z0-9_-]*(note|hint|message|empty)[a-z0-9_-]*(\s*[,:.{]|\s*$)/i;

  /*
   * Both steps the primitive states: `--text-label` is the scale the tenth and
   * eleventh passes converted, `--text-micro` the dense step the twelfth added.
   * They are read together, so a note written one point smaller than the one
   * beside it is covered rather than invisible — which is how eighteen of them
   * came to be hand-written while the guard was green.
   */
  const SIZE_CLAUSE = /font-size:\s*var\(--text-(label|micro)\)/;

  it.each(ADOPTED)('%s writes no note type of its own', (file) => {
    const source = readFileSync(resolve(SRC, file), 'utf8');
    const style = source.slice(source.search(/<style[^>]*>/));
    const offenders = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector, body]) =>
        NOTE_SELECTOR.test(selector) &&
        SIZE_CLAUSE.test(body) &&
        /color:\s*var\((--ink-muted|--danger-ink)\)/.test(body))
      .map(([, selector]) => selector.trim().replace(/\s+/g, ' '))
      // A control offered beside a note is a button, the same distinction the
      // empty-state guard draws.
      .filter((selector) => !/-button\b/.test(selector))
      // A site the tree-wide guard below records with its reason is not a
      // regrowth: an adopted file can carry a residue entry, and that entry is
      // checked there, exact in both directions.
      .filter((selector) => !(`${file}: ${selector}` in RESIDUE));
    expect(offenders, `${file} re-grew a private inline note — use <InlineNote>`).toEqual([]);
  });

  /*
   * With the eleventh pass the adoption list is no longer a sample, so the
   * guard can be closed over `src` — the ninth pass's move, and for the same
   * reason: what is left is countable and each entry has a reason, so a new
   * hand-written note is the only thing this can newly fail on.
   *
   * A residue entry is not a suppression. It records a site the primitive
   * cannot take yet AND why, and the list is exact in both directions — a site
   * that leaves it (converted, or renamed) fails here, the way
   * `visual-baselines-pending.txt` fails on an entry that has since been
   * baselined. The reasons are the design note's, restated where they can be
   * checked.
   */
  const RESIDUE: Record<string, string> = {
    'components/EtlPlayground.vue: .iri-note':
      'italic muted standing in for a value nobody entered — a fourth thing, not a third tone',
    'components/PrefixMappingsEditor.vue: .row-note':
      'line-height 1.4, and the primitive states 1.5: a parent override would tie on specificity',
    'components/query-work-area/QueryEditorFooter.vue: .footer-note':
      'renders "142 lines" — a datum the name calls a note',
    'components/rules/RuleSetEditorFooter.vue: .footer-note':
      'the same count, in the other footer',
    'components/shared/EditorStrip.vue: .strip-summary, .strip-hint':
      'a datum and a pill — the hint carries a border, a radius and a ground',
    'components/shared/SearchSelect.vue: .search-select__empty':
      "drawn by reka-ui's ComboboxEmpty, which owns the tag",
    // The dense step brought its own false positives, and they are the same
    // kind the eleventh pass found: a name with "note" in it over a count.
    'components/shared/ResultsFooter.vue: .footer-pill-note':
      'a qualifier inside a pill — "filtered" said of the row count beside it',
    'components/tests/TestRunResults.vue: .pending-note':
      'renders "7 still to run" in a row of tallies — a count, like the footers',
    'components/tests/TestRunResults.vue: .tile-note':
      'the tile caption under a value: "12 tests", "wall clock"',
    'components/tests/TestRunsPanel.vue: .tally-note':
      'the same two counts, in the runs footer',
    // The thirteenth pass, on a parallel branch, recoloured these from
    // `--ink-disabled` to `--ink-muted` — which is what made them visible to the
    // widened guard once both passes met on `main`. That pass's note names
    // them and asks whichever lands second to convert them to
    // `<InlineNote size="xs">` or record them here; recorded, so the
    // conversion (and the sentence-or-datum call each needs) is its own step.
    'components/BackendListSidebar.vue: .footer-note':
      'recoloured by the thirteenth pass; also states --leading-tight, the .row-note objection',
    'components/benchmarks/BenchmarkPlanDetail.vue: .field-hint':
      'recoloured by the thirteenth pass; renders units beside a control — "ms", "concurrent"',
    'components/benchmarks/BenchmarkPlanSidebar.vue: .axis-hint, .axis-empty':
      'recoloured by the thirteenth pass; a note and an empty line, waiting on the conversion',
    'components/benchmarks/BenchmarkPlanSidebar.vue: .zone-note':
      'recoloured by the thirteenth pass; "these multiply" beside a zone rule',
    'components/benchmarks/BenchmarkRunView.vue: .summary-note':
      'recoloured by the thirteenth pass; the note beside a summary cell value',
    'components/benchmarks/BenchmarkRunView.vue: .timeline-note':
      'recoloured by the thirteenth pass; carries the lane indent — see the comment at the rule',
    'components/query-work-area/TermTypeMenuItems.vue: <style scoped> .type-note':
      'written at the dense step on a parallel branch; a sentence, waiting on the conversion',
  };

  it('every hand-written muted note is converted or recorded as residue', () => {
    const found: string[] = [];
    for (const file of vueFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      const styleAt = source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      for (const [, selector, body] of source.slice(styleAt).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!NOTE_SELECTOR.test(selector)) continue;
        if (!SIZE_CLAUSE.test(body)) continue;
        if (!/color:\s*var\((--ink-muted|--danger-ink)\)/.test(body)) continue;
        const printed = selector.trim().replace(/\s+/g, ' ');
        if (/-button\b/.test(printed)) continue;
        found.push(`${file.slice(SRC.length + 1)}: ${printed}`);
      }
    }
    expect(found.sort(), 'a hand-written muted note — use <InlineNote>, or record it in RESIDUE with its reason')
      .toEqual(Object.keys(RESIDUE).sort());
  });

  /*
   * The seventh pass's hazard, for this primitive: a scoped rule for
   * `.inline-note` written anywhere else lands on every <InlineNote> that file
   * renders, at equal specificity, leaving the winner to chunk order. Passing a
   * class and styling that is the deliberate form — the note's position is the
   * parent's fact and belongs in the parent's rule; the note's type is not.
   */
  it('no component but InlineNote writes a rule for .inline-note', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/InlineNote.vue')) continue;
      const source = readFileSync(file, 'utf8');
      const styleAt = source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      for (const [, selectorGroup] of source.slice(styleAt).matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const selector of selectorGroup.split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (!/\.inline-note\b/.test(trimmed) || /:deep\(/.test(trimmed)) continue;
          offenders.push(`${file.slice(SRC.length + 1)}: ${trimmed}`);
        }
      }
    }
    expect(offenders, 'a scoped .inline-note rule lands on every <InlineNote> the file renders — pass a class instead').toEqual([]);
  });
});

/*
 * The thirteenth pass: the tone the twelfth left, and the sixth pass's contrast
 * question one altitude down.
 *
 * `--ink-disabled` is the lightest of the four inks and it measures 2.07:1 on
 * the page in light mode — under the 4.5:1 text needs (WCAG 2.2 SC 1.4.3) and
 * under the 3:1 a control's own glyph needs (SC 1.4.11). On an element that IS
 * inactive that is not a defect but the point: 1.4.3 exempts disabled controls,
 * and being visibly unreachable is what the colour says. Everywhere else it is
 * a sentence, a count or a value rendered at a ratio nobody can read, and the
 * sixth pass found one of those by eye months after it shipped.
 *
 * So the rule is about the selector rather than the property: the disabled ink
 * belongs on a disabled state. `test/components/inkContrast.test.ts` computes
 * the numbers this rests on from `tokens.css`, both themes, pinned in both
 * directions.
 *
 * Closed over `src`, the ninth pass's move, with the same bargain as the note
 * guard: a residue entry records a site the rule does not reach AND why, and
 * the list is exact both ways — a site that leaves it fails here too.
 */
describe('the disabled ink', () => {
  /*
   * `.dark .tab-button:hover:not(:disabled)` is why this reads the whole
   * selector rather than its last compound: a hover rule that names `:disabled`
   * only to exclude it was painting the hover state disabled-grey. Excluding a
   * state is not being in it.
   */
  const DISABLED_STATE = /(:disabled|\[data-disabled\]|\.disabled\b|--disabled\b)(?!\))/;

  /*
   * The mockup pages are out, and it is a scope rather than a suppression: all
   * fourteen of their declarations are inside hand-written `.dark` blocks that
   * override the token layer wholesale — the defect the sixth pass named, not
   * this one — and none of them renders in the product. They want the pass that
   * takes those blocks out, and they move no screen a user sees. `MOCKUPS`,
   * at the top of the file, is the list.
   */

  const styleFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) styleFiles(full, out);
      else if (entry.name.endsWith('.vue') || entry.name.endsWith('.css')) out.push(full);
    }
    return out;
  };

  /*
   * What the ink still paints, and why each is not text.
   *
   * The nine are two kinds. Six are an idle affordance — an icon button quiet
   * until you touch it, each with a hover or active rule that brightens it —
   * and their 3:1 question is 1.4.11's, with a different answer: whether the
   * icon-button archetype should be quiet at rest at all is a decision about
   * every icon in the app, not a colour to sweep. The other three paint
   * something that is not a glyph a reader reads.
   */
  const RESIDUE: Record<string, string> = {
    'components/BackendListSidebar.vue: .filter-field':
      'the search glyph inside the field, not the field’s own text',
    'components/EntityListSidebar.vue: .discard-button':
      'an idle icon button — hover paints it --danger',
    'components/build/CallableRow.vue: .expander':
      'an idle chevron — expanded paints it --action',
    'components/query-work-area/ValuesClauseView.vue: .row-remove':
      'an idle icon button — hover paints it --danger-ink',
    'components/query-work-area/ValuesGrid.vue: .btn-cell':
      'an idle icon button — hover paints it --ink',
    'components/shared/EmptyState.vue: .empty-state__icon':
      'the decorative glyph above the title that carries the message',
    'components/shared/RunBar.vue: .pick-chevron':
      'the menu chevron beside a value the pass has already recoloured',
    'components/shared/RunBar.vue: .help':
      'an idle icon button — hover paints it --ink-secondary',
    'components/tests/TestRunsPanel.vue: .tally-sep':
      'the middot between two tallies — punctuation, not a word',
  };

  it('paints no text with the disabled ink', () => {
    const found: string[] = [];
    for (const file of styleFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      if (MOCKUPS.test(relative)) continue;
      const source = readFileSync(file, 'utf8');
      const styleAt = file.endsWith('.css') ? 0 : source.search(/<style[^>]*>/);
      if (styleAt < 0) continue;
      const style = source.slice(styleAt).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const [, selector, body] of style.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!/color:\s*var\(--ink-disabled\)/.test(body)) continue;
        const printed = selector.trim().replace(/\s+/g, ' ');
        if (DISABLED_STATE.test(printed)) continue;
        found.push(`${relative}: ${printed}`);
      }
    }
    expect(found.sort(), 'the disabled ink is 2.07:1 in light mode — use --ink-muted, or record the site in RESIDUE with its reason')
      .toEqual(Object.keys(RESIDUE).sort());
  });
});

/*
 * The fifteenth pass: the badge axis — the fourth of the four things #37's body
 * counts, and the only one no pass had taken.
 *
 * `StatusBadge` has been a primitive since the first pass and had two callers.
 * What it is for is stated in its own header: "execution / validation state,
 * rendered against the --state-* tokens so every surface says invalid in the
 * same red." An audit of `src` finds the same pill hand-written elsewhere —
 * `QueryEditorFooter` and `RuleSetEditorFooter` write it out in three rules
 * each, byte for byte identical between the two files, while the primitive two
 * screens away renders the same four states 2px taller and a weight heavier.
 *
 * The guard is by SHAPE and the shape is a claim: a pill (`--radius-full`) that
 * paints itself from a state family (`--success-*`, `--danger-*`, `--warning-*`,
 * `--action-*`). A neutral chip is a noun and is not this — `CanvasObjectEditor`
 * says so at its own rule, and the neutral chip has no primitive yet, which is
 * the follow-up this pass names rather than takes.
 *
 * Modifiers count as part of the class they modify: a base rule holds the pill
 * and a `.ok`/`--fits`/`.draft` rule holds the colour, so reading them apart
 * would see a pill with no claim beside a claim with no shape and flag neither.
 */
describe('StatusBadge adoption', () => {
  const STATE_TOKEN = /var\(--(success|danger|warning|action)(-(surface|border|ink|hover))?\)/;
  const PAINTS = /^\s*(background|background-color|border|border-color|color)\s*:/;

  /*
   * The class a rule is about: the first class of its last compound, with a BEM
   * modifier folded into what it modifies. `.fits-verdict--partial` is a state
   * of `.fits-verdict` and not a class of its own, and the whole point of
   * grouping is that the shape and the claim are written in different rules.
   */
  /*
   * Comments are stripped before any of this reads a selector. The rule regex
   * every guard in this file uses is `([^{}]+)\{([^{}]*)\}`, which cannot tell
   * a comment from a selector — and the rules below are commented, so the prose
   * explaining the hazard would otherwise be reported as an instance of it.
   */
  function styleSource(file: string): string | null {
    const source = readFileSync(file, 'utf8');
    const styleAt = source.search(/<style[^>]*>/);
    if (styleAt < 0) return null;
    return source.slice(styleAt).replace(/\/\*[\s\S]*?\*\//g, ' ');
  }

  function subject(selector: string): string | null {
    const last = selector.split(',')[0].trim().split(/\s+|>/).pop() ?? '';
    const match = /\.([a-zA-Z0-9_-]+)/.exec(last);
    if (!match) return null;
    return match[1].replace(/--[a-zA-Z0-9_-]+$/, '');
  }

  /*
   * Each entry is a pill the guard reaches that no pass has converted, and the
   * reason. The fourth group the fifteenth pass recorded — eight screens
   * writing the same four token triples under vocabularies of their own — is
   * gone: the sixteenth gave the primitive a `tone`, so a screen keeps its own
   * word and the paint is the primitive's. What is left is three groups, and
   * only the first is a straggler:
   *
   *  - a dot is a marker, not a badge. It has a state colour and no text, so
   *    the primitive would give it a height, a padding and a label it has no
   *    room for. `StatusBadge`'s own dot is the shape these want.
   *  - a pill you can click is a button. Hover, focus and active states are not
   *    the primitive's, and `StatusBadge` renders a `<span>`.
   *  - a pill wearing a shape the primitive does not have: uppercase with
   *    tracking (a `SectionLabel` in a pill), a monospace value, or an outline
   *    form painted from the base colours rather than the triples. Note what is
   *    no longer a reason to hold one of these back — that the action tint on a
   *    noun is not a claim about state. `tone="action"` makes exactly that
   *    claim and no more, so what remains is the shape.
   */
  const RESIDUE: Record<string, string> = {
    // A dot is a marker, not a badge: 6-7px square, no text, no room for any.
    'components/BackendListSidebar.vue: .health-dot': 'a dot — the shape StatusBadge renders as its own __dot',
    'components/BackendWorkArea.vue: .history-dot': 'a dot, one per probe in the history strip',
    'components/EntityListSidebar.vue: .draft-dot': 'a dot beside a list row',
    'pages/build.vue: .feed-dot': 'a dot in the feed status line',
    'pages/library.vue: .backend__dot': 'a dot beside a backend name',

    // A pill you can click is a button. StatusBadge renders a <span> and states
    // no hover, focus or active — giving it those would make every badge in the
    // app look pressable.
    'components/BackendWorkArea.vue: .attach-button': 'a button — dashed "add" affordance, hover is its whole state',
    'components/backends/MemorySourcesEditor.vue: .add-source-button': 'a button — the same dashed affordance',
    'components/rules/RuleSetEditorFooter.vue: .strata-chip': 'a button — opens the Stratification tab; sits beside the badge this pass converted',
    'components/shared/ResultsFooter.vue: .footer-pill': 'a button in its --menu form, and a plain pill otherwise',

    /*
     * The two of the eight vocabularies that did not convert with the rest,
     * and for the other group's reason: both are uppercase with tracking, so
     * they are the pill-shaped `SectionLabel` question rather than the
     * vocabulary one. The examples page's dark-mode hand-rolls are gone
     * regardless — the triples are theme-aware, which is the whole of what
     * those blocks were re-stating in rgba.
     */
    'components/query-work-area/ArgumentSetSwitcher.vue: .state-badge': 'uppercase with tracking, and no border: the pill-shaped label shape',
    'pages/examples/index.vue: .badge': 'uppercase with tracking, and no border — the same shape as .state-badge',

    /*
     * The same shape question in the other files. The tint is no longer the
     * argument — `tone` paints without claiming — so each of these is held by
     * what it is drawn as: uppercase with tracking, an outline form, or a
     * monospace value.
     */
    'components/ArgumentSetWorkArea.vue: .fits-verdict': 'uppercase with tracking, and an outline pill: the base colours, not the -ink/-surface triples',
    'components/EtlPlayground.vue: .peek-badge': 'uppercase with tracking, reading "LIMIT 10"',
    'components/QueryWorkArea.vue: .var-nodekind-badge': 'uppercase with tracking, and a literal form that leaves the state families entirely',
    'components/shared/SparqlEditorPanel.vue: .output-badge': 'a monospace output media type: the primitive has no mono step',
  };

  it('every hand-written state pill is converted or recorded as residue', () => {
    const found: string[] = [];
    for (const file of vueFiles(SRC)) {
      const relative = file.slice(SRC.length + 1);
      if (MOCKUPS.test(relative) || relative.endsWith('shared/StatusBadge.vue')) continue;
      const css = styleSource(file);
      if (css === null) continue;
      const pills = new Set<string>();
      const claims = new Set<string>();
      for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        const name = subject(selector);
        if (!name) continue;
        if (/border-radius:\s*var\(--radius-full\)/.test(body)) pills.add(name);
        if (body.split(';').some((d) => PAINTS.test(d) && STATE_TOKEN.test(d))) claims.add(name);
      }
      for (const name of [...pills].filter((n) => claims.has(n)).sort()) {
        found.push(`${relative}: .${name}`);
      }
    }
    expect(found.sort(), 'a pill painted from a state family — use <StatusBadge>, or record it in RESIDUE with its reason')
      .toEqual(Object.keys(RESIDUE).sort());
  });

  /*
   * The seventh pass's hazard again, and this file had it: a scoped rule for
   * `.status-badge` written anywhere else lands on every <StatusBadge> that
   * file renders, at equal specificity, leaving the winner to chunk order.
   * `RuleSetExecutionResults` carried one — a re-type of a shadcn `Badge` that
   * had taken the primitive's name — and it renders no `<StatusBadge>` today,
   * so nothing collided yet. The first one it rendered would have.
   */
  it('no component but StatusBadge writes a rule for .status-badge', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      if (file.endsWith('shared/StatusBadge.vue')) continue;
      const css = styleSource(file);
      if (css === null) continue;
      for (const [, selectorGroup] of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
        for (const selector of selectorGroup.split(',')) {
          const trimmed = selector.trim().replace(/\s+/g, ' ');
          if (!/\.status-badge\b/.test(trimmed) || /:deep\(/.test(trimmed)) continue;
          offenders.push(`${file.slice(SRC.length + 1)}: ${trimmed}`);
        }
      }
    }
    expect(offenders, 'a scoped .status-badge rule lands on every <StatusBadge> the file renders — name the hook for the caller instead').toEqual([]);
  });

  /*
   * `status` and `tone` are one prop's worth of meaning split in two, and the
   * split is the point: a status is a claim the app makes in its own five
   * words, a tone is the paint under a screen's word. Passing both would let
   * the two disagree — `status="running" tone="neutral"` paints neutral and
   * still throbs — and passing neither leaves the badge grey with no label,
   * which renders rather than failing. Neither is a runtime warning: a prop
   * misuse is the author's error and this is where an author is told about it.
   */
  it('every <StatusBadge> passes exactly one of status and tone', () => {
    const offenders: string[] = [];
    for (const file of vueFiles(SRC)) {
      const source = readFileSync(file, 'utf8');
      /*
       * The template only. Both other blocks name the component in prose —
       * `RuleSetExecutionResults` explains at its own rule why the first
       * `<StatusBadge>` it rendered would have collided — and a comment is not
       * a call site.
       */
      const scriptAt = source.search(/<script[\s>]/);
      const template = scriptAt < 0 ? source : source.slice(0, scriptAt);
      for (const tag of openingTags(template, 'StatusBadge')) {
        const status = /[\s:]status\s*=/.test(tag);
        const tone = /[\s:]tone\s*=/.test(tag);
        if (status === tone) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${tag.replace(/\s+/g, ' ')}`);
        }
      }
    }
    expect(offenders, 'a <StatusBadge> takes a status (a state, with its label) or a tone (the paint alone) — one of them').toEqual([]);
  });
});
