/**
 * The audit's own tests.
 *
 * `designSystem.test.ts` runs `unreachableScopedRules` over `src` and asserts
 * the tree holds none. That is the guard; it says nothing about whether the
 * audit is right, and a guard that is green because it stopped looking is worse
 * than no guard — which is precisely how the repo-wide ancestor check behaved
 * for as long as it stood. So the rules live here, over a fixture tree small
 * enough to read, one case per way a class arrives.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { unreachableScopedRules } from './harness/scopedCss';

/** A throwaway `src` holding the given files, keyed by path relative to it. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(resolve(tmpdir(), 'scoped-css-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = resolve(root, path);
    mkdirSync(resolve(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const selectors = (root: string) => unreachableScopedRules(root).map((r) => `${r.file}: ${r.selector}`);

describe('unreachableScopedRules', () => {
  it('calls a rule dead when the file writes neither compound', () => {
    const root = tree({
      'Panel.vue': `
        <template><div class="panel"><span class="title" /></div></template>
        <style scoped>
        .panel .title { color: red; }
        .gone .title { color: blue; }
        </style>
      `,
    });
    expect(selectors(root)).toEqual(['Panel.vue: .gone .title']);
  });

  /*
   * The case the repo-wide check missed, and the reason this file exists.
   * `QueryGroupWorkArea` styled `.variable-field label` while the markup lived
   * in `TupleValuesEditor`, which it does not render — a class that exists, in
   * somebody else's component, is exactly what an extraction leaves behind.
   */
  it('calls an ancestor dead when it lives in a component this file does not render', () => {
    const root = tree({
      'Left.vue': `
        <template><div class="left"><label>x</label></div></template>
        <style scoped>.left label { color: red; }</style>
      `,
      'Right.vue': `
        <template><div class="right" /></template>
        <style scoped>.left label { color: blue; }</style>
      `,
    });
    expect(selectors(root)).toEqual(['Right.vue: .left label']);
  });

  it('spares an ancestor the document carries, read from the classList call', () => {
    const root = tree({
      'useTheme.ts': `export const apply = (on: boolean) => document.documentElement.classList.toggle('dark', on);`,
      'Panel.vue': `
        <template><div class="panel" /></template>
        <style scoped>
        .dark .panel { color: white; }
        .light .panel { color: black; }
        </style>
      `,
    });
    expect(selectors(root)).toEqual(['Panel.vue: .light .panel']);
  });

  it('spares an ancestor a parent puts on this component when it renders it', () => {
    const root = tree({
      'Parent.vue': `
        <template><div class="parent"><Child class="inset" /></div></template>
        <script setup lang="ts">import Child from './Child.vue';</script>
      `,
      'Child.vue': `
        <template><div class="child"><span class="row" /></div></template>
        <style scoped>
        .inset .row { color: red; }
        .outset .row { color: blue; }
        </style>
      `,
    });
    expect(selectors(root)).toEqual(['Child.vue: .outset .row']);
  });

  /*
   * `.feed-status.idle` — the compound names one element, and `idle` arrives
   * from `:class="eventStatus"`, whose values live in another module. Judging
   * each class alone would delete a live rule.
   */
  it('judges the compound, not each class: one reachable class spares the rest', () => {
    const root = tree({
      'Feed.vue': `
        <template><span class="feed-status" :class="status"><i class="dot" /></span></template>
        <style scoped>
        .feed-status.idle .dot { color: grey; }
        .absent.idle .dot { color: red; }
        </style>
      `,
    });
    expect(selectors(root)).toEqual(['Feed.vue: .absent.idle .dot']);
  });

  it('does not split a compound inside :not(), :is() or :has()', () => {
    const root = tree({
      'Panel.vue': `
        <template><div class="panel"><span class="row" /></div></template>
        <style scoped>.panel:not(.a .b) > .row { color: red; }</style>
      `,
    });
    expect(selectors(root)).toEqual([]);
  });

  it('leaves anything reaching past the scope alone', () => {
    const root = tree({
      'Panel.vue': `
        <template><div class="panel" /></template>
        <style scoped>:deep(.gone .title) { color: red; }</style>
      `,
    });
    expect(selectors(root)).toEqual([]);
  });

  it('spares a child component root used as an ancestor', () => {
    const root = tree({
      'Parent.vue': `
        <template><div class="parent"><Child><span class="slotted" /></Child></div></template>
        <script setup lang="ts">import Child from './Child.vue';</script>
        <style scoped>.child-root .slotted { color: red; }</style>
      `,
      'Child.vue': `<template><div class="child-root"><slot /></div></template>`,
    });
    expect(selectors(root)).toEqual([]);
  });
});
