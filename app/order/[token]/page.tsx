import OrderReviewClient from "./OrderReviewClient";

export default async function SharedOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <OrderReviewClient token={token} />;
}
