// Coming back to the launcher by itself. Everything here was measured on the TV
// (docs/phase0-findings.md):
// - the app keeps running while hidden and can bring itself forward by launching its own id;
// - `webapis.appcommon.getForegroundAppId()` says which app is in front;
// - Samsung's home in front reports `com.samsung.tv.csfs`;
// - Art Mode reports `org.tizen.art-app`, after a moment with no app at all.
// So the launcher jumps back only when it sees Samsung's home, and never during Art Mode.
import type { Tv } from './platform/tv';

export const SAMSUNG_HOME = 'com.samsung.tv.csfs';
/** A second Home press this soon after a jump back means "I do want Samsung's home". */
export const DOUBLE_PRESS_MS = 6000;
/** Readings of Samsung's home in a row before jumping, so a passing state is not acted on. */
const CONFIRMATIONS = 2;
const TICK_MS = 250;
/** The running-apps list is asked for less often than the foreground app. */
const RUNNING_EVERY = 6;
const LAST_JUMP = 'frame-home.lastJump';

/**
 * Calls `onTick` every TICK_MS, also while the page is hidden. A hidden page's own timers are
 * slowed to one a second (measured on the TV: the jump back took four seconds), but messages
 * from a worker are delivered on time.
 */
function startTicker(onTick: () => void): () => void {
  try {
    const source = `setInterval(function () { postMessage(0); }, ${TICK_MS});`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = onTick;
    return () => worker.terminate();
  } catch {
    const id = window.setInterval(onTick, TICK_MS);
    return () => window.clearInterval(id);
  }
}

const TRACE = 'frame-home.trace';

/**
 * A short on-TV record of what the launcher did and when, read back through the debug port.
 * The debug port drops whenever the launcher is hidden, so this is the only way to see timings.
 */
export function trace(event: string): void {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(TRACE) ?? '[]');
    list.push(`${new Date().toISOString().slice(11, 23)} ${event}`);
    localStorage.setItem(TRACE, JSON.stringify(list.slice(-30)));
  } catch {
    // Tracing is a convenience; never let it break the launcher.
  }
}

export interface HomeWatch {
  /** Samsung's home is being left alone until the user moves on to something else. */
  letHomeStay: boolean;
  /** Readings of Samsung's home in a row. */
  seen: number;
}

export const idleWatch: HomeWatch = { letHomeStay: false, seen: 0 };

/**
 * One reading of what is in front while the launcher is hidden.
 * @param foreground the app in front, or null when the TV does not say
 * @param msSinceLastJump time since the launcher last jumped back, or null if it never has
 */
export function onReading(watch: HomeWatch, foreground: string | null, msSinceLastJump: number | null): { watch: HomeWatch; jump: boolean } {
  if (foreground === null) return { watch, jump: false }; // unknown: change nothing
  if (foreground !== SAMSUNG_HOME) return { watch: idleWatch, jump: false }; // an app, or Art Mode
  if (watch.letHomeStay) return { watch, jump: false };
  if (watch.seen === 0 && msSinceLastJump !== null && msSinceLastJump < DOUBLE_PRESS_MS) {
    return { watch: { letHomeStay: true, seen: 0 }, jump: false };
  }
  const seen = watch.seen + 1;
  return seen >= CONFIRMATIONS ? { watch: idleWatch, jump: true } : { watch: { letHomeStay: false, seen }, jump: false };
}

/**
 * The moment the launcher goes hidden. Measured on the TV: when Home is pressed, Samsung's home
 * is already reported in front at that moment, so there is nothing to wait for. Waiting costs
 * seconds, because a hidden page's timers run once a second.
 */
export function onHidden(openedByUs: boolean, foreground: string | null, msSinceLastJump: number | null): 'jump' | 'stay' | 'watch' {
  if (openedByUs || foreground !== SAMSUNG_HOME) return 'watch';
  return msSinceLastJump !== null && msSinceLastJump < DOUBLE_PRESS_MS ? 'stay' : 'jump';
}

export interface LifecycleOptions {
  /** Come back in front when Samsung's home appears. Pressing Home twice leaves it up. */
  returnOverSamsungHome: boolean;
}

function msSinceLastJump(): number | null {
  try {
    const at = Number(localStorage.getItem(LAST_JUMP));
    return at > 0 ? Date.now() - at : null;
  } catch {
    return null;
  }
}

/** True for a few seconds after the launcher jumped back, to show the "press Home again" hint. */
export function justJumpedBack(): boolean {
  const since = msSinceLastJump();
  return since !== null && since < 4000;
}

export function startLifecycle(tv: Tv, options: LifecycleOptions): { opened(appId: string): void } {
  let openedId: string | null = null;
  let seenRunning = false;
  let watch: HomeWatch = idleWatch;
  let stopTicker: (() => void) | undefined;
  let ticks = 0;
  let asking = false;

  const stop = (): void => {
    stopTicker?.();
    stopTicker = undefined;
  };

  const comeBack = (jumped: boolean): void => {
    stop();
    trace(jumped ? 'jump back over Samsung home' : `return after ${openedId}`);
    openedId = null;
    if (jumped) {
      try {
        localStorage.setItem(LAST_JUMP, String(Date.now()));
      } catch {
        // Without storage the double press cannot be recognised; the jump still works.
      }
    }
    tv.bringToFront().catch(() => {});
  };

  let lastFront: string | null = null;

  const tick = async (): Promise<void> => {
    ticks++;
    const front = tv.foregroundAppId();
    if (front !== lastFront) {
      trace(`in front: ${front ?? 'unknown'}`);
      lastFront = front;
    }
    if (options.returnOverSamsungHome) {
      const result = onReading(watch, front, msSinceLastJump());
      if (result.watch.letHomeStay && !watch.letHomeStay) trace('second Home press: leaving Samsung home up');
      watch = result.watch;
      if (result.jump) {
        comeBack(true);
        return;
      }
    }
    // An app we opened has closed: return to the launcher.
    if (openedId && ticks % RUNNING_EVERY === 0 && !asking) {
      asking = true;
      const running = await tv.runningAppIds();
      asking = false;
      if (!running || !openedId) return;
      if (running.includes(openedId)) {
        seenRunning = true;
      } else if (seenRunning) {
        comeBack(false);
      }
    }
  };

  document.addEventListener('visibilitychange', () => {
    stop();
    if (document.visibilityState === 'visible') {
      openedId = null;
      watch = idleWatch;
      return;
    }
    ticks = 0;
    lastFront = tv.foregroundAppId();
    trace(`hidden, in front: ${lastFront ?? 'unknown'}`);
    if (options.returnOverSamsungHome) {
      const decision = onHidden(openedId !== null, lastFront, msSinceLastJump());
      if (decision === 'jump') {
        comeBack(true);
        return;
      }
      if (decision === 'stay') {
        watch = { letHomeStay: true, seen: 0 };
        trace('second Home press: leaving Samsung home up');
      }
    }
    stopTicker = startTicker(() => void tick());
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
