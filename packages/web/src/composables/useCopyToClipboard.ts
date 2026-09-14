import { toast } from 'vue-sonner';

export function useCopyToClipboard() {

  const copyToClipboard = (text: string, successMessage: string) => {
    navigator.clipboard.writeText(text);
    toast.success(successMessage);
  };

  return { copyToClipboard };
}
