import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Page, Card, BlockStack, Text, Banner, Button } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { pricingEnabled, pricingUrl, readBilling } from "../billing.server";

export const loader = async ({ request }) => {
  const auth = await authenticate.admin(request);
  const state = await readBilling(auth.admin, auth.session);
  return json({ ...state, canChoosePlan: pricingEnabled() && Boolean(pricingUrl(auth.session.shop)) && state.status !== "unavailable" },
    { headers: { "Cache-Control": "private, no-store" } });
};

export const action = async ({ request }) => {
  const auth = await authenticate.admin(request);
  const state = await readBilling(auth.admin, auth.session);
  const url = pricingUrl(auth.session.shop);
  if (!pricingEnabled() || !url || state.status === "unavailable") {
    return json({ error: "Plan selection is temporarily unavailable. Please try again later." }, { status: 503 });
  }
  return auth.redirect(url, { target: "_top" });
};

export default function BillingPage() {
  const state = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  return (
    <Page title="Subscription">
      <Card><BlockStack gap="400">
        <Text as="h2" variant="headingMd">Premium Plan — $19.99 USD per month</Text>
        <Text as="p">Includes product detection, protected tag exclusions and bulk publishing. Shopify shows the terms and asks you to approve the subscription before charging you.</Text>
        {actionData?.error && <Banner tone="warning"><p>{actionData.error}</p></Banner>}
        {state.status === "disabled" && <Banner><p>Paid subscriptions are not enabled yet. Your current access continues.</p></Banner>}
        {state.status === "legacy" && <Banner tone="success"><p>Your existing store keeps free access. No subscription is required.</p></Banner>}
        {state.status === "premium" && <Banner tone="success"><p>Premium access is active.{state.cancelAtEndOfCycle ? " Cancellation is scheduled; access continues until the current subscription ends." : ""}</p></Banner>}
        {state.status === "unsubscribed" && <Banner><p>A Premium subscription is required for new stores. If you just approved a plan, refresh to check again. Declining or leaving plan selection does not grant paid access.</p></Banner>}
        {state.status === "unavailable" && <Banner tone="warning"><p>We could not verify your subscription. Please try again later. This does not mean your subscription was canceled.</p></Banner>}
        {state.canChoosePlan && state.status !== "legacy" && <Form method="post"><Button submit variant="primary" loading={navigation.state !== "idle"}>{state.entitled ? "Manage plan in Shopify" : "Choose plan in Shopify"}</Button></Form>}
        <Button url="/app/billing">Refresh subscription status</Button>
        {state.entitled && <Button url="/app">Return to Product Channel Guard</Button>}
      </BlockStack></Card>
    </Page>
  );
}
