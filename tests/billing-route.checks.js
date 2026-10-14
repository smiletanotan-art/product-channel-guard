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
    ? "export const authenticate = { admin: async () => { if (global.guardTestAuth instanceof Response) throw global.guardTestAuth; return global.guardTestAuth; } };"
    : "import React from 'react'; export const useLoaderData = () => global.guardBillingUIState; export const useActionData = () => global.guardBillingActionData; export const useNavigation = () => ({state:'idle'}); export const Form = ({children,...props}) => React.createElement('form', props, children);" }));
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

async function withBilling(contract, callback, { legacy = false, outage = false } = {}) {
  const fixtureEnv = { SHOPIFY_APP_PRICING_ENABLED: "true", BILLING_LEGACY_SHOPS: "existing-dummy.myshopify.com", SHOPIFY_APP_HANDLE: "product-channel-guard", SHOPIFY_PARTNER_ORG_ID: "123", SHOPIFY_PARTNER_APP_ID: "gid://shopify/App/456", SHOPIFY_PARTNER_ACCESS_TOKEN: "dummy-token" };
  const saved = Object.fromEntries(Object.keys(fixtureEnv).map((name) => [name, process.env[name]]));
  const oldFetch = global.fetch;
  const calls = [];
  Object.assign(process.env, fixtureEnv);
  global.fetch = async () => {
    if (outage) throw new Error("dummy outage");
    return new Response(JSON.stringify({ data: { activeSubscription: contract } }));
  };
  global.guardTestAuth = { session: { shop: legacy ? "existing-dummy.myshopify.com" : "new-dummy.myshopify.com" },
    admin: { graphql: async (query) => { assert.match(query, /shop \{ id \}/); return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/789" } } }) }; } },
    redirect: (url, options) => { calls.push({ url, options }); return new Response(null, { status: 302, headers: { Location: url } }); },
  };
  try { return await callback(calls); }
  finally { global.fetch = oldFetch; for (const name of Object.keys(fixtureEnv)) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } delete global.guardTestAuth; }
}
const paidContract = { items: [{ handle: "premium-plan", price: { active: false } }], cancelAtEndOfCycle: false, currentBillingCycle: { endTime: "2099-01-01T00:00:00Z" } };
const billingRequest = (method = "GET") => new Request("https://dummy.example/app/billing?host=dummy&plan_handle=premium-plan", { method });

test("forged approval callback cannot grant Premium", async () => {
  await withBilling(null, async (calls) => {
    const response = await route.loader({ request: billingRequest() });
    const state = await response.json();
    assert.equal(response.status, 200);
    assert.equal(state.status, "unsubscribed");
    assert.equal(state.entitled, false);
    assert.deepEqual(calls, []);
  });
});
test("approval callback rechecks the contract and shows active Premium", async () => {
  await withBilling(paidContract, async (calls) => {
    const state = await (await route.loader({ request: billingRequest() })).json();
    assert.equal(state.status, "premium");
    assert.equal(state.entitled, true);
    assert.deepEqual(calls, []);
  });
});
test("cancel/back/refresh stays on a successful billing page without loops", async () => {
  await withBilling(null, async (calls) => {
    for (let count = 0; count < 3; count++) {
      const response = await route.loader({ request: billingRequest() });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).entitled, false);
    }
    assert.deepEqual(calls, []);
  });
});
test("new-store plan selection exits the iframe to the fixed Shopify URL", async () => {
  await withBilling(null, async (calls) => {
    const response = await route.action({ request: billingRequest("POST") });
    assert.equal(response.status, 302);
    assert.deepEqual(calls, [{ url: "https://admin.shopify.com/store/new-dummy/charges/product-channel-guard/pricing_plans", options: { target: "_top" } }]);
  });
});
test("paid merchant can change plans without reinstalling", async () => {
  await withBilling(paidContract, async (calls) => {
    await route.action({ request: billingRequest("POST") });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.target, "_top");
  });
});
test("cancel-at-cycle-end and canceled contract produce distinct states", async () => {
  await withBilling({ ...paidContract, cancelAtEndOfCycle: true }, async () => {
    const state = await (await route.loader({ request: billingRequest() })).json();
    assert.equal(state.entitled, true);
    assert.equal(state.cancelAtEndOfCycle, true);
  });
  await withBilling(null, async () => {
    assert.equal((await (await route.loader({ request: billingRequest() })).json()).entitled, false);
  });
});
test("billing outage keeps access but disables new plan selection", async () => {
  await withBilling(null, async (calls) => {
    const state = await (await route.loader({ request: billingRequest() })).json();
    assert.equal(state.status, "unavailable");
    assert.equal(state.temporaryAccess, true);
    assert.equal(state.canChoosePlan, false);
    const response = await route.action({ request: billingRequest("POST") });
    assert.equal(response.status, 503);
    assert.deepEqual(calls, []);
    global.guardBillingActionData = await response.json();
    try { assert.match(render(state), /Plan selection is temporarily unavailable/); }
    finally { delete global.guardBillingActionData; }
  }, { outage: true });
});
test("legacy store remains free through reinstall and billing outage", async () => {
  await withBilling(null, async () => {
    const state = await (await route.loader({ request: billingRequest() })).json();
    assert.equal(state.status, "legacy");
    assert.equal(state.entitled, true);
  }, { legacy: true, outage: true });
});
test("billing route preserves authentication redirect", async () => {
  const expected = new Response(null, { status: 302, headers: { Location: "/auth/login" } });
  global.guardTestAuth = expected;
  try { await assert.rejects(() => route.loader({ request: billingRequest() }), (error) => error === expected); }
  finally { delete global.guardTestAuth; }
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
