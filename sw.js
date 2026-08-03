const CACHE_PREFIX = 'skygate-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v2`;
const PRECACHE = [
  '/',
  '/index.html',
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
  '/src/state/selectors.js',
  '/src/utils/dom.js',
  '/src/utils/format.js',
  '/assets/logo-skygate.png',
  '/assets/logo-skygate-white.png',
  '/assets/logo-symbol.png',
  '/assets/apple-touch-icon.png',
  '/assets/favicon.ico',
  '/assets/icon-192-maskable.png',
  '/assets/icon-512-maskable.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put('/index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
      // A stale cached response wins immediately. Still refresh it in the
      // background, but absorb offline failures so they do not become an
      // unhandled promise rejection in the service worker.
      if (cached) {
        network.catch(() => {});
        return cached;
      }
      return network;
    }),
  );
});
