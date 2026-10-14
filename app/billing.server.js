// Shopify App Pricing: no charge creation or subscription cancellation here.
export const ACTIVE_SUBSCRIPTION_QUERY = `query GuardActiveSubscription($appId: ID!, $shopId: ID!) {
  activeSubscription(appId: $appId, shopId: $shopId) {
    billingPeriod
    cancelAtEndOfCycle
    currentBillingCycle { endTime }
    items { handle }
  }
}`;

export function pricingEnabled(env = process.env) {
  return env.SHOPIFY_APP_PRICING_ENABLED === "true";
}

export function legacyShop(shop, env = process.env) {
  return (env.BILLING_LEGACY_SHOPS || "").split(",")
    .map((value) => value.trim().toLowerCase()).includes(shop.toLowerCase());
}

export function pricingUrl(shop, env = process.env) {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop)) return null;
  const handle = env.SHOPIFY_APP_HANDLE;
  if (!handle || !/^[a-z0-9-]+$/.test(handle)) return null;
  return `https://admin.shopify.com/store/${shop.split(".")[0]}/charges/${handle}/pricing_plans`;
}

export function subscriptionState(subscription, env = process.env) {
  if (subscription === null) return { status: "unsubscribed", entitled: false };
  const handles = (env.BILLING_PAID_PLAN_HANDLES || "premium-plan").split(",").map((v) => v.trim());
  // Price.active describes the price's catalog status, not the contract.
  // Grandfathered and no-charge test prices can be inactive on a valid contract.
  const entitled = subscription?.items?.some((item) => handles.includes(item.handle));
  return {
    status: entitled ? "premium" : "unsubscribed",
    entitled: Boolean(entitled),
    cancelAtEndOfCycle: subscription?.cancelAtEndOfCycle === true,
    endsAt: subscription?.currentBillingCycle?.endTime || null,
  };
}

export async function readBilling(admin, session, { env = process.env, fetchImpl = fetch } = {}) {
  if (!pricingEnabled(env)) return { status: "disabled", entitled: true };
  // Existing users keep access, even if the billing service is unavailable.
  if (legacyShop(session.shop, env)) return { status: "legacy", entitled: true };
  const unavailable = { status: "unavailable", entitled: false };
  // A configured billing service outage must not stop authenticated merchants.
  // Temporary access is distinct from a verified paid entitlement.
  const temporaryAccess = { ...unavailable, temporaryAccess: true };
  if (!/^\d+$/.test(env.SHOPIFY_PARTNER_ORG_ID || "") ||
      !/^gid:\/\/shopify\/App\/\d+$/.test(env.SHOPIFY_PARTNER_APP_ID || "") ||
      !env.SHOPIFY_PARTNER_ACCESS_TOKEN || !env.BILLING_LEGACY_SHOPS || !pricingUrl(session.shop, env)) {
    return unavailable;
  }
  try {
    // Fetch only the authenticated shop's ID; never products, orders or customers.
    const shopResponse = await admin.graphql("query GuardBillingShop { shop { id } }");
    const shopData = await shopResponse.json();
    const shopId = shopData.data?.shop?.id;
    if (shopData.errors || !/^gid:\/\/shopify\/Shop\/\d+$/.test(shopId || "")) return temporaryAccess;
    const response = await fetchImpl(
      `https://partners.shopify.com/${env.SHOPIFY_PARTNER_ORG_ID}/api/2026-10/graphql.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_PARTNER_ACCESS_TOKEN },
        body: JSON.stringify({ query: ACTIVE_SUBSCRIPTION_QUERY, variables: { appId: env.SHOPIFY_PARTNER_APP_ID, shopId } }),
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    if (!response.ok) return temporaryAccess;
    const body = await response.json();
    if (body.errors || !body.data || !Object.hasOwn(body.data, "activeSubscription")) return temporaryAccess;
    const subscription = body.data.activeSubscription;
    if (subscription !== null && !Array.isArray(subscription?.items)) return temporaryAccess;
    return subscriptionState(subscription, env);
  } catch {
    // Never send raw API errors, tokens or merchant data to logs/browser.
    return temporaryAccess;
  }
}

export async function requireEntitlement(request, auth, options) {
  if (!pricingEnabled(options?.env)) return;
  const state = await readBilling(auth.admin, auth.session, options);
  if (state.entitled || state.temporaryAccess) return state;
  const url = new URL(request.url);
  url.pathname = "/app/billing";
  url.searchParams.delete("plan_handle");
  // The billing route never calls this guard, so cancel/back cannot loop.
  throw auth.redirect(`${url.pathname}${url.search}`);
}
