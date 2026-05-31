import Stripe from "stripe";

type CheckoutOrder = {
  id?: string;
  orderNumber: string;
  brandName: string;
  distributorName: string;
  outstandingAmount: number;
};

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient) {
    stripeClient = new Stripe(key, {
      appInfo: {
        name: "Distributor OS",
        version: "0.1.0",
      },
    });
  }
  return stripeClient;
}

export async function createOrderCheckoutSession({
  order,
  token,
  appUrl,
}: {
  order: CheckoutOrder;
  token: string;
  appUrl: string;
}) {
  const stripe = getStripeClient();
  if (!stripe) return null;

  const amountInCents = Math.max(50, Math.round(order.outstandingAmount * 100));
  const baseUrl = appUrl.replace(/\/+$/, "");
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: order.id || token,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amountInCents,
          product_data: {
            name: `${order.orderNumber} payment`,
            description: `${order.distributorName} payment to ${order.brandName}`,
          },
        },
      },
    ],
    metadata: {
      order_id: order.id || "",
      order_number: order.orderNumber,
      order_token: token,
      distributor_name: order.distributorName,
    },
    success_url: `${baseUrl}/order/${token}?payment=success`,
    cancel_url: `${baseUrl}/order/${token}?payment=cancelled`,
  });

  return {
    id: session.id,
    url: session.url,
  };
}
