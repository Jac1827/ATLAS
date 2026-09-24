# Deliberate client recovery

Normal production deployments require the repository variable
`ATLAS_SCOPED_WORKSPACE_READY` to equal `true`. An unset or different value blocks
both main-push activation and a manual current-client deployment. Set it only
after the authorized startup projection has been published, its exact source and
hash read back, and authenticated acceptance completed. The anonymous backend
probe establishes endpoint availability; it does not establish projection data
readiness. This variable is a release gate, not a secret or an access grant.

Recovery uses the existing **Deploy Cloudflare Worker** workflow, with target
`production`, and both explicit inputs:

| Input | Reviewed September 24 recovery value |
| --- | --- |
| `client_rollback_ref` | `3d80173de32f227410663662a523932c50ecaa2b` |
| `client_rollback_release` | `92989f640671df582527300a54b79cc80d46f0c4300564528c333d72cdbae540` |

That deliberate pair can enter production while the readiness variable is
closed. Branch names, abbreviated commits, missing hashes, malformed pairs and
content/hash mismatches fail before deployment. A future reviewed stable client
may use a different full commit and independently established release hash;
selecting either is an explicit release decision. Never guess the expected hash
from an unreviewed current build merely to pass the check.

The recovery command archives only `docs` from the selected commit. It uses the
current packager, current Worker, current bindings and existing `--keep-vars`
behavior. It does not execute or revert database migrations, modify operational
records, publish a startup projection, or alter employee/financial/access data.
All retained release trees are hash-verified and remain available, including:

- prior client `92989f640671df582527300a54b79cc80d46f0c4300564528c333d72cdbae540`;
- activated candidate `75f860f6da674427159a5ba8c5c2ecb0d7e208c49a35d168dcd16877dcf6a370`;
- any additional releases present at packaging time.

The artifact is built once. An ignored generated Wrangler config removes only
the custom-build hook and resolves its existing local paths, so Worker upload
cannot rebuild current `docs` over the selected client. The same artifact is
verified again before Pages upload. Both hosts use the existing serialized
`atlas-production-publisher` group. Hosting activation is sequential, not an
atomic cross-provider transaction; inspect both deployment results and compare
their canonical asset manifest if either step fails.

The full discovered current-checkout CI suite and anonymous backend compatibility
probe remain required for recovery. The added credential-free recovery test
packages the actual prior commit against the two retained incident trees in a
temporary local clone, verifies exact release content, rejected hash mismatches,
tampering, idempotent retention, current Worker/config preservation and return to
normal build selection. These are packaging checks. The prior 137 client checks
were run separately before this incident; current-checkout CI does not retest the
old browser runtime.

The receipt is uploaded as `client-rollback-evidence`. Verify the selected release
and both retained namespaces on Worker and Pages after activation. Leave both
manual inputs empty on a future normal release; rollback selection is never
saved in the repository, a secret, or a persistent environment variable.

Preparation alone does not deploy. The CLI defaults to preview, while the
production workflow sets publish mode explicitly. Keep normal deployment closed
until the projection prerequisite is proven; merging this recovery support must
not activate the unready current client.
