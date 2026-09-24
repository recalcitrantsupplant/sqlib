/**
 * Every door into an input section, and whether it consults the flag.
 *
 * `tupleSets`, `dataGraphs` and `argumentSets` are the three flags whose
 * entities are named from screens that are not their own section: a rule set
 * runs against a data graph, a query's clause is filled from a tuple set, a
 * callable is called with an argument set. So each flag has two halves and they
 * pull opposite ways —
 *
 * - the **input** must stay readable, because a callable that names one still
 *   has to run, and
 * - the **door** must go, because it leads to a section this build does not
 *   draw.
 *
 * The sibling guard `testsFeatureDoors.test.ts` only has the second half;
 * `tests` is a feature, and nothing outside it depends on a test resolving.
 * Here the first half is the one that was wrong, and wrong quietly: see
 * `useApiClient.test.ts` for the reads, and this file for the doors.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { INPUT_SECTION_FEATURE, type InputSectionKind } from '@/composables/useInputSections';

const SRC = resolve(import.meta.dirname, '../src');

/** The composable that answers "is there a section to send someone to?". */
const SURFACE = 'composables/useInputSections.ts';

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(vue|ts)$/.test(entry.name) ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({
  name: relative(SRC, path).split(/[\\/]/).join('/'),
  text: readFileSync(path, 'utf8'),
}));

/** The tag an attribute sits in, opening angle to `>`. */
function enclosingTag(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return '';
  const open = text.lastIndexOf('<', at);
  const close = text.indexOf('>', at);
  return text.slice(open, close < 0 ? undefined : close + 1);
}

/**
 * The inventory, with the condition each door is behind.
 *
 * Listed rather than pattern-matched, for the reason the tests guard gives: a
 * sixth door fails here until someone says which condition holds it, and
 * saying so is where the thinking is. The ETL sink was already right before any
 * of this — it is here because an inventory that lists only the defects stops
 * being an inventory the first time one is fixed.
 */
type Door = {
  /** The file drawing the control, found by its test id. */
  drawnIn: string;
  testid: string;
  kind: InputSectionKind;
  /** The file and tag carrying the condition, when it is not the control itself. */
  heldIn?: { file: string; tag: string };
  condition: RegExp;
};

const DOORS: Door[] = [
  {
    drawnIn: 'components/rules/RuleSetInputsPanel.vue',
    testid: 'save-to-tuples',
    kind: 'tupleSet',
    // `canWrite` as well: authoring a tuple set is a write, and a read-only
    // deployment refuses it. `open-in-tuples` below navigates, so it stays.
    condition: /v-if="tupleSetSectionOpen && canWrite"/,
  },
  {
    drawnIn: 'components/rules/RuleSetInputsPanel.vue',
    testid: 'open-in-tuples',
    kind: 'tupleSet',
    condition: /v-if="tupleSetSectionOpen"/,
  },
  {
    drawnIn: 'components/rules/RuleSetInputsPanel.vue',
    testid: 'save-to-data',
    kind: 'dataGraph',
    condition: /v-if="dataGraphSectionOpen && canWrite"/,
  },
  {
    drawnIn: 'components/rules/RuleSetInputsPanel.vue',
    testid: 'open-in-data',
    kind: 'dataGraph',
    condition: /v-if="dataGraphSectionOpen"/,
  },
  {
    drawnIn: 'components/etl/TupleSetSink.vue',
    testid: 'etl-tuple-sink-open',
    kind: 'tupleSet',
    // Held one level up, because `TupleSetSink` is the whole door rather than a
    // control inside a panel: the pipeline screen decides whether to mount it.
    heldIn: { file: 'components/EtlPlayground.vue', tag: '<TupleSetSink' },
    condition: /v-if="tupleSetsEnabled"/,
  },
];

describe('doors into an input section', () => {
  it('hides every listed door rather than disabling it', () => {
    for (const door of DOORS) {
      const drawn = files.find((entry) => entry.name === door.drawnIn);
      expect(drawn, `${door.drawnIn} is missing`).toBeDefined();
      expect(drawn!.text, `${door.drawnIn} no longer draws ${door.testid}`)
        .toContain(`data-testid="${door.testid}"`);

      const holder = door.heldIn
        ? files.find((entry) => entry.name === door.heldIn!.file)
        : drawn;
      expect(holder, `${door.heldIn?.file ?? door.drawnIn} is missing`).toBeDefined();
      const needle = door.heldIn?.tag ?? `data-testid="${door.testid}"`;
      expect(enclosingTag(holder!.text, needle), `${door.testid} (${door.kind})`)
        .toMatch(door.condition);
    }
  });

  it('takes the rules screen\'s two conditions from the composable', () => {
    /*
     * The **call**, not the name — the mistake `testsFeatureDoors.test.ts`
     * records making. The panel drawing the doors takes them as props, so the
     * screen that fills those props is the one that has to ask.
     */
    const inspector = files.find((file) => file.name === 'components/rules/RuleSetInspectorPanel.vue');
    expect(inspector).toBeDefined();
    expect(inspector!.text).toMatch(
      /import \{[^}]*useInputSections[^}]*\} from ['"][^'"]*composables\/useInputSections['"]/,
    );
    expect(inspector!.text).toMatch(/sectionOpen\('tupleSet'\)/);
    expect(inspector!.text).toMatch(/sectionOpen\('dataGraph'\)/);
  });

  it('states a section flag for every input kind', () => {
    const kinds: InputSectionKind[] = ['tupleSet', 'dataGraph', 'argumentSet'];
    expect(Object.keys(INPUT_SECTION_FEATURE).sort()).toEqual([...kinds].sort());
  });

  it('draws no door into the argument sets section from another screen', () => {
    /*
     * Recorded as an inventory entry of its own, because "none" is a finding
     * rather than an omission. An argument set is authored on the callable it
     * belongs to — the query screen's Inputs tab is the same entity seen from
     * its caller, which is the reason the flag's own default comment gives for
     * existing — and a *standalone* one is created only inside the section. So
     * there is nothing to hide, and this fails if someone adds one.
     */
    const openers = files
      .filter((file) => !file.name.startsWith('components/ArgumentSet'))
      .filter((file) => /type: 'argumentSet'/.test(file.text))
      .filter((file) => file.name !== 'lib/sections.ts' && file.name !== 'pages/index.vue')
      .map((file) => file.name);
    expect(openers).toEqual([]);
  });

  it('gates no read of an input entity on its section flag', () => {
    /*
     * The half that was wrong. A door is a control; a read is what a callable
     * on another screen needs to resolve what it names, and the server serves
     * these three unflagged for exactly that reason. `ensureTupleSetsEnabled`
     * survives for the writes, so this checks the four reads by name rather
     * than checking that the helper is gone.
     */
    const client = files.find((file) => file.name === 'composables/useApiClient.ts');
    expect(client).toBeDefined();
    const reads = ['listTupleSets', 'getTupleSet', 'listTupleSetVersions', 'getTupleSetVersion'];
    for (const read of reads) {
      const at = client!.text.indexOf(`const ${read} = (`);
      expect(at, `${read} is missing`).toBeGreaterThan(-1);
      // The body up to the URL it builds: a gate would have to sit in there.
      const body = client!.text.slice(at, client!.text.indexOf('buildUrl(', at));
      expect(body, `${read} refuses on a flag`).not.toContain('ensureTupleSetsEnabled');
    }
  });

  it('leaves the composable itself free to read the flags', () => {
    const surface = files.find((file) => file.name === SURFACE);
    expect(surface).toBeDefined();
    expect(surface!.text).toContain('useFeatureFlags');
  });
});
