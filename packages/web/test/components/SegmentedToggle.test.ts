import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SegmentedToggle from '@/components/shared/SegmentedToggle.vue';

/**
 * The primitive that replaced four hand-drawn copies.
 *
 * All four referenced tokens and had still drifted — 24px, 26px and
 * `--control-h-sm`, `--radius` against `--radius-sm` — which is the point these
 * tests exist to hold: token discipline stops *values* drifting and does
 * nothing about *specs* drifting.
 */
const OPTIONS = [
  { value: 'a', label: 'First', testId: 'opt-a' },
  { value: 'b', label: 'Second', testId: 'opt-b' },
];

function mountToggle(props: Record<string, unknown> = {}) {
  return mount(SegmentedToggle, {
    props: { modelValue: 'a', options: OPTIONS, groupLabel: 'Choose one', ...props },
  });
}

describe('SegmentedToggle', () => {
  it('marks exactly one segment as chosen', () => {
    const toggle = mountToggle();
    expect(toggle.get('[data-testid="opt-a"]').classes()).toContain('on');
    expect(toggle.get('[data-testid="opt-b"]').classes()).not.toContain('on');
    expect(toggle.findAll('.segment.on')).toHaveLength(1);
  });

  it('emits the value rather than mutating it', async () => {
    const toggle = mountToggle();
    await toggle.get('[data-testid="opt-b"]').trigger('click');
    expect(toggle.emitted('update:modelValue')).toEqual([['b']]);
    // Still showing 'a': the parent owns the value, which is what makes the
    // control usable for a derived one like the query's store mode.
    expect(toggle.get('[data-testid="opt-a"]').classes()).toContain('on');
  });

  it('disables one option without disabling the control', () => {
    const toggle = mountToggle({
      options: [OPTIONS[0], { ...OPTIONS[1], disabled: true }],
    });
    expect(toggle.get('[data-testid="opt-a"]').attributes('disabled')).toBeUndefined();
    expect(toggle.get('[data-testid="opt-b"]').attributes('disabled')).toBeDefined();
  });

  it('locks every option when the whole choice is settled', () => {
    const toggle = mountToggle({ disabled: true });
    expect(toggle.findAll('button[disabled]')).toHaveLength(2);
  });

  it('names the group for a screen reader, and states the choice on each option', () => {
    const toggle = mountToggle();
    expect(toggle.get('[role="group"]').attributes('aria-label')).toBe('Choose one');
    expect(toggle.get('[data-testid="opt-a"]').attributes('aria-pressed')).toBe('true');
    expect(toggle.get('[data-testid="opt-b"]').attributes('aria-pressed')).toBe('false');
  });
});
