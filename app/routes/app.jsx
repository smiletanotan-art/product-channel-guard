import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { Banner } from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import { authenticate } from "../shopify.server";
import { pricingEnabled, requireEntitlement } from "../billing.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const auth = await authenticate.admin(request);
  let billingState;
  if (new URL(request.url).pathname !== "/app/billing") {
    billingState = await requireEntitlement(request, auth);
  }
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "", showBilling: pricingEnabled(), billingPending: billingState?.temporaryAccess === true },
    { headers: { "Cache-Control": "private, no-store" } });
};

export default function App() {
  const { apiKey, showBilling, billingPending } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Home</Link>
        <Link to="/app/additional">Additional page</Link>
        {showBilling && <Link to="/app/billing">Subscription</Link>}
      </NavMenu>
      {billingPending && <Banner tone="warning"><p>Subscription verification is temporarily unavailable. Your access continues while verification is pending.</p></Banner>}
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
