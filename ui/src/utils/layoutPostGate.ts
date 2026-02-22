/**
 * Gate that prevents PATCH (updateComponent) requests from firing
 * while a layout POST is in-flight.
 *
 * When a user drops a new component, the full layout POST must complete
 * (auto-saving the tree server-side) before a PATCH can update an
 * individual component's model — otherwise the server won't find the
 * component in its stored tree.
 *
 * Usage:
 *   - Call `markLayoutPostStarted()` when a layout POST begins.
 *   - Call `markLayoutPostCompleted()` when it finishes (success or error).
 *   - Call `await waitForLayoutPost()` before sending a PATCH.
 *     It resolves immediately if no POST is in-flight.
 */

let pendingPostPromise: Promise<void> | null = null;
let resolvePendingPost: (() => void) | null = null;

/**
 * Signal that a layout POST has started.
 * If a previous POST was already pending, it stays (the gate remains closed).
 */
export function markLayoutPostStarted(): void {
  if (!pendingPostPromise) {
    pendingPostPromise = new Promise<void>((resolve) => {
      resolvePendingPost = resolve;
    });
  }
}

/**
 * Signal that the layout POST has completed (success or failure).
 */
export function markLayoutPostCompleted(): void {
  if (resolvePendingPost) {
    resolvePendingPost();
  }
  pendingPostPromise = null;
  resolvePendingPost = null;
}

/**
 * Wait for any in-flight layout POST to complete.
 * Resolves immediately if no POST is in-flight.
 * Includes a safety timeout to prevent infinite blocking if the POST
 * never completes (e.g., network error without proper cleanup).
 */
const GATE_TIMEOUT_MS = 15000;

export async function waitForLayoutPost(): Promise<void> {
  if (pendingPostPromise) {
    await Promise.race([
      pendingPostPromise,
      new Promise<void>((resolve) => setTimeout(resolve, GATE_TIMEOUT_MS)),
    ]);
  }
}
