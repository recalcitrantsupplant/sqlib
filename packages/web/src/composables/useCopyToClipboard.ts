import { toast } from 'vue-sonner';

/**
 * Write text to the clipboard and say how it went.
 *
 * The write is awaited. The browser can refuse it (no focus, no permission,
 * an insecure origin), and a success toast for a refused write tells the
 * person the clipboard holds text that it does not hold.
 */
export function useCopyToClipboard() {
  /** Resolves to true when the clipboard holds `text`. */
  const writeClipboard = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      toast.error('Could not copy. Select the text and press Ctrl+C.');
      return false;
    }
  };

  const copyToClipboard = async (text: string, successMessage: string): Promise<boolean> => {
    const ok = await writeClipboard(text);
    if (ok) toast.success(successMessage);
    return ok;
  };

  return { copyToClipboard, writeClipboard };
}
