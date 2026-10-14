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

After valid billing configuration is present, API/network/invalid-response failures grant temporary feature access to authenticated merchants, with a verification-pending banner. They are never marked paid or unsubscribed from an error. This protects legitimate users during outages but also allows new stores temporary access during the same outage. Every subsequent request retries verification; normal successful null/free responses still deny new-store access. Missing required configuration does not grant this temporary access. Monitor billing availability before enabling pricing.

Live verification: the Partner API client was created in organization 5162757 with Manage apps only. Its GraphiQL Explorer on 2026-10 successfully resolved the app and the exact activeSubscription selection in billing.server.js; the current development store returned null. The app query uses gid://partners/App/... while activeSubscription uses the documented gid://shopify/App/.... The token was not displayed, copied or saved locally. The development store's type and organization were verified in Dev Dashboard; Basic is its Shopify plan, not evidence of a production store.

After the owner approved the explicitly no-charge test contract and its terms, the development store subscribed to Premium. The live query returned EVERY_30_DAYS, premium-plan, and a current billing cycle. Price.active was false: official Price documentation says this is the catalog price's active status (false after price changes), not the subscription's status. Entitlement therefore checks the current activeSubscription and allowed plan handle, never Price.active. The approval redirect reached /app/billing with plan_handle=premium-plan. Production has not received the new route, so this is not a completed test of the new app's return screen.

The test contract's FlatRatePrice amount was verified as 0.0 USD through the live Partner API. No actual charges were approved. This contract is limited to the existing development store; the existing store's permanent-free access exception still applies in the planned rollout.

Docker/Podman and WSL are unavailable on this PC. billing-validation.yml prepares a Docker build and dummy-data tests on GitHub Actions, exclusively for codex/premium-app-pricing. It does not deploy or start the app, push an image, initialize a database, or use Shopify secrets. The workflow is not uploaded/executed yet: a dry-run branch push failed because Git has no authenticated session, even though the Chrome GitHub session is logged in. Git authentication must be connected before uploading the development branch and running Docker validation.
