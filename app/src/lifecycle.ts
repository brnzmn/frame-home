// Coming back to the launcher by itself. Everything here was measured on the TV
// (docs/phase0-findings.md):
// - the app keeps running while hidden and can bring itself forward by launching its own id;
// - `webapis.appcommon.getForegroundAppId()` says which app is in front;
// - Samsung's home in front reports `com.samsung.tv.csfs`;
// - Art Mode reports `org.tizen.art-app`, after a moment with no app at all.
// So the launcher jumps back only when it sees Samsung's home, and never during Art Mode.
// Its limit: within a minute of the power key putting the TV into Art Mode, the TV stops
// this page. Nothing here runs after a real Art Mode stay.
import type { Tv } from './platform/tv';

export const SAMSUNG_HOME = 'com.samsung.tv.csfs';
/** A second Home press this soon after a jump back means "I do want Samsung's home". */
export const DOUBLE_PRESS_MS = 6000;
/** Readings of Samsung's home in a row before jumping, so a passing state is not acted on. */
const CONFIRMATIONS = 2;
const TICK_MS = 250;
/** The running-apps list is asked for less often than the foreground app. */
const RUNNING_EVERY = 6;
/** Every ten seconds, hidden or not, the launcher checks that the keeper still answers. */
const UPKEEP_EVERY_TICKS = 40;
/** Checks the keeper may miss in a row before the launcher starts it again. */
const KEEPER_MISSES = 2;
/** When the launcher was last back on screen after a jump. */
const LAST_JUMP = 'frame-home.lastJump';
/** When the launcher last asked to be brought back; settled once it is on screen. */
const PENDING_JUMP = 'frame-home.pendingJump';
/** A jump that has not put the launcher on screen within this time did not work. */
const JUMP_LANDS_WITHIN_MS = 10000;
/**
 * How long to wait before asking again to be brought forward. Measured on the TV: a request
 * made while it is still leaving Art Mode is dropped, and that can last six seconds.
 */
export const RETRY_AFTER_MS = 1000;
/** After this many requests the launcher stops asking until something else comes in front. */
export const MAX_REQUESTS = 15;
export const ART_APP = 'org.tizen.art-app';
/** A sleep notice this recent means Samsung's home is not there for anyone to see. */
export const SLEEP_NOTICE_MS = 20000;

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
/** Enough for an evening of use plus the night after it. */
const TRACE_LINES = 80;

/**
 * A short on-TV record of what the launcher did and when, read back through the debug port.
 * The debug port drops whenever the launcher is hidden, so timings can only come from here.
 */
export function trace(event: string): void {
  // Month, day and time in UTC: the record has to make sense the morning after.
  const line = `${new Date().toISOString().slice(5, 23).replace('T', ' ')} ${event}`;
  try {
    const list: string[] = JSON.parse(localStorage.getItem(TRACE) ?? '[]');
    list.push(line);
    localStorage.setItem(TRACE, JSON.stringify(list.slice(-TRACE_LINES)));
  } catch {
    // Tracing is a convenience; never let it break the launcher.
  }
  try {
    copyTo?.(event);
  } catch {
    // Same.
  }
}

