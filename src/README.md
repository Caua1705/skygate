# SkyGate frontend modules

`main.js` is the single browser entry point. New frontend work must use the modules below instead of extending the legacy controller.

- `api/`: API boundaries, timeout and error normalization.
- `config/`: environment-safe frontend configuration.
- `state/`: small observable stores, separated by application concern.
- `presentation/`: passenger-facing labels, search policy and semantic route steps.
- `map/`: reusable map cache utilities.
- `utils/`: framework-free pure utilities.

The existing `app.js` is intentionally retained as a compatibility controller while its rendering and map lifecycle are migrated in small, verifiable slices. Do not add new API URLs, graph rules, raw-node label logic or global state there.
