// What the launcher needs from a TV. Two implementations: the real Tizen APIs, and a fake TV
// so the whole thing runs in a desktop browser.
import { createMockTv } from './mock';
import { createTizenTv } from './tizen';

export interface TvApp {
  id: string;
  name: string;
  /** False for the many background services and system parts the TV also lists. */
  shown: boolean;
  /** Icon the TV ships for the app. Many do not load, so tiles always have their own artwork underneath. */
  iconUrl: string | null;
}

export interface Tv {
  readonly kind: 'tizen' | 'mock';
  /** This app's own id on the TV, or null when it is not known. */
  readonly appId: string | null;
  installedApps(): Promise<TvApp[]>;
  open(appId: string): Promise<void>;
  /** Ids of the apps running right now, or null when the TV will not say. */
  runningAppIds(): Promise<string[] | null>;
  /** Id of the app on screen right now, or null when the TV does not say (as between apps). */
  foregroundAppId(): string | null;
  /** How the TV says it started this app (the launch request it passed), for the launcher's own record. */
  startedBy(): string;
  /** Bring this app back in front. On the TV this reloads the page, so save state first. */
  bringToFront(): Promise<void>;
  /**
   * Start the keeper, the background service that listens to the TV's art channel
   * (app/public/service/keeper.js). Safe to call when it is already running.
   */
  startKeeper(): Promise<void>;
  /** Whether the keeper answers on its own page right now. */
  keeperAnswers(): Promise<boolean>;
  /**
   * Milliseconds since the TV last announced it was going to sleep, as the keeper heard it on
   * the art channel; null when it never did, or when the keeper does not answer.
   */
  sleepNoticeAge(): Promise<number | null>;
  /** Add a line to the keeper's record, which outlives this page. */
  noteToKeeper(text: string): void;
  /** The inputs the TV calls connected right now (such as "HDMI3"), or null when it will not say. */
  connectedInputs(): Promise<string[] | null>;
  /** Leave the screen to whatever is underneath (Samsung's home), without closing. */
  stepAside(): void;
}

export function connectTv(): Tv {
  return 'tizen' in window ? createTizenTv() : createMockTv();
}
