/**
 * Stopping an execution: by deadline, or because whoever asked for it left.
 *
 * Everything that runs on a caller's behalf takes an `AbortSignal`. This module
 * makes the one signal an execution carries — the caller's, combined with its
 * deadline — and gives the reason a name a route can turn into a status.
 */

/** Why an execution stopped before finishing. */
export class ExecutionAbortedError extends Error {
  constructor(
    message: string,
    /** 504 for a deadline, 499 for a caller who went away. */
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'ExecutionAbortedError';
  }
}

/** The reason a client disconnect aborts with. */
export function clientDisconnected(): ExecutionAbortedError {
  return new ExecutionAbortedError('Execution cancelled: the client disconnected', 499);
}

/**
 * One signal for an execution: aborted when `signal` is, or when `deadlineMs`
 * elapses, whichever comes first. `dispose` clears the timer; call it when the
 * execution ends so a finished run holds nothing open.
 */
export function executionSignal(
  signal: AbortSignal | undefined,
  deadlineMs: number | undefined,
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason);
  if (signal?.aborted) forward();
  else signal?.addEventListener('abort', forward, { once: true });

  let timer: NodeJS.Timeout | undefined;
  if (deadlineMs && deadlineMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(new ExecutionAbortedError(`Execution exceeded its ${deadlineMs}ms deadline`, 504));
    }, deadlineMs);
    timer.unref?.();
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
  };
}

/** The error an aborted signal stands for. */
export function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  return new ExecutionAbortedError(typeof reason === 'string' ? reason : 'Execution was aborted', 499);
}

/** Throw the abort reason if `signal` has fired. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

/**
 * `work`, unless `signal` fires first.
 *
 * For work that cannot itself be interrupted — or that may not notice its
 * signal — this is what lets the caller stop waiting at the deadline. The
 * abandoned promise still settles in the background; its result is ignored.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      work.catch(() => {});
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/** The part of a Node `ServerResponse` a disconnect is read from. */
type ClosableResponse = {
  on(event: 'close', listener: () => void): unknown;
  off(event: 'close', listener: () => void): unknown;
  readonly writableFinished: boolean;
};

/**
 * A signal that fires when the client goes away before its response is sent.
 *
 * Read from the response, not the request: a request's `close` fires as soon
 * as its body has been read, which for a POST is before any work starts. A
 * response that closes before it finished writing is a client that left.
 */
export function abortOnDisconnect(response: ClosableResponse): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onClose = () => {
    if (!response.writableFinished) controller.abort(clientDisconnected());
  };
  response.on('close', onClose);
  return { signal: controller.signal, dispose: () => response.off('close', onClose) };
}
