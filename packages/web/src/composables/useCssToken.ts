import { ref, onMounted, type Ref } from 'vue';

/**
 * Read a design token's computed value as a plain string.
 *
 * Needed only where a token has to reach somewhere `var()` cannot go. SVG
 * presentation attributes are the case in practice: VueFlow's <Background>
 * passes `pattern-color` straight through to the SVG `stroke` attribute, and
 * attributes — unlike CSS properties — do not resolve var().
 *
 * Prefer `var(--token)` everywhere it works, which includes inline :style
 * bindings, CodeMirror theme objects, and VueFlow node/edge style objects.
 *
 * The value resolves on mount; `fallback` is what renders for the first frame.
 */
export function useCssToken(name: string, fallback: string): Ref<string> {
  const value = ref(fallback);

  onMounted(() => {
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    if (resolved) value.value = resolved;
  });

  return value;
}
