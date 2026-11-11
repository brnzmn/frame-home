import type { Tv, TvApp } from './tv';

// Only the calls confirmed on the Frame Pro (Tizen 9.0) in docs/phase0-findings.md.
declare const tizen: any;

function message(error: unknown, fallback: string): Error {
  const text = (error as { message?: string } | null)?.message;
  return new Error(text || fallback);
}

declare const webapis: any;

/** The keeper's own page on the TV (app/public/service/keeper.js). */
const KEEPER_URL = 'http://127.0.0.1:47811';

/** Samsung's own API script lives on the TV. It is loaded at run time, never bundled. */
function loadSamsungApis(): void {
  if ('webapis' in window) return;
  const script = document.createElement('script');
  script.src = '$WEBAPIS/webapis/webapis.js';
  document.head.appendChild(script);
}

export function createTizenTv(): Tv {
  loadSamsungApis();
  let ownId: string | null = null;
  try {
    ownId = tizen.application.getCurrentApplication().appInfo.id;
  } catch {
    ownId = null;
  }

  return {
    kind: 'tizen',
    appId: ownId,

    installedApps: () =>
      new Promise<TvApp[]>((resolve, reject) => {
        tizen.application.getAppsInfo(
          (list: any[]) =>
            resolve(
              list.map((a) => ({
                id: a.id,
                name: a.name,
                shown: Boolean(a.show),
                iconUrl: a.iconPath ? (a.iconPath.charAt(0) === '/' ? `file://${a.iconPath}` : a.iconPath) : null,
              })),
            ),
          (e: unknown) => reject(message(e, 'The TV did not return its app list')),
        );
      }),

    open: (appId) =>
      new Promise<void>((resolve, reject) => {
        tizen.application.launch(appId, () => resolve(), (e: unknown) => reject(message(e, `Could not open ${appId}`)));
      }),

    runningAppIds: () =>
      new Promise<string[] | null>((resolve) => {
        try {
          tizen.application.getAppsContext(
            (contexts: any[]) => resolve(contexts.map((c) => c.appId)),
            () => resolve(null),
          );
        } catch {
          resolve(null);
        }
      }),

    foregroundAppId: () => {
      try {
        // Throws "AppID is null" while the TV is between apps, for instance on the way into Art Mode.
        return webapis.appcommon.getForegroundAppId() || null;
      } catch {
        return null;
      }
    },

    startedBy: () => {
      try {
        const request = tizen.application.getCurrentApplication().getRequestedAppControl();
        const control = request.appControl;
        const data = (control.data ?? []).map((d: any) => `${d.key}=${JSON.stringify(d.value)}`).join(' ');
        return `${control.operation ?? 'no operation'} ${data} caller=${request.callerAppId ?? 'none'}`.slice(0, 300);
      } catch (e) {
        return `unknown (${(e as Error).message})`;
      }
    },

    bringToFront: () =>
      new Promise<void>((resolve, reject) => {
        if (!ownId) {
          reject(new Error('This app does not know its own id'));
          return;
        }
        tizen.application.launch(ownId, () => resolve(), (e: unknown) => reject(message(e, 'Could not come back to the front')));
      }),

    startKeeper: () =>
      new Promise<void>((resolve, reject) => {
        if (!ownId) {
          reject(new Error('This app does not know its own id'));
          return;
        }
        // The service lives in the same package: "<package>.Keeper" (config.xml).
        const keeperId = `${ownId.split('.')[0]}.Keeper`;
        try {
          tizen.application.launchAppControl(
            new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/service'),
            keeperId,
            () => resolve(),
            (e: unknown) => reject(message(e, 'The keeper did not start')),
          );
        } catch (e) {
          reject(message(e, 'The keeper did not start'));
        }
      }),

    keeperAnswers: async () => {
      try {
        return (await fetch(`${KEEPER_URL}/`, { signal: AbortSignal.timeout(1500) })).ok;
      } catch {
        return false;
      }
    },

    sleepNoticeAge: async () => {
      try {
        const reply = await fetch(`${KEEPER_URL}/sleep`, { signal: AbortSignal.timeout(800) });
        const age = (await reply.json()).sleepNoticeAgeMs;
        return typeof age === 'number' ? age : null;
      } catch {
        return null;
      }
    },

    noteToKeeper: (text) => {
      fetch(`${KEEPER_URL}/note?text=${encodeURIComponent(text.slice(0, 200))}`).catch(() => {});
    },
  };
}
