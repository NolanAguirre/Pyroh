# React UI

Run `make install`, then `make start`. Start runs Vite in the background using
`envdir` and `env-dir/${ENV_USER:-$USER}`; output goes to `start.log`.
For foreground development, use `envdir ./env-dir/$USER npm start`.
`npm start` alone uses env-dir/default unless HOST and PORT are supplied.
Use Node 20.19+ or 22.12+ (see package.json).

Open the /<app-name>/ URL printed by Vite. The port is allocated under ui/<name>
in the repository's existing port domain. Vite fails if that port is occupied.
If using a reverse proxy, forward this prefix, including WebSocket upgrades.

`make build` creates dist/. Serve it beneath the same /<app-name>/ prefix;
configure your production server's SPA fallback if adding client-side routing.

## Component library

The file dependency links ../../component-library. `make install` first runs
its install and build targets before installing app dependencies; `make build`
first runs its build target. The library must
export its built JavaScript entry and component-library/dist/component-library.css.
Import components from `component-library`; its stylesheet is already imported.

Vite development resolves the library to src/index.js, handles JSX in its .js
files, and watches source edits. Source components must import their own CSS;
the built stylesheet is ignored in development. Production uses the package's
built exports and stylesheet. React, ReactDOM and react-virtuoso resolve to the
app's copies in both modes. No library files are copied or created by scaffolding.
