import { computed } from 'vue';
import { useSettings } from '@/composables/useSettings';

/**
 * Word wrap in result tables, for every table at once.
 *
 * Off, each row is one line and a value wider than its column ends in an
 * ellipsis. On, a long value wraps and its row grows. One switch for the whole
 * browser, as term display is (see `useTermDisplay`), kept in the settings
 * object so it survives a reload.
 */
export function useTableWrap() {
  const { settings, setTableWrapEnabled } = useSettings();

  const wrap = computed<boolean>({
    get: () => settings.value.tableWrapEnabled,
    set: (next: boolean) => setTableWrapEnabled(next),
  });

  const toggleWrap = (): void => {
    wrap.value = !wrap.value;
  };

  return { wrap, toggleWrap };
}
