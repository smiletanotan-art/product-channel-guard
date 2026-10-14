import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppProvider } from "@shopify/polaris";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const translations = require("@shopify/polaris/locales/en.json");

await mkdir(".cache", { recursive: true });
await build({ entryPoints: ["app/routes/app.billing.jsx"], outfile: ".cache/billing-route-test.mjs", bundle: true, platform: "node", format: "esm", packages: "external", plugins: [{ name: "dummy-billing-auth", setup(builder) {
  builder.onResolve({ filter: /shopify\.server$/ }, () => ({ path: "auth", namespace: "dummy" }));
  builder.onResolve({ filter: /^@remix-run\/react$/ }, () => ({ path: "hooks", namespace: "dummy" }));
  builder.onLoad({ filter: /.*/, namespace: "dummy" }, ({ path }) => ({ contents: path === "auth"
    ? "export const authenticate = { admin: async () => global.guardTestAuth };"
    : "import React from 'react'; export const useLoaderData = () => global.guardBillingUIState; export const useActionData = () => undefined; export const useNavigation = () => ({state:'idle'}); export const Form = ({children,...props}) => React.createElement('form', props, children);" }));
} }] });
const route = await import("../.cache/billing-route-test.mjs");

function render(state) {
  global.guardBillingUIState = state;
  try { return renderToStaticMarkup(React.createElement(AppProvider, { i18n: translations }, React.createElement(route.default))); }
  finally { delete global.guardBillingUIState; }
}
test("unsubscribed screen offers explicit Shopify selection without auto redirect", () => {
  const html = render({ status: "unsubscribed", entitled: false, canChoosePlan: true });
  assert.match(html, /Choose plan in Shopify/);
  assert.match(html, /Refresh subscription status/);
  assert.doesNotMatch(html, /Return to Product Channel Guard/);
});
test("approved and scheduled-cancellation screens retain access", () => {
  for (const cancelAtEndOfCycle of [false, true]) {
    const html = render({ status: "premium", entitled: true, canChoosePlan: true, cancelAtEndOfCycle });
    assert.match(html, /Premium access is active/);
    assert.match(html, /Return to Product Channel Guard/);
    if (cancelAtEndOfCycle) assert.match(html, /Cancellation is scheduled/);
  }
});
test("billing outage screen does not claim cancellation and keeps return path", () => {
  const html = render({ status: "unavailable", entitled: false, temporaryAccess: true, canChoosePlan: false });
  assert.match(html, /does not mean your subscription was canceled/);
  assert.match(html, /Return to Product Channel Guard/);
  assert.doesNotMatch(html, /Choose plan in Shopify/);
});
test("legacy store screen confirms free access without upgrade request", () => {
  const html = render({ status: "legacy", entitled: true, canChoosePlan: true });
  assert.match(html, /keeps free access/);
  assert.doesNotMatch(html, /Choose plan in Shopify|Manage plan in Shopify/);
});
test("disabled billing loader preserves authenticated access and does not redirect", async () => {
  const saved = process.env.SHOPIFY_APP_PRICING_ENABLED;
  process.env.SHOPIFY_APP_PRICING_ENABLED = "false";
  global.guardTestAuth = { session: { shop: "dummy.myshopify.com" } };
  try {
    const response = await route.loader({ request: new Request("https://dummy.example/app/billing?plan_handle=premium-plan") });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.deepEqual(await response.json(), { status: "disabled", entitled: true, canChoosePlan: false });
  } finally { if (saved === undefined) delete process.env.SHOPIFY_APP_PRICING_ENABLED; else process.env.SHOPIFY_APP_PRICING_ENABLED = saved; delete global.guardTestAuth; }
});
