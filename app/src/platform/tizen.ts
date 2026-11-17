import type { ArtItem, Tv, TvApp } from './tv';

// Only the calls confirmed on the Frame Pro (Tizen 9.0) in docs/phase0-findings.md.
declare const tizen: any;

function message(error: unknown, fallback: string): Error {
  const text = (error as { message?: string } | null)?.message;
  return new Error(text || fallback);
}

declare const webapis: any;

/** The keeper's own page on the TV (app/public/service/keeper.js). */
/** Tiles for TV inputs carry this in place of an app id, e.g. "input:HDMI3". */
export const INPUT_PREFIX = 'input:';
/** Samsung's full-screen view of the current input. */
const TV_VIEWER = 'org.tizen.tv-viewer';
const KEEPER_URL = 'http://127.0.0.1:47811';
/** Content ids as the keeper accepts them. */
const ART_ID = /^[A-Za-z0-9_-]{1,64}$/;

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
        const launch = (id: string): void =>
          tizen.application.launch(id, () => resolve(), (e: unknown) => reject(message(e, `Could not open ${appId}`)));
        if (!appId.startsWith(INPUT_PREFIX)) {
          launch(appId);
          return;
        }
        // An input such as "input:HDMI3": point the TV's main picture at it, then open Samsung's
        // own full-screen input view (seen on the TV 2026-11-16: it shows the current source).
        const wanted = appId.slice(INPUT_PREFIX.length);
        const show = (): void => launch(TV_VIEWER);
        try {
          if (`${tizen.tvwindow.getSource('MAIN')?.type}${tizen.tvwindow.getSource('MAIN')?.number}` === wanted) {
            show();
            return;
          }
          tizen.systeminfo.getPropertyValue(
            'VIDEOSOURCE',
            (vs: any) => {
              const source = [...(vs.connected ?? []), ...(vs.disconnected ?? [])].find((s: any) => `${s.type}${s.number}` === wanted);
              if (!source) {
                reject(new Error(`The TV has no input ${wanted}`));
                return;
              }
              tizen.tvwindow.setSource(source, show, show, 'MAIN');
            },
            show,
          );
        } catch {
          show();
        }
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

    artList: async () => {
      try {
        const reply = await fetch(`${KEEPER_URL}/art/list`, { signal: AbortSignal.timeout(1500) });
        if (!reply.ok) return null;
        const body = await reply.json();
        if (!Array.isArray(body?.items)) return null;
        return body.items
          .filter((item: any) => item && typeof item.id === 'string' && ART_ID.test(item.id))
          .map(
            (item: any): ArtItem => ({
              id: item.id,
              kind: item.kind === 'mine' ? 'mine' : 'store',
              thumbUrl: item.thumb ? `${KEEPER_URL}/art/thumb/${encodeURIComponent(item.id)}` : null,
            }),
          );
      } catch {
        return null;
      }
    },

    chooseArt: async (id) => {
      try {
        const reply = await fetch(`${KEEPER_URL}/art/choose?id=${encodeURIComponent(id)}`, { method: 'POST', signal: AbortSignal.timeout(1500) });
        return reply.ok;
      } catch {
        return false;
      }
    },

    noteToKeeper: (text) => {
      fetch(`${KEEPER_URL}/note?text=${encodeURIComponent(text.slice(0, 200))}`).catch(() => {});
    },

    connectedInputs: () =>
      new Promise<string[] | null>((resolve) => {
        try {
          tizen.systeminfo.getPropertyValue(
            'VIDEOSOURCE',
            (vs: any) => resolve((vs.connected ?? []).map((s: any) => `${s.type}${s.number}`)),
            () => resolve(null),
          );
        } catch {
          resolve(null);
        }
      }),

    stepAside: () => {
      try {
        tizen.application.getCurrentApplication().hide();
      } catch {
        // Nothing more to try: the launcher stays on screen.
      }
    },
  };
}
