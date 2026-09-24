# Retained asset releases

`tools/package-atlas-assets.mjs` prepares the public site locally. It performs no network access, deployment, credential changes or retention pruning. Canonical source files remain in `docs`; generated output belongs under ignored `output/`.

Each release is a complete directory tree at `_atlas-assets/<full SHA-256>/`. Its identifier covers the sorted source paths, byte counts and full file hashes plus the packaging format version. `.atlas-release.json` records those exact files. All retained trees are verified before use; changed, missing, additional or symlinked files fail the build. A repeated identifier never changes its bytes.

Canonical HTML receives a relative `<base>` pointing to the corresponding HTML in the frozen tree. This preserves relative scripts, inline imports, CSS URLs, lazy classic scripts, module workers and nested iframe documents without rewriting their code. The root landing redirect stays canonical. Relative navigation from a canonical page stays within its release; application navigation and share links based on `location` stay canonical. Existing explicit `<base>` tags require review and fail packaging. Asset resolvers must use `document.baseURI` or their own script/module URL, rather than `location.href`. External CDN and root-absolute API URLs retain their existing behavior.

The original `?v=` keys and `performance/asset-manifest.json` remain useful source-change checks. They are not immutable addresses. The Worker only assigns `max-age=31536000, immutable` to successful responses inside the full-hash release namespace. Canonical assets revalidate; failures are not cached; API cache policy is unchanged. GitHub Pages controls its own response TTL, but serves the same content-addressed files and a generated `.nojekyll` marker.

Run a first release explicitly:

```sh
node tools/package-atlas-assets.mjs --source docs --out output/atlas-site --allow-empty-retained
```

For subsequent releases, provide a verified retention root containing `_atlas-assets/`:

```sh
node tools/package-atlas-assets.mjs --source docs --out output/atlas-site --retained output/atlas-asset-releases
```

Existing verified release trees in the output also survive a rebuild. Packaging stages the entire result before replacing its own generated output; it refuses to replace an unrelated directory. The output manifest records the current release, retained release IDs and canonical file hashes. The default 19,000-file safety cap stops a build before uncontrolled retention growth; it never removes a release or changes hosting limits.

Deployment must durably retain each published tree before exposing its canonical HTML. Every authorized publisher must load the same retention history, and production jobs must serialize updates to that history across all branches and manual dispatches. The candidate workflow uses a single production concurrency group and branch-specific preview groups. A branch or artifact that is discarded each build is insufficient. Keep all published release URLs available: the one-year immutable header is a minimum retention horizon, and long-lived open pages can request lazy assets later. Removing trees requires a separately designed retirement policy and a matching cache/open-page policy. No such pruning is automated here.

Production now uses GitHub Actions as its single publisher. Native Cloudflare Git Builds was disconnected after the database preparation release, preserving the Worker, runtime bindings and the version active at that time (`21085884-5f1d-414b-b83b-c57143ef4a77`). The subsequent PR #31 Actions deployment made version `dd5ebd5d-24f5-443c-96a1-87c81353ff8d` active at 100%; this still serves the prior interface. GitHub Pages was switched from `main:/docs` branch builds to GitHub Actions; its last published build remains PR #30. At the September 24, 22:24 UTC read-only check, both hosts returned identical 3,384,230-byte prior HTML with no frozen-release base. Both existing sites remain published while the packaged candidate awaits acceptance. This prevents an independent native build from exposing unpackaged files or racing release retention. The previous native configuration was repository `Jac1827/ATLAS`, branch `main`, root `/`, blank build command, deploy `npx wrangler deploy --keep-vars`, version `npx wrangler versions upload`, all nonproduction branches enabled, include `*`, no excludes/build variables, build cache disabled. Do not restore that configuration for the packaged client: native Workers Builds does not honor Wrangler custom build configuration. Any future second publisher requires its own explicit packaging and retention coordination.

Rollback republishes the chosen release's canonical entry points while retaining every previously published immutable tree. Reverting only JavaScript source or deploying an empty retention directory does not preserve old page behavior. Cloudflare and Pages must publish the same packaged output. The coordinated deployment workflow runs the complete discovered suite, verifies the scoped backend endpoint, retains the release using `tools/build-atlas-site.mjs`, and publishes the same artifact to Worker and Pages. The append-only `atlas-asset-releases` branch was bootstrapped with exact rollback source `3d80173de32f227410663662a523932c50ecaa2b`, release `92989f640671df582527300a54b79cc80d46f0c4300564528c333d72cdbae540`, retention commit `28e234256029f518bc2e39127af5e002754169cb`. Production activation and verification remain release tasks; local checks and retained branches are not evidence of deployed behavior.

Validation:

```sh
node tools/package-atlas-assets.test.mjs
```

The browser test verifies Worker and Pages path prefixes, CSS imports/images, eager and late module imports, classic and module workers, nested iframe paths, a late feature load from an old open page after a new package, exact retained bytes, tamper/overlap/symlink rejection, output preservation on failed builds, file limits and static-only cache headers. It uses the configured `ATLAS_PLAYWRIGHT` runtime or installed Playwright. A real current `docs` package was also generated locally; source asset hashes must be refreshed before final release packaging.
