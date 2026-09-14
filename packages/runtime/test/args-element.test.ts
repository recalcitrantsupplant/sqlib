// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { defineArgsElement, type SqlibArgsElement } from '../src/args-element.js';

defineArgsElement();

function mount(
  signature: { inputs: string[][]; limits?: string[]; offsets?: string[] },
  payload?: unknown,
): SqlibArgsElement {
  const element = document.createElement('sqlib-args') as SqlibArgsElement;
  document.body.append(element);
  element.signature = signature;
  if (payload !== undefined) element.payload = payload as never;
  return element;
}

const iri = (value: string) => ({ type: 'uri', value });
const literal = (value: string) => ({ type: 'literal', value });

const ONE_SLOT = { inputs: [['city']] };
const PERTH = {
  arguments: [
    { head: { vars: ['city'] }, arguments: { bindings: [{ city: iri('http://example.org/Perth') }] } },
  ],
};

beforeEach(() => {
  document.body.textContent = '';
});

describe('building a form from the signature', () => {
  it('renders a column per variable and a row per binding', () => {
    const element = mount({ inputs: [['from', 'to']] }, {
      arguments: [
        {
          head: { vars: ['from', 'to'] },
          arguments: { bindings: [{ from: iri('urn:a'), to: iri('urn:b') }] },
        },
      ],
    });
    const headers = [...element.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['#', '?from', '?to', '']);
  });

  it('says so when the query takes no arguments at all', () => {
    const element = mount({ inputs: [] });
    expect(element.textContent).toContain('takes no arguments');
  });

  it('explains what a zero-row slot actually does, rather than showing a blank table', () => {
    // Zero rows is not "no constraint": it is an empty VALUES block, which joins
    // to nothing. The wildcard — one row, every cell UNDEF — is the other thing.
    const element = mount(ONE_SLOT, { arguments: [{ head: { vars: ['city'] }, arguments: { bindings: [] } }] });
    expect(element.textContent).toContain('matches nothing');
  });

  it('treats an all-UNDEF row as a wildcard the form can show', () => {
    const element = mount(ONE_SLOT, { arguments: [{ head: { vars: ['city'] }, arguments: { bindings: [{}] } }] });
    expect(element.valid).toBe(true);
    expect(element.payload.arguments[0].arguments.bindings).toEqual([{}]);
  });

  it('offers a numeric input per page parameter', () => {
    const element = mount({ inputs: [], limits: ['1'], offsets: ['2'] });
    expect(element.querySelector('input[aria-label="limit 1"]')).not.toBeNull();
    expect(element.querySelector('input[aria-label="offset 2"]')).not.toBeNull();
  });
});

describe('round-tripping a payload', () => {
  it('reads a payload in and gives the same one back', () => {
    const element = mount(ONE_SLOT, PERTH);
    expect(element.payload.arguments).toEqual(PERTH.arguments);
  });

  it('reads an UNDEF cell as an absent key, which is what UNDEF means', () => {
    const element = mount({ inputs: [['a', 'b']] }, {
      arguments: [
        { head: { vars: ['a', 'b'] }, arguments: { bindings: [{ a: iri('urn:a'), b: null }] } },
      ],
    });
    expect(element.payload.arguments[0].arguments.bindings[0]).toEqual({ a: iri('urn:a') });
  });

  it('carries a literal with its language tag', () => {
    const payload = {
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: { type: 'literal', value: 'Perth', 'xml:lang': 'en-AU' } }] },
        },
      ],
    };
    const element = mount(ONE_SLOT, payload);
    expect(element.payload.arguments[0].arguments.bindings[0].city).toEqual({
      type: 'literal',
      value: 'Perth',
      'xml:lang': 'en-AU',
    });
  });
});

describe('validation is the runtime own check, surfaced per cell', () => {
  it('accepts a well-formed IRI', () => {
    const element = mount(ONE_SLOT, PERTH);
    expect(element.valid).toBe(true);
    expect(element.querySelector('.sqlib-args__error')?.textContent).toBe('');
  });

  it('reports an IRI that would escape its production, in the runtime words', () => {
    const element = mount(ONE_SLOT, {
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: iri('http://e/a> <http://e/b') }] },
        },
      ],
    });
    expect(element.valid).toBe(false);
    expect(element.querySelector('.sqlib-args__error')?.textContent).toMatch(/IRIREF/);
  });

  it('reports a bad language tag', () => {
    const element = mount(ONE_SLOT, {
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: { type: 'literal', value: 'x', 'xml:lang': 'en"@x' } }] },
        },
      ],
    });
    expect(element.valid).toBe(false);
    expect(element.querySelector('.sqlib-args__error')?.textContent).toMatch(/language tag/);
  });

  it('revalidates as the value is typed, without rebuilding the field', () => {
    const element = mount(ONE_SLOT, PERTH);
    const input = element.querySelector<HTMLInputElement>('input[aria-label="Value for ?city"]')!;
    input.value = 'http://e/a> <http://e/b';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Same node: re-rendering here would take the caret with it.
    expect(element.querySelector('input[aria-label="Value for ?city"]')).toBe(input);
    expect(input.classList.contains('sqlib-args__invalid')).toBe(true);
    expect(element.valid).toBe(false);
  });
});

