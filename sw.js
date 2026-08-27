const CACHE_PREFIX = 'skygate-';
const SHELL_CACHE_NAME = `${CACHE_PREFIX}shell-v6`;
const RUNTIME_CACHE_NAME = `${CACHE_PREFIX}runtime-v1`;
const ACTIVE_CACHE_NAMES = new Set([SHELL_CACHE_NAME, RUNTIME_CACHE_NAME]);
const TRUSTED_RUNTIME_ORIGINS = new Set([
  'https://api.gatesky.com.br',
  'https://code.iconify.design',
  'https://api.iconify.design',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
]);
const PRECACHE = [
  '/',
  '/index.html',
  // The floor plans — the build output of scripts/normalize-floor-svgs.mjs,
  // which reads assets/floors/lite (no Figma filters) and stamps the sg-*
  // vocabulary the stylesheet paints. 1.9 MB across the four, down from 2.7:
  // dropping the filters took 1178 shapes out from under a filter and 666
  // feGaussianBlur out of the raster entirely.
  //
  // They earn their place here: without them the navigation map has no plan to
  // draw the route on, and that is the one screen a traveller opens with no
  // signal airside. buildBaseFloorSvg() degrades to an empty stage if one is
  // missing, so a partial cache is a dimmer map, never a broken one.
  // assets/floors/full and assets/floors/lite are BUILD INPUTS and are
  // deliberately not cached — the app never fetches them.
  '/assets/floors/0.svg',
  '/assets/floors/1.svg',
  '/assets/floors/2.svg',
  '/assets/floors/3.svg',
  '/manifest.webmanifest',
  '/styles/index.css',
  '/styles/tokens.css',
  '/styles/base.css',
  '/styles/components.css',
  '/styles/overlays.css',
  '/styles/desktop.css',
  '/styles/a11y.css',
  '/styles/screens/planning.css',
  '/styles/screens/planning-v5.css',
  '/styles/screens/home.css',
  '/styles/screens/route-summary.css',
  '/styles/screens/navigation.css',
  '/styles/screens/navigation-sheet.css',
  '/styles/screens/navigation-timeline.css',
  '/styles/screens/navigation-route-map.css',
  '/styles/components/place-detail.css',
  '/src/main.js',
  '/src/app/bootstrap.js',
  '/src/app/actions.js',
  '/src/app/events.js',
  '/src/app/routeController.js',
  '/src/app/router.js',
  '/src/app/constants.js',
  '/src/app/config/appConfig.js',
  '/src/components/Icon.js',
  '/src/components/LocationDetail.js',
  '/src/components/PlaceDetailSheet.js',
  '/src/components/SearchOverlay.js',
  '/src/components/ds/index.js',
  '/src/components/ds/icon.js',
  '/src/components/ds/Button.js',
  '/src/components/ds/Card.js',
  '/src/components/ds/Chip.js',
  '/src/components/ds/Header.js',
  '/src/components/ds/IconButton.js',
  '/src/components/ds/Metric.js',
  '/src/components/ds/Sheet.js',
  '/src/components/ds/StepRail.js',
  '/src/map/floorMapBuilder.js',
  '/src/map/floorSwitch.js',
  '/src/map/mapFit.js',
  '/src/map/mapPanZoom.js',
  '/src/map/svgMapCache.js',
  '/src/screens/home/HomeScreen.js',
  '/src/screens/routeSummary/RouteSummaryScreen.js',
  '/src/screens/navigation/NavigationScreen.js',
  '/src/screens/navigation/NavigationShell.js',
  '/src/screens/navigation/NavigationTimeline.js',
  '/src/screens/navigation/NavigationRouteMap.js',
  '/src/services/api/index.js',
  '/src/services/api/airportsApi.js',
  '/src/services/api/httpClient.js',
  '/src/services/api/routesApi.js',
  '/src/services/flightSlack.js',
  '/src/services/nodePresentation.js',
  '/src/services/nodeSearch.js',
  '/src/services/normalize.js',
  '/src/services/placesMock.js',
  '/src/services/routeOptions.js',
  '/src/services/routeSteps.js',
  '/src/services/semanticStepBuilder.js',
  '/src/state/appState.js',
  '/src/state/createStore.js',
  '/src/state/sessionPersistence.js',
  '/src/state/selectors.js',
  '/src/utils/dom.js',
  '/src/utils/format.js',
  '/assets/logo-skygate.png',
  '/assets/logo-skygate-white.png',
  '/assets/logo-symbol.png',
  '/assets/apple-touch-icon.png',
  '/assets/favicon.ico',
  '/assets/favicon-32.png',
  '/assets/icon-192-maskable.png',
  '/assets/icon-512-maskable.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && !ACTIVE_CACHE_NAMES.has(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()),
  );
});

function staleWhileRevalidate(event, request, cacheName) {
  const cachePromise = caches.open(cacheName);
  const revalidation = cachePromise.then(cache => (
    fetch(request).then(response => {
      if (!response.ok && response.type !== 'opaque') return response;
      return cache.put(request, response.clone())
        .then(() => response, () => response);
    })
  ));

  // Keep the refresh alive after a cached response is returned, while making
  // expected offline failures harmless to the service-worker lifecycle.
  event.waitUntil(revalidation.then(() => undefined, () => undefined));
  event.respondWith(
    cachePromise
      .then(cache => cache.match(request))
      .then(cached => cached || revalidation)
      .catch(() => Response.error()),
  );
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) {
    if (!TRUSTED_RUNTIME_ORIGINS.has(url.origin)) return;
    if (request.headers.has('authorization')) return;
    staleWhileRevalidate(event, request, RUNTIME_CACHE_NAME);
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE_NAME).then(cache => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  staleWhileRevalidate(event, request, SHELL_CACHE_NAME);
});
