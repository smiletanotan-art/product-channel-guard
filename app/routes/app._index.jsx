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

  // 1. 公開先チャネルの取得
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

  // 2. ステータスがACTIVEな商品を取得 (権限不要なフィールド構成に修正)
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

  // 3. アクティブなのにどのチャネルにも公開されていない商品を抽出
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
    return json({ success: false, message: "対象がありません。" });
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
    <Badge tone="success" key={item.id + "-status"}>アクティブ</Badge>,
    <Badge tone="critical" key={item.id + "-ch"}>未公開 (販売機会の損失)</Badge>
  ]);

  return (
    <Page title="Product Channel Guard" subtitle="販売機会の損失を防ぐ、チャネル公開監視ツール">
      <BlockStack gap="500">
        {fetcher.data?.success && (
          <Banner title="修復が完了しました！" tone="success">
            <p>{fetcher.data.count} 件の商品を「{targetPublication?.name || "ストア"}」に公開しました。</p>
          </Banner>
        )}

        {unlistedProducts.length > 0 ? (
          <Banner
            title={`アクティブなのに非公開の商品が ${unlistedProducts.length} 件見つかりました！`}
            tone="critical"
          >
            <p>
              商品は有効化されていますが、販売チャネル（{targetPublication?.name || "ストア"}）に紐付けられていないためお客様が購入できません。
            </p>
            <div style={{ marginTop: "12px" }}>
              <Button
                variant="primary"
                tone="critical"
                loading={isPublishing}
                onClick={handleFixAll}
              >
                ワンクリックですべて公開する
              </Button>
            </div>
          </Banner>
        ) : (
          <Banner title="すべての商品が正常に公開されています" tone="success">
            <p>現在、販売機会の損失は検出されていません。安全に稼働しています。</p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  検出された問題商品（{unlistedProducts.length} / {totalActive} 件）
                </Text>
                {unlistedProducts.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "text"]}
                    headings={["商品名", "商品ステータス", "チャネル状態"]}
                    rows={rows}
                  />
                ) : (
                  <EmptyState
                    heading="問題のある商品はありません"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>すべてのアクティブ商品が正しくストアへ連携されています。</p>
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