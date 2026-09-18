import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { Page, Layout, Card, DataTable, Badge, Button, Banner, BlockStack, Text, EmptyState, List } from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const pubResponse = await admin.graphql(`query getPublications { publications(first: 5) { edges { node { id name } } } }`);
  const pubData = await pubResponse.json();
  const targetPublication = pubData.data.publications.edges[0]?.node;

  const prodResponse = await admin.graphql(`
    query getProducts {
      products(first: 50, query: "status:ACTIVE") {
        edges { node { id title status tags resourcePublicationsV2(first: 10) { edges { node { isPublished } } } } }
      }
    }
  `);
  const prodData = await prodResponse.json();
  const rawProducts = prodData.data.products.edges.map(e => e.node);
  const unlistedProducts = [];
  const excludedProducts = [];
  const EXCLUDED_TAGS = ["PREORDER", "WHOLESALE"];

  rawProducts.forEach(p => {
    const isAnyPublished = p.resourcePublicationsV2?.edges?.some(e => e.node.isPublished) || false;
    if (!isAnyPublished) {
      if (p.tags.some(tag => EXCLUDED_TAGS.includes(tag.toUpperCase()))) { excludedProducts.push(p); } 
      else { unlistedProducts.push(p); }
    }
  });
  return json({ unlistedProducts, excludedProducts, targetPublication });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const productIds = JSON.parse(formData.get("productIds") || "[]");
  const publicationId = formData.get("publicationId");
  if (!publicationId || productIds.length === 0) return json({ success: false });
  for (const pid of productIds) {
    await admin.graphql(`mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { message } } }`, 
    { variables: { id: pid, input: [{ publicationId }] } });
  }
  return json({ success: true, count: productIds.length });
};

export default function Index() {
  const { unlistedProducts, excludedProducts, targetPublication } = useLoaderData();
  const fetcher = useFetcher();
  const isPublishing = fetcher.state !== "idle";
  const handleFixAll = () => {
    fetcher.submit({ productIds: JSON.stringify(unlistedProducts.map(p => p.id)), publicationId: targetPublication.id }, { method: "POST" });
  };
  const rows = unlistedProducts.map(item => [ item.title, <Badge tone="success" key={item.id}>Active</Badge>, <Badge tone="critical" key={item.id+"-ch"}>Unpublished</Badge> ]);
  const excludedRows = excludedProducts.map(item => [ item.title, item.tags.join(", "), <Badge tone="info" key={item.id}>Protected</Badge> ]);

  return (
    <Page title="Product Channel Guard (V2)" subtitle="Monitor and protect sales channel visibility with smart rules">
      <BlockStack gap="500">
        <Card>
          <BlockStack gap="300">
            <Text variant="headingMd" as="h2">🛡️ Active Protection Rules</Text>
            <Text as="p">Tags excluded from forced publishing:</Text>
            <List><List.Item><b>PREORDER</b></List.Item><List.Item><b>WHOLESALE</b></List.Item></List>
          </BlockStack>
        </Card>
        {fetcher.data?.success && <Banner title="Fix Completed!" tone="success"><p>Published {fetcher.data.count} product(s).</p></Banner>}
        {unlistedProducts.length > 0 ? (
          <Banner title={`Found ${unlistedProducts.length} hidden product(s)!`} tone="critical">
            <Button variant="primary" tone="critical" loading={isPublishing} onClick={handleFixAll}>Publish All</Button>
          </Banner>
        ) : <Banner title="All standard products are properly published" tone="success"><p>No lost sales detected.</p></Banner>}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Unpublished Products Detected ({unlistedProducts.length})</Text>
                {unlistedProducts.length > 0 ? <DataTable columnContentTypes={["text", "text", "text"]} headings={["Title", "Status", "Channel Status"]} rows={rows} /> : <EmptyState heading="No issues found" image=""><p>All active products are properly linked.</p></EmptyState>}
              </BlockStack>
            </Card>
          </Layout.Section>
          {excludedProducts.length > 0 && (
            <Layout.Section><Card><BlockStack gap="400"><Text variant="headingMd" as="h2">🔒 Protected Products ({excludedProducts.length})</Text><DataTable columnContentTypes={["text", "text", "text"]} headings={["Title", "Tags", "Status"]} rows={excludedRows} /></BlockStack></Card></Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}