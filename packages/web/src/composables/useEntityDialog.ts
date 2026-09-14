// FOR DEPRECATION: Legacy dialog helper slated to be replaced by wireframe-specific interaction patterns.
import { ref, reactive, type UnwrapRef } from 'vue';

export interface UseEntityDialogOptions<T> {
  /**
   * The initial form state - used as the default when creating new entities
   */
  initialFormState: T;

  /**
   * Submit handler called when the form is submitted
   * @param data The form data
   * @param mode Whether this is creating a new entity or editing an existing one
   */
  onSubmit: (data: T, mode: 'create' | 'edit') => Promise<void>;
}

export interface UseEntityDialogReturn<T> {
  /** Reference to the HTML dialog element */
  dialogRef: ReturnType<typeof ref<HTMLDialogElement | null>>;

  /** Current mode - 'create' or 'edit' */
  mode: ReturnType<typeof ref<'create' | 'edit'>>;

  /** Reactive form state */
  form: UnwrapRef<T>;

  /** Open the dialog in create or edit mode */
  open: (mode: 'create' | 'edit', data?: Partial<T>) => void;

  /** Close the dialog */
  close: () => void;

  /** Submit the form (calls onSubmit handler) */
  submit: () => Promise<void>;

  /** Reset form to initial state */
  reset: () => void;

  /** Loading state during submit */
  isSubmitting: ReturnType<typeof ref<boolean>>;

  /** Error message if submit fails */
  submitError: ReturnType<typeof ref<string | null>>;
}

/**
 * Generic composable for managing entity dialog state and operations.
 * Handles dialog ref management, form state, open/close/submit logic, and mode tracking.
 *
 * @example
 * ```ts
 * const libraryDialog = useEntityDialog<LibraryFormInput>({
 *   initialFormState: { name: '', description: null },
 *   onSubmit: async (data, mode) => {
 *     if (mode === 'create') await createLibrary(data);
 *     else await updateLibrary(selectedId, data);
 *     await loadData();
 *   }
 * });
 *
 * // To create a new entity
 * libraryDialog.open('create');
 *
 * // To edit an existing entity
 * libraryDialog.open('edit', { name: 'Existing Library', description: 'Edit me' });
 * ```
 */
export function useEntityDialog<T extends Record<string, any>>(
  options: UseEntityDialogOptions<T>
): UseEntityDialogReturn<T> {
  const { initialFormState, onSubmit } = options;

  // Dialog state
  const dialogRef = ref<HTMLDialogElement | null>(null);
  const mode = ref<'create' | 'edit'>('create');
  const isSubmitting = ref(false);
  const submitError = ref<string | null>(null);

  // Form state - create a reactive copy of the initial state
  const form = reactive({ ...initialFormState }) as UnwrapRef<T>;

  /**
   * Open the dialog in the specified mode
   * @param openMode 'create' or 'edit'
   * @param data Optional partial data to populate the form (typically used for edit mode)
   */
  function open(openMode: 'create' | 'edit', data?: Partial<T>) {
    mode.value = openMode;
    submitError.value = null;

    if (openMode === 'create') {
      // Reset to initial state for create mode
      reset();
    } else if (data) {
      // Populate form with provided data for edit mode
      Object.assign(form as Record<string, any>, data);
    }

    dialogRef.value?.showModal();
  }

  /**
   * Close the dialog
   */
  function close() {
    dialogRef.value?.close();
    submitError.value = null;
  }

  /**
   * Submit the form by calling the provided onSubmit handler
   */
  async function submit() {
    isSubmitting.value = true;
    submitError.value = null;

    try {
      await onSubmit(form as T, mode.value);
      close();
    } catch (err: any) {
      submitError.value = err?.message ?? 'Failed to save';
      throw err; // Re-throw so caller can handle if needed
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * Reset the form to its initial state
   */
  function reset() {
    Object.assign(form as Record<string, any>, initialFormState);
  }

  return {
    dialogRef,
    mode,
    form,
    open,
    close,
    submit,
    reset,
    isSubmitting,
    submitError,
  };
}
