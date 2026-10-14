import test from "node:test";
import assert from "node:assert/strict";
import { pricingUrl, readBilling, requireEntitlement, subscriptionState } from "../app/billing.server.js";

const env = { SHOPIFY_APP_PRICING_ENABLED: "true", BILLING_LEGACY_SHOPS: "existing-dummy.myshopify.com", SHOPIFY_APP_HANDLE: "product-channel-guard", SHOPIFY_PARTNER_ORG_ID: "123", SHOPIFY_PARTNER_APP_ID: "gid://shopify/App/456", SHOPIFY_PARTNER_ACCESS_TOKEN: "dummy-token" };
const session = { shop: "new-dummy.myshopify.com" };
const admin = { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/789" } } }) }) };
const paid = { items: [{ handle: "premium-plan", price: { active: true } }], cancelAtEndOfCycle: false };
const response = (subscription) => async () => new Response(JSON.stringify({ data: { activeSubscription: subscription } }));

test("disabled billing preserves existing access without network", async () => {
  assert.deepEqual(await readBilling(null, session, { env: {} }), { status: "disabled", entitled: true });
});
test("legacy shop keeps access during billing outage", async () => {
  assert.equal((await readBilling(null, { shop: "existing-dummy.myshopify.com" }, { env })).status, "legacy");
});
test("new shops require an active paid plan", async () => {
  assert.equal((await readBilling(admin, session, { env, fetchImpl: response(null) })).entitled, false);
  assert.equal((await readBilling(admin, session, { env, fetchImpl: response(paid) })).status, "premium");
});
test("free, inactive and unknown plans do not grant Premium", () => {
  for (const item of [{ handle: "free-plan", price: { active: true } }, { handle: "premium-plan", price: { active: false } }, { handle: "unknown", price: { active: true } }]) {
    assert.equal(subscriptionState({ items: [item] }, env).entitled, false);
  }
});
test("scheduled cancellation retains active access, expiry removes it", () => {
  assert.equal(subscriptionState({ ...paid, cancelAtEndOfCycle: true }, env).entitled, true);
  assert.equal(subscriptionState(null, env).entitled, false);
});
test("additional paid plan handles support future changes", () => {
  assert.equal(subscriptionState({ items: [{ handle: "future-plan", price: { active: true } }] }, { BILLING_PAID_PLAN_HANDLES: "premium-plan,future-plan" }).entitled, true);
});
test("billing failures and malformed responses remain unknown", async () => {
  for (const fetchImpl of [async () => { throw new Error("dummy private error"); }, async () => new Response("", { status: 429 }), async () => new Response(JSON.stringify({ errors: [{ message: "dummy" }] })), async () => new Response(JSON.stringify({ data: {} })), response({})]) {
    assert.deepEqual(await readBilling(admin, session, { env, fetchImpl }), { status: "unavailable", entitled: false });
  }
});
test("missing configuration never grants new-store access", async () => {
  assert.equal((await readBilling(admin, session, { env: { ...env, SHOPIFY_PARTNER_ACCESS_TOKEN: "" } })).status, "unavailable");
});
test("Partner query uses authenticated shop ID, not callback plan_handle", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, "https://partners.shopify.com/123/api/2026-10/graphql.json");
    assert.equal(options.redirect, "error");
    assert.deepEqual(JSON.parse(options.body).variables, { appId: "gid://shopify/App/456", shopId: "gid://shopify/Shop/789" });
    return response(paid)();
  };
  assert.equal((await readBilling(admin, session, { env, fetchImpl })).entitled, true);
});
test("Shopify pricing URLs reject arbitrary domains", () => {
  assert.equal(pricingUrl(session.shop, env), "https://admin.shopify.com/store/new-dummy/charges/product-channel-guard/pricing_plans");
  assert.equal(pricingUrl("attacker.example", env), null);
});
test("unsubscribed requests redirect once to accessible billing route", async () => {
  let redirectTarget;
  const auth = { admin, session, redirect: (url) => { redirectTarget = url; return new Response(null, { status: 302, headers: { Location: url } }); } };
  await assert.rejects(() => requireEntitlement(new Request("https://dummy.example/app?host=dummy&plan_handle=premium-plan"), auth, { env, fetchImpl: response(null) }), (error) => error.status === 302);
  assert.equal(redirectTarget, "/app/billing?host=dummy");
});
test("reinstallation is checked again; approval is never inferred", async () => {
  assert.equal((await readBilling(admin, session, { env, fetchImpl: response(paid) })).entitled, true);
  assert.equal((await readBilling(admin, session, { env, fetchImpl: response(null) })).entitled, false);
});