let copyTo: ((event: string) => void) | undefined;
/** Also pass every record line on, for instance to the keeper, whose record survives this page. */
export function copyTraceTo(receiver: (event: string) => void): void {
  copyTo = receiver;
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

/**
 * The launcher has asked to be brought forward and is still hidden.
 * @param front the app in front, or null when the TV does not say
 * @param ownId the launcher's own id
 */
export function onWaiting(
  front: string | null,
  ownId: string | null,
  msSinceAsked: number,
  requests: number,
): 'wait' | 'again' | 'drop' | 'give up' {
  // Another app is in front, or Art Mode: the user has moved on. Do not pull the TV back.
  if (front !== null && front !== SAMSUNG_HOME && front !== ownId) return 'drop';
  if (msSinceAsked < RETRY_AFTER_MS) return 'wait';
  // The TV is not going to show us. Whatever state it is in, stop poking it.
  return requests >= MAX_REQUESTS ? 'give up' : 'again';
}

/**
 * Samsung's home has come in front. Coming back is right, except in one case: the TV was in
 * Art Mode and has just said it is going to sleep, so nobody pressed anything.
 */
export function mayJump(cameFromArt: boolean, sleepNoticeAgeMs: number | null, frontNow: string | null): boolean {
  // Asking about the sleep notice takes a moment; Samsung's home must still be in front after it.
  if (frontNow !== SAMSUNG_HOME) return false;
  return !(cameFromArt && sleepNoticeAgeMs !== null && sleepNoticeAgeMs < SLEEP_NOTICE_MS);
}

export interface LifecycleOptions {
  /** Come back in front when Samsung's home appears. Pressing Home twice leaves it up. */
  returnOverSamsungHome: boolean;
}

function stored(key: string): number | null {
  try {
    const at = Number(localStorage.getItem(key));
    return at > 0 ? at : null;
  } catch {
    return null;
  }
}

function store(key: string, at: number | null): void {
  try {
    if (at === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(at));
  } catch {
    // Without storage the double press cannot be recognised; coming back still works.
  }
}

function msSinceLastJump(): number | null {
  const at = stored(LAST_JUMP);
  return at === null ? null : Date.now() - at;
}

/**
 * The launcher is on screen. If it had asked to be brought back, that jump has landed: the
 * double-press window counts from now, the moment the user can see the launcher again.
 */
function settleJump(): void {
  const asked = stored(PENDING_JUMP);
  if (asked === null) return;
  store(PENDING_JUMP, null);
  if (Date.now() - asked < JUMP_LANDS_WITHIN_MS) store(LAST_JUMP, Date.now());
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
  /** Set while the launcher has asked to be brought forward and is not on screen yet. */
  let asked: { at: number; jumped: boolean; requests: number } | null = null;
  let lastFront: string | null = null;
  /** The last app seen in front other than Samsung's home: tells Art Mode ending from a Home press. */
  let frontBeforeHome: string | null = null;
  let checkingSleep = false;

  const stop = (): void => {
    stopTicker?.();
    stopTicker = undefined;
  };

  const ask = (): void => {
    if (!asked) return;
    asked.at = Date.now();
    asked.requests++;
    if (asked.jumped) store(PENDING_JUMP, asked.at);
    tv.bringToFront().catch(() => {});
  };

  const comeBack = (jumped: boolean): void => {
    trace(jumped ? 'jump back over Samsung home' : `return after ${openedId}`);
    openedId = null;
    watch = idleWatch;
    asked = { at: 0, jumped, requests: 0 };
    ask();
    // Keep ticking until the launcher is on screen: a request can be dropped, and a page
    // hidden for minutes cannot rely on its own timers to notice (neither fired in 6.7 s).
    if (!stopTicker) stopTicker = startTicker(() => void tick());
  };

  let keeperMissed = 0;
  const upkeep = (): void => {
    tv.keeperAnswers().then((answers) => {
      keeperMissed = answers ? 0 : keeperMissed + 1;
      if (keeperMissed < KEEPER_MISSES) return;
      keeperMissed = 0;
      trace('keeper not answering: starting it again');
      tv.startKeeper().catch(() => {});
    });
  };

  const tick = async (): Promise<void> => {
    ticks++;
    if (ticks % UPKEEP_EVERY_TICKS === 0) upkeep();
    const front = tv.foregroundAppId();
    if (front !== lastFront) {
      trace(`in front: ${front ?? 'unknown'}`);
      lastFront = front;
    }
    if (front !== null && front !== SAMSUNG_HOME) frontBeforeHome = front;
    if (asked) {
      const next = onWaiting(front, tv.appId, Date.now() - asked.at, asked.requests);
      if (next === 'again') {
        trace('still hidden: asking again');
        ask();
      } else if (next === 'drop' || next === 'give up') {
        trace(next === 'drop' ? `not coming back: ${front} is in front` : 'not coming back: the TV did not show the launcher');
        asked = null;
        store(PENDING_JUMP, null);
        // Leave Samsung's home alone until something else has been in front.
        if (next === 'give up') watch = { letHomeStay: true, seen: 0 };
      }
      return;
    }
    if (options.returnOverSamsungHome && !checkingSleep) {
      const result = onReading(watch, front, msSinceLastJump());
      if (result.watch.letHomeStay && !watch.letHomeStay) trace('second Home press: leaving Samsung home up');
      watch = result.watch;
      if (result.jump) {
        const cameFromArt = frontBeforeHome === ART_APP;
        // Only after Art Mode is there a question to ask; a Home press must not wait for it.
        checkingSleep = cameFromArt;
        const sleepNotice = cameFromArt ? await tv.sleepNoticeAge() : null;
        checkingSleep = false;
        if (document.visibilityState !== 'hidden') return;
        const frontNow = cameFromArt ? tv.foregroundAppId() : front;
        if (mayJump(cameFromArt, sleepNotice, frontNow)) {
          comeBack(true);
        } else if (frontNow === SAMSUNG_HOME) {
          trace('not coming back: the TV said it is going to sleep');
          watch = { letHomeStay: true, seen: 0 };
        }
        // Otherwise something else came in front while asking; the next readings deal with it.
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

  const whenHidden = (): void => {
    ticks = 0;
    asked = null;
    lastFront = tv.foregroundAppId();
    frontBeforeHome = lastFront !== null && lastFront !== SAMSUNG_HOME ? lastFront : null;
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
  };

  const whenShown = (): void => {
    openedId = null;
    watch = idleWatch;
    asked = null;
    settleJump();
  };

  document.addEventListener('visibilitychange', () => {
    stop();
    if (document.visibilityState === 'visible') {
      trace('on screen again');
      whenShown();
      return;
    }
    whenHidden();
  });
  // The TV can start the launcher in the background, with no event to say it is hidden.
  if (document.visibilityState === 'hidden') whenHidden();
  else whenShown();
  // While hidden the worker-driven tick does the upkeep; a hidden page's own timers stall.
  window.setInterval(() => {
    if (document.visibilityState === 'visible') upkeep();
  }, UPKEEP_EVERY_TICKS * TICK_MS);

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
