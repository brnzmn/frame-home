// Coming back to the launcher by itself. Both behaviours were confirmed on the TV
// (docs/phase0-findings.md): the app keeps running while hidden, and it can bring itself
// forward by launching its own id.
import type { Tv } from './platform/tv';

export interface LifecycleOptions {
  /** Experimental: come back in front when Samsung's home appears over the launcher. */
  returnOverSamsungHome: boolean;
}

export function startLifecycle(tv: Tv, options: LifecycleOptions): { opened(appId: string): void } {
  let openedId: string | null = null;
  let seenRunning = false;
  let poll: number | undefined;

  const stopPolling = (): void => {
    if (poll !== undefined) window.clearInterval(poll);
    poll = undefined;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      stopPolling();
      openedId = null;
      return;
    }

    if (openedId) {
      // We opened an app. Watch the running list and return once that app is gone.
      poll = window.setInterval(async () => {
        const running = await tv.runningAppIds();
        if (!running || !openedId) return;
        if (running.includes(openedId)) {
          seenRunning = true;
          return;
        }
        if (!seenRunning) return; // not started yet
        stopPolling();
        openedId = null;
        tv.bringToFront().catch(() => {});
      }, 1500);
      return;
    }

    if (options.returnOverSamsungHome) {
      // Hidden without us opening anything: Samsung's home came forward.
      window.setTimeout(() => {
        if (document.visibilityState === 'hidden') tv.bringToFront().catch(() => {});
      }, 400);
    }
  });

  return {
    opened(appId: string): void {
      openedId = appId;
      seenRunning = false;
      // Settings and the quick panel open over the launcher without hiding it. If we are
      // still on screen a few seconds later, there is no app to wait for.
      window.setTimeout(() => {
        if (document.visibilityState === 'visible' && openedId === appId) openedId = null;
      }, 5000);
    },
  };
}
