import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import CodePeek from '@/components/shared/CodePeek.vue';

// A textarea stands in for the editor: this spec is about which text reaches
// it and when, not about how CodeMirror paints it.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    template: '<textarea :value="modelValue"></textarea>',
  },
}));

// Longer than a peek is tall, so the reductions have something to reduce: at
// six collapsed lines a shorter document is shown whole (see the specs below).
const SPARQL = [
  'PREFIX : <http://example/>',
  'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
  '',
  'SELECT * WHERE {',
  '  ?s :edge ?o .',
  '',
  '  ?o rdfs:label ?l .',
  '  FILTER (?l != "x")',
  '}',
].join('\n');

const shown = (peek: ReturnType<typeof mount>) =>
  (peek.get('textarea').element as HTMLTextAreaElement).value;

const mountPeek = (props: Record<string, unknown>) =>
  mount(CodePeek, { props: { label: 'Query text', ...props } });

describe('CodePeek', () => {
  it('opens on the first line that says something, not on the prologue', () => {
    const peek = mountPeek({ content: SPARQL, contentType: 'application/sparql-query' });
    // Two PREFIX lines and the blanks are gone: given a handful of lines to say
    // what a document is, spending them on a prologue that is the same in every
    // document says nothing — and a blank line says less again.
    expect(shown(peek)).toBe(
      'SELECT * WHERE {\n  ?s :edge ?o .\n  ?o rdfs:label ?l .\n  FILTER (?l != "x")\n}',
    );
    expect(peek.text()).toContain('2 prefixes hidden');
  });

  it('recognises Turtle directives as prologue too', () => {
    const body = [':a :b :c .', ':d :e :f .', ':g :h :i .', ':j :k :l .', ':m :n :o .'];
    const peek = mountPeek({
      content: ['@prefix : <http://e/> .', '@base <http://e/> .', '', ...body].join('\n'),
    });
    expect(shown(peek)).toBe(body.join('\n'));
    expect(peek.text()).toContain('2 prefixes hidden');
  });

  it('shows a document that fits whole, prologue and all', () => {
    // Hiding the prologue is paid for by scarcity, and two lines have none:
    // hiding one of them saves nothing and leaves the header hedging about a
    // document it could simply have shown.
    const whole = 'PREFIX : <http://example/>\n:x :xv 1 .';
    const peek = mountPeek({ content: whole, testId: 'x' });
    expect(shown(peek)).toBe(whole);
    expect(peek.get('[data-testid="x-state"]').text()).toBe('');
    expect(peek.find('.peek-shade').exists()).toBe(false);
  });

  it('keeps the blank lines of a document it is showing whole', () => {
    const whole = ':a :b :c .\n\n:d :e :f .';
    expect(shown(mountPeek({ content: whole }))).toBe(whole);
  });

  it('gives the whole document back when it is expanded', async () => {
    const peek = mountPeek({ content: SPARQL });
    await peek.get('.peek-head').trigger('click');
    expect(shown(peek)).toBe(SPARQL);
    expect(peek.text()).toContain('9 lines');
  });

  it('expands from a click on the body, which is the whole target', async () => {
    const peek = mountPeek({ content: SPARQL });
    await peek.get('.peek-body').trigger('click');
    expect(shown(peek)).toBe(SPARQL);
  });

  it('shades the peek, because a hard cut reads as the end of the text', () => {
    const peek = mountPeek({ content: [SPARQL, '# and four', '# more', '# lines'].join('\n') });
    expect(peek.find('.peek-shade').exists()).toBe(true);
  });

  it('leaves the shade off when nothing is being cut', () => {
    // A fade over a document that ends there would be saying something false.
    const peek = mountPeek({ content: 'ASK { ?s ?p ?o }' });
    expect(peek.find('.peek-shade').exists()).toBe(false);
  });

  it('does not shade a body that fits, however much prologue came off the top', () => {
    // The prologue was cut off the *top*. A fade at the bottom cannot point at
    // it, and drawn over a body that ends there it says the one thing that is
    // false: that there is more below. The header says it in words instead.
    const peek = mountPeek({
      content: [
        'PREFIX a: <http://e/a#>',
        'PREFIX b: <http://e/b#>',
        'PREFIX c: <http://e/c#>',
        'PREFIX d: <http://e/d#>',
        'PREFIX e: <http://e/e#>',
        'PREFIX f: <http://e/f#>',
        '',
        ':x :xv 1 .',
      ].join('\n'),
      testId: 'x',
    });
    expect(shown(peek)).toBe(':x :xv 1 .');
    expect(peek.find('.peek-shade').exists()).toBe(false);
    expect(peek.get('[data-testid="x-state"]').text()).toBe('6 prefixes hidden · click to expand');
  });

  it('says how many lines are below, so the fade is not the only thing saying so', () => {
    // The fault this answers: a clip landing on a blank line fades nothing and
    // reads as the end of the document. The count cannot land on a blank.
    const peek = mountPeek({
      content: Array.from({ length: 10 }, (_, index) => `:s${index} :p ${index} .`).join('\n\n'),
      testId: 'x',
    });
    expect(peek.get('[data-testid="x-state"]').text()).toBe('4 more lines · click to expand');
    expect(peek.find('.peek-shade').exists()).toBe(true);
  });

  it('drops the blank lines between rules, so the clip lands on ink', () => {
    const peek = mountPeek({
      content: ['RULE { :a :b :c }', '', 'RULE { :d :e :f }', '', 'RULE { :g :h :i }'].join('\n'),
      collapsedLines: 2,
    });
    expect(shown(peek)).toBe('RULE { :a :b :c }\nRULE { :d :e :f }\nRULE { :g :h :i }');
  });

  it('says nothing is hidden when the peek already shows everything', () => {
    const peek = mountPeek({ content: 'ASK { ?s ?p ?o }', testId: 'x' });
    expect(peek.get('[data-testid="x-state"]').text()).toBe('');
  });

  it('falls back to the prologue when that is all there is', () => {
    // Also true of a prologue longer than the box: there is no body to show
    // instead, and a blank peek reads as a preview that failed to load.
    // A document of nothing but PREFIX lines would otherwise peek as blank,
    // which reads as a failed fetch rather than as an unusual document.
    const peek = mountPeek({ content: 'PREFIX : <http://example/>', testId: 'x' });
    expect(shown(peek)).toBe('PREFIX : <http://example/>');
    // And it does not then claim to be hiding the line it is showing.
    expect(peek.get('[data-testid="x-state"]').text()).toBe('');
    expect(peek.find('.peek-shade').exists()).toBe(false);
  });

  it('renders nothing for empty content, and the reason when one is given', () => {
    expect(mountPeek({ content: '   ' }).text()).toBe('');
    expect(mountPeek({ content: '', empty: 'None chosen' }).text()).toBe('None chosen');
  });

  it('opens expanded when the caller says this document is the point', () => {
    const peek = mountPeek({ content: SPARQL, defaultExpanded: true });
    expect(shown(peek)).toBe(SPARQL);
  });
});
