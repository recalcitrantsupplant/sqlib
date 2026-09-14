/**
 * `<sqlib-args>` — the argument builder, as a custom element.
 *
 * Filling in a query's arguments means writing SPARQL Results JSON by hand,
 * which is a poor ask of anyone who is not already fluent in it. The bundle
 * carries enough to do better: `inferredInputs` names the variables of every
 * parameter slot, so a real form can be generated — one column per variable,
 * one row per binding, a kind for each cell.
 *
 * Two properties make this worth being a custom element rather than a widget
 * inside one page:
 *
 * - **Both hosts get the same builder.** The exported HTML page inlines it and
 *   the Vue app imports it, so the thing a person learns in one is the thing
 *   they use in the other. Vue consumes custom elements natively; nothing about
 *   this file knows a framework exists.
 * - **Validation is the runtime's own.** Every cell is checked with
 *   {@link serializeTerm} — the same function that guards the query — so "the
 *   form says this is fine" and "this will substitute" cannot drift apart.
 *
 * Light DOM, deliberately: a shadow root would isolate the styling and both
 * hosts want to theme this from outside. Everything is class-prefixed
 * `sqlib-args__*`, and {@link ARGS_ELEMENT_STYLES} is a serviceable default a
 * host can inject or ignore.
 */

import { InvalidTermError, serializeTerm, type TermValue } from './sparql-terms.js';
import { alignArgumentSets } from './query-template.js';
import type { WireArgumentSet } from './arguments.js';

/** What a query expects, as the bundle describes it. */
export interface ArgsSignature {
  /** Variables per parameter slot, in slot order. */
  inputs: string[][];
  limits?: string[];
  offsets?: string[];
}

/** The payload shape the runtime takes, as this element reads and writes it. */
export interface ArgsPayload {
  arguments: WireArgumentSet[];
  limits?: Record<string, number>;
  offsets?: Record<string, number>;
}

/** How one cell is bound. `undef` is SPARQL's UNDEF: this row says nothing here. */
type CellKind = 'uri' | 'literal' | 'undef';

interface Cell {
  kind: CellKind;
  value: string;
  datatype: string;
  lang: string;
}

interface SlotState {
  vars: string[];
  rows: Array<Record<string, Cell>>;
}

const EMPTY_CELL = (): Cell => ({ kind: 'uri', value: '', datatype: '', lang: '' });

function cellFromTerm(term: TermValue | null | undefined): Cell {
  if (!term || typeof term !== 'object') return { ...EMPTY_CELL(), kind: 'undef' };
  if (term.type === 'literal') {
    return {
      kind: 'literal',
      value: term.value ?? '',
      datatype: term.datatype ?? '',
      lang: term['xml:lang'] ?? '',
    };
  }
  return { kind: 'uri', value: term.value ?? '', datatype: '', lang: '' };
}

function termFromCell(cell: Cell): TermValue | null {
  if (cell.kind === 'undef') return null;
  if (cell.kind === 'uri') return { type: 'uri', value: cell.value };
  const term: TermValue = { type: 'literal', value: cell.value };
  // RDF 1.1: datatype and language are mutually exclusive, datatype wins.
  if (cell.datatype) term.datatype = cell.datatype;
  else if (cell.lang) term['xml:lang'] = cell.lang;
  return term;
}

