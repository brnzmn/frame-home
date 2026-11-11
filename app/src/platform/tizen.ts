import type { Tv, TvApp } from './tv';

// Only the calls confirmed on the Frame Pro (Tizen 9.0) in docs/phase0-findings.md.
declare const tizen: any;

function message(error: unknown, fallback: string): Error {
  const text = (error as { message?: string } | null)?.message;
  return new Error(text || fallback);
}

declare const webapis: any;

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

    bringToFront: () =>
      new Promise<void>((resolve, reject) => {
        if (!ownId) {
          reject(new Error('This app does not know its own id'));
          return;
        }
        tizen.application.launch(ownId, () => resolve(), (e: unknown) => reject(message(e, 'Could not come back to the front')));
      }),
  };
}