describe('editing', () => {
  it('adds and removes bindings', () => {
    const element = mount(ONE_SLOT, PERTH);
    const add = [...element.querySelectorAll('button')].find((b) => b.textContent === 'Add binding')!;
    add.click();
    expect(element.payload.arguments[0].arguments.bindings).toHaveLength(2);

    const remove = [...element.querySelectorAll('button')].filter((b) => b.textContent === 'Remove');
    remove[1].click();
    expect(element.payload.arguments[0].arguments.bindings).toHaveLength(1);
  });

  it('emits change when a value is edited', () => {
    const element = mount(ONE_SLOT, PERTH);
    let seen = 0;
    element.addEventListener('change', () => seen++);
    const input = element.querySelector<HTMLInputElement>('input[aria-label="Value for ?city"]')!;
    input.value = 'http://example.org/Darwin';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(seen).toBe(1);
    expect(element.payload.arguments[0].arguments.bindings[0].city).toEqual(iri('http://example.org/Darwin'));
  });

  it('clears the language tag when a datatype is given, since RDF forbids both', () => {
    const element = mount(ONE_SLOT, {
      arguments: [
        {
          head: { vars: ['city'] },
          arguments: { bindings: [{ city: { type: 'literal', value: '42', 'xml:lang': 'en' } }] },
        },
      ],
    });
    const datatype = element.querySelector<HTMLInputElement>('input[aria-label="Datatype for ?city"]')!;
    datatype.value = 'http://www.w3.org/2001/XMLSchema#integer';
    datatype.dispatchEvent(new Event('input', { bubbles: true }));

    expect(element.payload.arguments[0].arguments.bindings[0].city).toEqual({
      type: 'literal',
      value: '42',
      datatype: 'http://www.w3.org/2001/XMLSchema#integer',
    });
  });

  it('switching a cell to UNDEF drops it from the binding', () => {
    const element = mount(ONE_SLOT, PERTH);
    const kind = element.querySelector<HTMLSelectElement>('select[aria-label="Kind for ?city"]')!;
    kind.value = 'undef';
    kind.dispatchEvent(new Event('change', { bubbles: true }));
    expect(element.payload.arguments[0].arguments.bindings[0]).toEqual({});
  });
});

describe('payloads the form cannot hold', () => {
  it('falls back to JSON rather than dropping what it cannot show', () => {
    const element = mount(ONE_SLOT, {
      arguments: [
        { head: { vars: ['city'] }, arguments: { bindings: [{ city: iri('urn:a'), extra: iri('urn:b') }] } },
      ],
    });
    expect(element.textContent).toContain('binds variables the query does not declare');
    expect(element.querySelector('textarea')).not.toBeNull();
  });

  it('falls back when the argument-set count disagrees with the signature', () => {
    const element = mount(ONE_SLOT, {
      arguments: [
        { head: { vars: ['a'] }, arguments: { bindings: [] } },
        { head: { vars: ['b'] }, arguments: { bindings: [] } },
      ],
    });
    expect(element.textContent).toContain('2 argument set(s) but the query has 1');
  });

  it('keeps such a payload intact rather than mangling it', () => {
    const payload = {
      arguments: [
        { head: { vars: ['city'] }, arguments: { bindings: [{ city: iri('urn:a'), extra: iri('urn:b') }] } },
      ],
    };
    const element = mount(ONE_SLOT, payload);
    expect(element.payload).toEqual(payload);
  });
});

describe('the JSON view', () => {
  it('shows the current payload and accepts edits', () => {
    const element = mount(ONE_SLOT, PERTH);
    const toJson = [...element.querySelectorAll('button')].find((b) => b.textContent === 'JSON')!;
    toJson.click();

    const area = element.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(area.value).toContain('http://example.org/Perth');

    area.value = JSON.stringify({
      arguments: [
        { head: { vars: ['city'] }, arguments: { bindings: [{ city: iri('http://example.org/Darwin') }] } },
      ],
    });
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect(element.payload.arguments[0].arguments.bindings[0].city).toEqual(
      iri('http://example.org/Darwin'),
    );
  });

  it('reports invalid JSON as invalid rather than throwing', () => {
    const element = mount(ONE_SLOT, PERTH);
    [...element.querySelectorAll('button')].find((b) => b.textContent === 'JSON')!.click();
    const area = element.querySelector<HTMLTextAreaElement>('textarea')!;
    area.value = '{ not json';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    expect(element.valid).toBe(false);
  });
});

describe('a payload whose sets arrive in another order', () => {
  const TWO_SLOT = { inputs: [['term'], ['facetField']] };
  const OUT_OF_ORDER = {
    arguments: [
      { head: { vars: ['facetField'] }, arguments: { bindings: [{ facetField: literal('type') }] } },
      { head: { vars: ['term'] }, arguments: { bindings: [{ term: literal('wool') }] } },
    ],
  };

  /*
   * A stored argument set keeps the order its rows were written in, which need
   * not be the order the query declares its slots. Read positionally the form
   * filled ?term from the facetField set, found a variable the slot does not
   * declare, and dropped to the JSON editor for a payload it can show perfectly.
   */
  it('shows the form rather than falling back to JSON', () => {
    const element = mount(TWO_SLOT, OUT_OF_ORDER);
    expect(element.textContent).not.toContain('does not declare');
    expect(element.querySelector('textarea')).toBeNull();
  });

  it('puts each value under the slot that declares it', () => {
    const element = mount(TWO_SLOT, OUT_OF_ORDER);
    const values = [...element.querySelectorAll<HTMLInputElement>('.sqlib-args__cell input')]
      .map((input) => input.value)
      .filter(Boolean);
    expect(values).toContain('wool');
    expect(values).toContain('type');
  });

  it('reads back in slot order, whatever order it was given in', () => {
    const element = mount(TWO_SLOT, OUT_OF_ORDER);
    expect(element.payload.arguments.map((set) => set.head.vars)).toEqual([
      ['term'],
      ['facetField'],
    ]);
  });

  it('is valid, because it is', () => {
    expect(mount(TWO_SLOT, OUT_OF_ORDER).valid).toBe(true);
  });
});
