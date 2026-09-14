/**
 * The `tests` flag's reach outside the Tests section.
 *
 * `testSubject` answers the question four record pages ask — "is there a
 * subject for a Tests tab here?" — and it answers it with two absences at once:
 * an unsaved entity, which cannot be pointed at, and a switched-off feature,
 * which has nothing to point. Before this composable the second half was not
 * asked anywhere, so a build with `FEATURE_TESTS=0` still drew the tab.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ref } from 'vue';
import { useTestsSurface } from '@/composables/useTestsSurface';

function setFlags(flags: Record<string, boolean> | null): void {
  globalThis.__NUXT_TEST_CONFIG__ = flags === null
    ? undefined
    : { public: { apiBaseUrl: 'http://api.test', featureFlags: flags } };
}

afterEach(() => setFlags(null));

describe('useTestsSurface', () => {
  it('reports the feature on when nothing switches it off', () => {
    const { testsEnabled } = useTestsSurface();
    expect(testsEnabled.value).toBe(true);
  });

  it('names the subject of a saved entity', () => {
    const { testSubject } = useTestsSurface();
    expect(testSubject(() => 'urn:sqlib:query:q1').value).toBe('urn:sqlib:query:q1');
  });

  it('names nothing while the entity is unsaved', () => {
    const { testSubject } = useTestsSurface();
    expect(testSubject(() => null).value).toBeNull();
    // A scratch id is the empty string on more than one screen, and an empty
    // subject is not a subject.
    expect(testSubject(() => '').value).toBeNull();
    expect(testSubject(() => undefined).value).toBeNull();
  });

  it('names nothing while the feature is off, saved or not', () => {
    setFlags({ tests: false });
    const { testsEnabled, testSubject } = useTestsSurface();
    expect(testsEnabled.value).toBe(false);
    expect(testSubject(() => 'urn:sqlib:query:q1').value).toBeNull();
  });

  it('follows a subject that changes under a mounted tab', () => {
    const subject = ref<string | null>(null);
    const { testSubject } = useTestsSurface();
    const resolved = testSubject(subject);
    expect(resolved.value).toBeNull();
    subject.value = 'urn:sqlib:etl-job:e1';
    expect(resolved.value).toBe('urn:sqlib:etl-job:e1');
  });
});
