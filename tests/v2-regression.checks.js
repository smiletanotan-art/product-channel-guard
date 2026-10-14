import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";

await mkdir(".cache", { recursive: true });
await build({ entryPoints: ["app/routes/app._index.jsx"], outfile: ".cache/v2-test.mjs", bundle: true, platform: "node", format: "esm", packages: "external", plugins: [{ name: "dummy-auth", setup(builder) {
  builder.onResolve({ filter: /shopify\.server$/ }, () => ({ path: "dummy-auth", namespace: "dummy" }));
  builder.onLoad({ filter: /.*/, namespace: "dummy" }, () => ({ contents: "export const authenticate = { admin: async () => { if (global.guardTestAuth instanceof Error) throw global.guardTestAuth; return global.guardTestAuth; } };" }));
} }] });
const route = await import("../.cache/v2-test.mjs");
const product = (id, tags, published = false) => ({ id, title: "Dummy product", status: "ACTIVE", tags, resourcePublicationsV2: { edges: [{ node: { isPublished: published } }] } });

test("V2 detects unpublished ACTIVE products and protects mixed-case tags", async () => {
  const oldFlag = process.env.SHOPIFY_APP_PRICING_ENABLED;
  process.env.SHOPIFY_APP_PRICING_ENABLED = "false";
  let authenticated = 0;
  global.guardTestAuth = { session: { shop: "dummy.myshopify.com" }, admin: { graphql: async (query) => {
    authenticated++;
    if (query.includes("getPublications")) return { json: async () => ({ data: { publications: { edges: [{ node: { id: "dummy-publication" } }] } } }) };
    assert.match(query, /status:ACTIVE/);
    return { json: async () => ({ data: { products: { edges: [product("visible", [], true), product("unpublished", []), product("preorder", ["preorder"]), product("wholesale", ["WhOlEsAlE"])].map((node) => ({ node })) } } }) };
  } } };
  try {
    const data = await (await route.loader({ request: new Request("https://dummy.example/app") })).json();
    assert.deepEqual(data.unlistedProducts.map((p) => p.id), ["unpublished"]);
    assert.deepEqual(data.excludedProducts.map((p) => p.id), ["preorder", "wholesale"]);
    assert.equal(authenticated, 2);
  } finally { if (oldFlag === undefined) delete process.env.SHOPIFY_APP_PRICING_ENABLED; else process.env.SHOPIFY_APP_PRICING_ENABLED = oldFlag; delete global.guardTestAuth; }
});

test("new unsubscribed shop cannot publish via direct POST", async () => {
  const names = ["SHOPIFY_APP_PRICING_ENABLED", "BILLING_LEGACY_SHOPS", "SHOPIFY_APP_HANDLE", "SHOPIFY_PARTNER_ORG_ID", "SHOPIFY_PARTNER_APP_ID", "SHOPIFY_PARTNER_ACCESS_TOKEN"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const oldFetch = global.fetch;
  Object.assign(process.env, { SHOPIFY_APP_PRICING_ENABLED: "true", BILLING_LEGACY_SHOPS: "legacy-dummy.myshopify.com", SHOPIFY_APP_HANDLE: "product-channel-guard", SHOPIFY_PARTNER_ORG_ID: "123", SHOPIFY_PARTNER_APP_ID: "gid://shopify/App/456", SHOPIFY_PARTNER_ACCESS_TOKEN: "dummy-token" });
  let mutations = 0;
  global.fetch = async () => new Response(JSON.stringify({ data: { activeSubscription: null } }));
  global.guardTestAuth = { session: { shop: "new-dummy.myshopify.com" }, redirect: (url) => new Response(null, { status: 302, headers: { Location: url } }), admin: { graphql: async (query) => {
    if (query.includes("mutation")) mutations++;
    return { json: async () => ({ data: { shop: { id: "gid://shopify/Shop/789" } } }) };
  } } };
  try {
    await assert.rejects(() => route.action({ request: new Request("https://dummy.example/app", { method: "POST", body: new FormData() }) }), (error) => error.status === 302 && error.headers.get("Location") === "/app/billing");
    assert.equal(mutations, 0);
  } finally { global.fetch = oldFetch; for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } delete global.guardTestAuth; }
});

test("authentication failure is preserved before product access", async () => {
  global.guardTestAuth = new Error("dummy authentication failure");
  try { await assert.rejects(() => route.loader({ request: new Request("https://dummy.example/app") }), /dummy authentication failure/); }
  finally { delete global.guardTestAuth; }
});
test("V2 bulk publishing retains publication variables", async () => {
  const oldFlag = process.env.SHOPIFY_APP_PRICING_ENABLED;
  process.env.SHOPIFY_APP_PRICING_ENABLED = "false";
  const calls = [];
  global.guardTestAuth = { admin: { graphql: async (query, options) => { assert.match(query, /publishablePublish/); calls.push(options.variables); } } };
  try {
    const form = new FormData(); form.set("productIds", JSON.stringify(["dummy-1", "dummy-2"])); form.set("publicationId", "dummy-channel");
    const data = await (await route.action({ request: new Request("https://dummy.example/app", { method: "POST", body: form }) })).json();
    assert.equal(data.count, 2);
    assert.deepEqual(calls, ["dummy-1", "dummy-2"].map((id) => ({ id, input: [{ publicationId: "dummy-channel" }] })));
  } finally { if (oldFlag === undefined) delete process.env.SHOPIFY_APP_PRICING_ENABLED; else process.env.SHOPIFY_APP_PRICING_ENABLED = oldFlag; delete global.guardTestAuth; }
});
