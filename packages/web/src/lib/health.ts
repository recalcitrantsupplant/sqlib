/**
 * The API's `/health` answer, read once per page load and shared.
 *
 * The auth mode, the deployment mode, the upload limits and the server
 * location all come from `/health`. Each of those modules used to send its
 * own request, so one page load sent the same request four times.
 */

export interface HealthAnswer {
  ok: boolean;
  status: number;
  /** The parsed body, or null when it was not JSON. A 503 still carries one. */
  payload: Record<string, unknown> | null;
}

const answers = new Map<string, Promise<HealthAnswer>>();

/** `/health` at `apiBase`, sent on the first call and shared after it. Rejects on a network error. */
export function fetchHealth(apiBase: string): Promise<HealthAnswer> {
  const base = apiBase.replace(/\/$/, '');
  let answer = answers.get(base);
  if (!answer) {
    answer = (async () => {
      const response = await fetch(`${base}/health`);
      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      return { ok: response.ok, status: response.status, payload };
    })();
    // A network error is not kept, so a later caller can try again.
    answer.catch(() => answers.delete(base));
    answers.set(base, answer);
  }
  return answer;
}

/** For tests: forgets every answer. */
export function resetHealth(): void {
  answers.clear();
}