/** The message a cell would produce if it were substituted, or null if it is fine. */
function cellError(cell: Cell, variable: string): string | null {
  const term = termFromCell(cell);
  if (term === null) return null;
  try {
    serializeTerm(term, `for variable '${variable}'`);
    return null;
  } catch (error) {
    if (error instanceof InvalidTermError) return error.message;
    throw error;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A default stylesheet. Hosts may inject it, extend it, or replace it entirely. */
export const ARGS_ELEMENT_STYLES = `
sqlib-args { display:block; }
.sqlib-args__modes { display:flex; gap:.25rem; margin-bottom:.5rem; }
.sqlib-args__mode { padding:.15rem .5rem; font-size:.75rem; border:1px solid var(--sqlib-line,#dfe3ea);
  background:var(--sqlib-panel,#f7f8fa); color:inherit; border-radius:3px; cursor:pointer; font-family:inherit; }
.sqlib-args__mode[aria-pressed="true"] { background:var(--sqlib-accent,#2159c9); color:#fff; border-color:transparent; }
.sqlib-args__slot { margin-bottom:.6rem; }
.sqlib-args__slot-label { font-size:.72rem; color:var(--sqlib-muted,#6b7280); margin-bottom:.25rem;
  font-family:var(--sqlib-mono,ui-monospace,monospace); }
.sqlib-args__table { width:100%; border-collapse:collapse; font-size:.78rem; }
.sqlib-args__table th { text-align:left; font-weight:600; padding:.2rem .35rem;
  color:var(--sqlib-muted,#6b7280); font-family:var(--sqlib-mono,ui-monospace,monospace); font-size:.72rem; }
.sqlib-args__table td { padding:.15rem .35rem; vertical-align:top; }
.sqlib-args__cell { display:flex; gap:.25rem; align-items:center; flex-wrap:wrap; }
.sqlib-args__cell select, .sqlib-args__cell input, .sqlib-args__limit input {
  font-family:var(--sqlib-mono,ui-monospace,monospace); font-size:.75rem; padding:.2rem .3rem;
  border:1px solid var(--sqlib-line,#dfe3ea); border-radius:3px; background:var(--sqlib-bg,#fff); color:inherit; }
.sqlib-args__cell input { flex:1 1 12rem; min-width:6rem; }
.sqlib-args__cell input.sqlib-args__invalid { border-color:#c53030; }
.sqlib-args__error { color:#c53030; font-size:.7rem; flex-basis:100%; }
.sqlib-args__row-actions { white-space:nowrap; }
.sqlib-args__button { padding:.15rem .45rem; font-size:.72rem; border:1px solid var(--sqlib-line,#dfe3ea);
  border-radius:3px; background:var(--sqlib-panel,#f7f8fa); color:inherit; cursor:pointer; font-family:inherit; }
.sqlib-args__limits { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:.35rem; }
.sqlib-args__limit { display:flex; align-items:center; gap:.3rem; font-size:.75rem;
  color:var(--sqlib-muted,#6b7280); font-family:var(--sqlib-mono,ui-monospace,monospace); }
.sqlib-args__limit input { width:6rem; }
.sqlib-args__json { width:100%; min-height:9rem; font-family:var(--sqlib-mono,ui-monospace,monospace);
  font-size:.75rem; padding:.5rem; border:1px solid var(--sqlib-line,#dfe3ea); border-radius:4px;
  background:var(--sqlib-panel,#f7f8fa); color:inherit; resize:vertical; }
.sqlib-args__note { font-size:.72rem; color:var(--sqlib-muted,#6b7280); margin:.25rem 0 0; }
.sqlib-args__note--warn { color:#b7791f; }
.sqlib-args__empty { font-size:.75rem; color:var(--sqlib-muted,#6b7280); }
`;

/**
 * `HTMLElement` where there is a DOM, and an inert stand-in where there is not.
 *
 * An `extends HTMLElement` clause is evaluated when the module is *loaded*, not
 * when the element is used, so naming the global directly made importing this
 * file throw `ReferenceError: HTMLElement is not defined` anywhere without a
 * DOM — a server render, a worker, a Node script reading the styles. That is
 * not the promise the rest of the file makes: {@link defineArgsElement} tests
 * for `customElements` precisely so a host with no DOM can call it and get
 * nothing, and `browser.ts` says importing it has no side effects. The guard
 * could never run, because the import had already failed.
 *
 * Invisible from inside this repository by construction: the Vue app is
 * `ssr: false`, the exported page is a browser, and the tests run in
 * happy-dom — three hosts that all have a DOM. It is checked from outside now,
 * by `scripts/check-installable.mjs`, which loads every entry point of the
 * packed tarball in a plain Node process.
 *
 * The stand-in is never instantiated: `customElements.define` is the only
 * thing that constructs one, and it is unreachable where this branch is taken.
 *
 * Exported because the declaration of {@link SqlibArgsElement} names it — a
 * base class a consumer cannot write down is what `scripts/check-public-api.mjs`
 * calls an unnameable type, and the alternative spellings all produce one
 * (tsc synthesises `SqlibArgsElement_base` for an expression in the extends
 * clause). It is `typeof HTMLElement` and nothing more.
 */
export const ArgsElementBase: typeof HTMLElement =
  typeof HTMLElement === 'undefined' ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * The element.
 *
 * Set `signature` first, then `payload`; both are plain properties rather than
 * attributes because they are structured data. Listen for `change`, whose
 * `detail` carries the current payload and whether every cell validates.
 */
export class SqlibArgsElement extends ArgsElementBase {
  private signatureValue: ArgsSignature = { inputs: [] };
  private slots: SlotState[] = [];
  private limitValues: Record<string, number> = {};
  private offsetValues: Record<string, number> = {};
  private mode: 'form' | 'json' = 'form';
  /** Set when a payload arrived that the form cannot represent faithfully. */
  private jsonOnlyReason: string | null = null;
  private rawJson = '';
  private connected = false;

  static get observedAttributes(): string[] {
    return [];
  }

  connectedCallback(): void {
    this.connected = true;
    this.render();
  }

  get signature(): ArgsSignature {
    return this.signatureValue;
  }

  set signature(value: ArgsSignature) {
    this.signatureValue = {
      inputs: value?.inputs ?? [],
      limits: value?.limits ?? [],
      offsets: value?.offsets ?? [],
    };
    this.slots = this.signatureValue.inputs.map((vars) => ({ vars: [...vars], rows: [] }));
    if (this.connected) this.render();
  }

  /**
   * True while the textarea is the editor in play — either because the viewer
   * switched to it, or because the payload could not be shown as a form. The
   * form's state is stale in both cases, so `payload` and `valid` must read the
   * text rather than the slots.
   */
  private get jsonIsAuthoritative(): boolean {
    return this.mode === 'json' || this.jsonOnlyReason !== null;
  }

  get payload(): ArgsPayload {
    if (this.jsonIsAuthoritative) {
      try {
        return JSON.parse(this.rawJson) as ArgsPayload;
      } catch {
        return { arguments: [] };
      }
    }
    return this.buildPayload();
  }

  set payload(value: ArgsPayload) {
    this.load(value ?? { arguments: [] });
    if (this.connected) this.render();
  }

  /** True when every bound cell would serialise. */
  get valid(): boolean {
    if (this.jsonIsAuthoritative) {
      try {
        JSON.parse(this.rawJson);
        return true;
      } catch {
        return false;
      }
    }
    return this.slots.every((slot) =>
      slot.rows.every((row) => slot.vars.every((v) => cellError(row[v], v) === null)),
    );
  }

  /**
   * Adopt a payload, falling back to the JSON editor when the form cannot hold it.
   *
   * A payload whose argument-set count disagrees with the signature, or that
   * binds variables the slot does not declare, is legal input the form has no
   * shape for. Showing it as raw JSON is honest; quietly dropping the parts that
   * do not fit would not be.
   */
  private load(value: ArgsPayload): void {
    this.rawJson = JSON.stringify(value ?? {}, null, 2);
    this.jsonOnlyReason = null;

    const given = Array.isArray(value?.arguments) ? value.arguments : [];
    /*
     * By variable, not by position. A saved argument set keeps the order its
     * rows were written in, which need not be the order the query declares its
     * slots — and reading it positionally filled each slot from the wrong set,
     * then reported the result as "binds variables the query does not declare"
     * and fell back to JSON for a payload the form can show perfectly well.
     */
    const sets =
      alignArgumentSets(this.signatureValue.inputs, given) ?? given;
    if (sets.length !== this.signatureValue.inputs.length) {
      if (sets.length > 0) {
        this.jsonOnlyReason = `This payload has ${sets.length} argument set(s) but the query has ${this.signatureValue.inputs.length} parameter slot(s).`;
        this.mode = 'json';
        return;
      }
    }

    this.slots = this.signatureValue.inputs.map((vars, index) => {
      const bindings = sets[index]?.arguments?.bindings ?? [];
      const rows = (Array.isArray(bindings) ? bindings : []).map((binding) => {
        const row: Record<string, Cell> = {};
        const source = (binding ?? {}) as Record<string, TermValue | null | undefined>;
        for (const variable of vars) row[variable] = cellFromTerm(source[variable]);
        return row;
      });
      return { vars: [...vars], rows };
    });

    // A payload binding something outside the declared variables is the other
    // case the form cannot show without losing information.
    const extra = sets.some((set, index) => {
      const declared = new Set(this.signatureValue.inputs[index] ?? []);
      return (set?.arguments?.bindings ?? []).some((binding) =>
        Object.keys((binding ?? {}) as object).some((key) => !declared.has(key)),
      );
    });
    if (extra) {
      this.jsonOnlyReason = 'This payload binds variables the query does not declare.';
      this.mode = 'json';
      return;
    }

    this.limitValues = { ...(value?.limits ?? {}) };
    this.offsetValues = { ...(value?.offsets ?? {}) };
  }

  private buildPayload(): ArgsPayload {
    const payload: ArgsPayload = {
      arguments: this.slots.map((slot) => ({
        head: { vars: [...slot.vars] },
        arguments: {
          bindings: slot.rows.map((row) => {
            const binding: Record<string, TermValue> = {};
            for (const variable of slot.vars) {
              const term = termFromCell(row[variable]);
              // An UNDEF cell is an absent key, which is what UNDEF means.
              if (term) binding[variable] = term;
            }
            return binding;
          }),
        },
      })),
    };
    if (Object.keys(this.limitValues).length > 0) payload.limits = { ...this.limitValues };
    if (Object.keys(this.offsetValues).length > 0) payload.offsets = { ...this.offsetValues };
    return payload;
  }

  private emit(): void {
    const payload = this.payload;
    // Never rewrite the textarea's own text under the viewer's cursor.
    if (!this.jsonIsAuthoritative) this.rawJson = JSON.stringify(payload, null, 2);
    this.dispatchEvent(
      new CustomEvent('change', {
        detail: { payload, valid: this.valid },
        bubbles: true,
      }),
    );
  }

  private render(): void {
    this.textContent = '';
    this.append(this.renderModes());

    if (this.mode === 'json' || this.jsonOnlyReason) {
      this.append(this.renderJson());
      return;
    }

    if (this.signatureValue.inputs.length === 0) {
      this.append(el('p', 'sqlib-args__empty', 'This query takes no arguments.'));
    }
    this.slots.forEach((slot, index) => this.append(this.renderSlot(slot, index)));

    const pages = this.renderPageParameters();
    if (pages) this.append(pages);
  }

  private renderModes(): HTMLElement {
    const wrap = el('div', 'sqlib-args__modes');
    (['form', 'json'] as const).forEach((mode) => {
      const button = el('button', 'sqlib-args__mode', mode === 'form' ? 'Form' : 'JSON');
      button.type = 'button';
      const active = this.jsonOnlyReason ? mode === 'json' : this.mode === mode;
      button.setAttribute('aria-pressed', String(active));
      if (this.jsonOnlyReason && mode === 'form') button.disabled = true;
      button.addEventListener('click', () => {
        this.mode = mode;
        this.render();
      });
      wrap.append(button);
    });
    return wrap;
  }

  private renderJson(): HTMLElement {
    const wrap = el('div');
    if (this.jsonOnlyReason) {
      wrap.append(
        el(
          'p',
          'sqlib-args__note sqlib-args__note--warn',
          `${this.jsonOnlyReason} Edit it as JSON.`,
        ),
      );
    }
    const area = el('textarea', 'sqlib-args__json');
    area.value = this.rawJson;
    area.spellcheck = false;
    area.setAttribute('aria-label', 'Arguments as JSON');
    area.addEventListener('input', () => {
      this.rawJson = area.value;
      // The JSON view is authoritative while it is open: parse on the way out,
      // so a half-typed payload does not blow away the form's state.
      try {
        const parsed = JSON.parse(area.value) as ArgsPayload;
        const wasJsonOnly = this.jsonOnlyReason;
        this.load(parsed);
        this.rawJson = area.value;
        if (wasJsonOnly && !this.jsonOnlyReason) this.mode = 'json';
      } catch {
        /* Not parseable yet; `valid` reports false and the host shows why. */
      }
      this.emit();
    });
    wrap.append(area);
    return wrap;
  }

  private renderSlot(slot: SlotState, index: number): HTMLElement {
    const wrap = el('div', 'sqlib-args__slot');
    wrap.append(
      el(
        'div',
        'sqlib-args__slot-label',
        `slot ${index + 1}: ${slot.vars.map((v) => `?${v}`).join(', ')}`,
      ),
    );

    const table = el('table', 'sqlib-args__table');
    const head = el('tr');
    head.append(el('th', undefined, '#'));
    for (const variable of slot.vars) head.append(el('th', undefined, `?${variable}`));
    head.append(el('th'));
    table.append(head);

    slot.rows.forEach((row, rowIndex) => {
      const tr = el('tr');
      // The kind column is per row rather than per cell in the common
      // single-variable case; with several variables each cell keeps its own,
      // so the first column just labels the row.
      tr.append(el('td', undefined, `${rowIndex + 1}`));
      for (const variable of slot.vars) {
        tr.append(this.renderCell(row, variable));
      }
      const actions = el('td', 'sqlib-args__row-actions');
      const remove = el('button', 'sqlib-args__button', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        slot.rows.splice(rowIndex, 1);
        this.render();
        this.emit();
      });
      actions.append(remove);
      tr.append(actions);
      table.append(tr);
    });

    wrap.append(table);

    const add = el('button', 'sqlib-args__button', 'Add binding');
    add.type = 'button';
    add.addEventListener('click', () => {
      const row: Record<string, Cell> = {};
      for (const variable of slot.vars) row[variable] = EMPTY_CELL();
      slot.rows.push(row);
      this.render();
      this.emit();
    });
    wrap.append(add);

    if (slot.rows.length === 0) {
      wrap.append(
        el(
          'p',
          'sqlib-args__note',
          'No bindings: this slot becomes an empty VALUES block, which matches nothing. ' +
            'For "any value", add a binding and leave every cell UNDEF.',
        ),
      );
    }
    return wrap;
  }

  private renderCell(row: Record<string, Cell>, variable: string): HTMLElement {
    const cell = row[variable];
    const td = el('td');
    const box = el('div', 'sqlib-args__cell');

    const kind = el('select');
    for (const [value, label] of [
      ['uri', 'IRI'],
      ['literal', 'literal'],
      ['undef', 'UNDEF'],
    ] as const) {
      const option = el('option', undefined, label);
      option.value = value;
      if (cell.kind === value) option.selected = true;
      kind.append(option);
    }
    kind.setAttribute('aria-label', `Kind for ?${variable}`);
    kind.addEventListener('change', () => {
      cell.kind = kind.value as CellKind;
      // Structural: a literal grows datatype/language inputs an IRI has not.
      this.render();
      this.emit();
    });
    box.append(kind);

    if (cell.kind !== 'undef') {
      const input = el('input');
      input.value = cell.value;
      input.placeholder = cell.kind === 'uri' ? 'http://example.org/thing' : 'value';
      input.setAttribute('aria-label', `Value for ?${variable}`);
      const error = el('span', 'sqlib-args__error');

      const revalidate = () => {
        const message = cellError(cell, variable);
        error.textContent = message ?? '';
        input.classList.toggle('sqlib-args__invalid', message !== null);
      };
      input.addEventListener('input', () => {
        cell.value = input.value;
        // Patch only this cell: re-rendering here would take the caret with it.
        revalidate();
        this.emit();
      });
      box.append(input);

      if (cell.kind === 'literal') {
        const datatype = el('input');
        datatype.value = cell.datatype;
        datatype.placeholder = 'datatype IRI';
        datatype.setAttribute('aria-label', `Datatype for ?${variable}`);
        const lang = el('input');
        lang.value = cell.lang;
        lang.placeholder = 'lang';
        lang.setAttribute('aria-label', `Language tag for ?${variable}`);

        datatype.addEventListener('input', () => {
          cell.datatype = datatype.value;
          // Mutually exclusive; showing that by clearing the other is clearer
          // than an error explaining the rule.
          if (cell.datatype) {
            cell.lang = '';
            lang.value = '';
          }
          revalidate();
          this.emit();
        });
        lang.addEventListener('input', () => {
          cell.lang = lang.value;
          if (cell.lang) {
            cell.datatype = '';
            datatype.value = '';
          }
          revalidate();
          this.emit();
        });
        box.append(datatype, lang);
      }

      box.append(error);
      revalidate();
    }

    td.append(box);
    return td;
  }

  private renderPageParameters(): HTMLElement | null {
    const limits = this.signatureValue.limits ?? [];
    const offsets = this.signatureValue.offsets ?? [];
    if (limits.length === 0 && offsets.length === 0) return null;

    const wrap = el('div', 'sqlib-args__limits');
    const add = (name: string, kind: 'limit' | 'offset') => {
      const store = kind === 'limit' ? this.limitValues : this.offsetValues;
      const label = el('label', 'sqlib-args__limit');
      label.append(document.createTextNode(`${kind} ${name}`));
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = store[name] === undefined ? '' : String(store[name]);
      input.setAttribute('aria-label', `${kind} ${name}`);
      input.addEventListener('input', () => {
        if (input.value === '') delete store[name];
        else store[name] = Number(input.value);
        this.emit();
      });
      label.append(input);
      wrap.append(label);
    };
    limits.forEach((name) => add(name, 'limit'));
    offsets.forEach((name) => add(name, 'offset'));
    return wrap;
  }
}

/** Register the element. Safe to call more than once. */
export function defineArgsElement(tag = 'sqlib-args'): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(tag)) customElements.define(tag, SqlibArgsElement);
}
