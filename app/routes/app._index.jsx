import { json } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Button,
  Banner,
  BlockStack,
  Text,
  EmptyState
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // 1. Get publication channels
  const pubResponse = await admin.graphql(
    `#graphql
      query getPublications {
        publications(first: 5) {
          edges {
            node {
              id
              name
            }
          }
        }
      }`
  );
  const pubData = await pubResponse.json();
  const publications = pubData.data.publications.edges.map((edge) => edge.node);
  const targetPublication = publications[0];

  // 2. Get active products
  const prodResponse = await admin.graphql(
    `#graphql
      query getProducts {
        products(first: 50, query: "status:ACTIVE") {
          edges {
            node {
              id
              title
              status
              resourcePublicationsV2(first: 10) {
                edges {
                  node {
                    publication {
                      id
                      name
                    }
                    isPublished
                  }
                }
              }
            }
          }
        }
      }`
  );
  const prodData = await prodResponse.json();
  const rawProducts = prodData.data.products.edges.map((e) => e.node);

  // 3. Filter products that are active but not published to any channel
  const unlistedProducts = rawProducts.filter((p) => {
    const pubList = p.resourcePublicationsV2?.edges || [];
    const isAnyPublished = pubList.some((edge) => edge.node.isPublished);
    return !isAnyPublished;
  });

  return json({
    unlistedProducts,
    targetPublication,
    totalActive: rawProducts.length
  });
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const productIds = JSON.parse(formData.get("productIds") || "[]");
  const publicationId = formData.get("publicationId");

  if (!publicationId || productIds.length === 0) {
    return json({ success: false, message: "No target products." });
  }

  for (const pid of productIds) {
    await admin.graphql(
      `#graphql
        mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          id: pid,
          input: [{ publicationId }]
        }
      }
    );
  }

  return json({ success: true, count: productIds.length });
};

export default function Index() {
  const { unlistedProducts, targetPublication, totalActive } = useLoaderData();
  const fetcher = useFetcher();
  const isPublishing = fetcher.state !== "idle";

  const handleFixAll = () => {
    const ids = unlistedProducts.map((p) => p.id);
    fetcher.submit(
      {
        productIds: JSON.stringify(ids),
        publicationId: targetPublication.id
      },
      { method: "POST" }
    );
  };

  const rows = unlistedProducts.map((item) => [
    item.title,
    <Badge tone="success" key={item.id + "-status"}>Active</Badge>,
    <Badge tone="critical" key={item.id + "-ch"}>Unpublished (Lost Sales)</Badge>
  ]);

  return (
    <Page title="Product Channel Guard" subtitle="Monitor and protect sales channel visibility">
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner title="Fix Completed!" tone="success">
            <p>Published {fetcher.data.count} product(s) to &quot;{targetPublication?.name || "Online Store"}&quot;.</p>
          </Banner>
        )}

        {unlistedProducts.length > 0 ? (
          <Banner
            title={`Found ${unlistedProducts.length} active product(s) hidden from channels!`}
            tone="critical"
          >
            <p>
              These products are Active, but customers cannot purchase them because they are not published to the sales channel ({targetPublication?.name || "Online Store"}).
            </p>
            <div style={{ marginTop: "12px" }}>
              <Button
                variant="primary"
                tone="critical"
                loading={isPublishing}
                onClick={handleFixAll}
              >
                Publish All with One Click
              </Button>
            </div>
          </Banner>
        ) : (
          <Banner title="All products are properly published" tone="success">
            <p>No issues detected. Your sales channels are safe.</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Unpublished Products Detected ({unlistedProducts.length} / {totalActive})
                </Text>
                {unlistedProducts.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["Product Title", "Status", "Channel Status"]}
                    rows={rows}
                  />
                ) : (
                  <EmptyState
                    heading="No issues found"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>All active products are properly linked to your sales channel.</p>
                  </EmptyState>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
