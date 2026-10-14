# App Pricing activation checklist

This branch is not deployed. Billing is disabled unless `SHOPIFY_APP_PRICING_ENABLED=true`.
Never enable Shopify App Pricing or merge/push main without the owner's final approval.

## Server-only configuration

- `SHOPIFY_APP_PRICING_ENABLED`: keep false until the dashboard switch and testing are approved.
- `SHOPIFY_APP_HANDLE`: product-channel-guard.
- `SHOPIFY_PARTNER_ORG_ID`: Partner Dashboard organization ID (not Dev Dashboard organization ID).
- `SHOPIFY_PARTNER_APP_ID`: the verified Partner API App GID.
- `SHOPIFY_PARTNER_ACCESS_TOKEN`: Partner API token with Manage apps; store only in the hosting secret manager.
- `BILLING_LEGACY_SHOPS`: comma-separated exact domains of the existing shops approved for permanent free access. Required before activation. Keep this list server-side, outside Git.
- `BILLING_PAID_PLAN_HANDLES`: premium-plan; add future paid plan handles only after review.

The legacy allowlist must be verified against the existing installation before activation. Never derive legacy status from an incoming query parameter or automatically add new shops. Listed shops retain free access after reinstallation and during billing outages.

## Dashboard plan

Draft: Premium Plan, premium-plan, USD 19.99 monthly, development-store testing free, redirect /app/billing. Trial is provisionally 0 days and requires confirmation before publication. The existing free plan must be restricted/removed from public availability for new shops as part of the approved activation, while preserving the legacy allowlist. Do not switch the dashboard while free-plan remains a public new-store option and the app denies free-plan access.

## Required verification before release

1. Use a genuine development store in the same Partner organization; the existing Basic store is not confirmed eligible for free billing testing.
2. Provide a separate test deployment, credentials and callback URLs. Render's production service tracks main automatically; PR previews are off.
3. Validate the Partner App GID, token permissions and real activeSubscription responses in that environment.
4. Test approve/decline/back/refresh, cancellation now and at cycle end, frozen/expired subscriptions, upgrades/downgrades and reinstall. Do not approve any charge that is not explicitly zero for testing.
5. Confirm session persistence. Current Prisma uses local SQLite and docker-start runs migration deploy; no database migration or initialization has been run during this work.
6. Build the Docker image with Node 22. Local tests use Node 24; they do not verify the Docker image.
7. Confirm the existing Admin API version separately. This change keeps authentication configuration intact; Partner API calls use 2026-10.
8. Complete the official app self-review and live app review checks.
9. Obtain approval for exact pricing/trial, dashboard enablement, main merge/push, production secrets and Render deployment. Recheck main HEAD before merging.

No Billing API charge creation or cancellation is implemented. Subscription state is fetched fresh, and callback plan_handle is never accepted as proof of payment. An unavailable API is shown as unknown, not canceled. New-shop feature loaders and publish actions both enforce access. Existing V2 detection/publication logic and authentication calls are retained.
