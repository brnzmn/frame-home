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
  installedApps(): Promise<TvApp[]>;
  open(appId: string): Promise<void>;
  /** Ids of the apps running right now, or null when the TV will not say. */
  runningAppIds(): Promise<string[] | null>;
  /** Bring this app back in front. On the TV this reloads the page, so save state first. */
  bringToFront(): Promise<void>;
}

export function connectTv(): Tv {
  return 'tizen' in window ? createTizenTv() : createMockTv();
}
