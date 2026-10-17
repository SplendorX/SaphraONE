import type { Metadata } from "next";

import { PayChargePage } from "@/components/checkout/pay-charge-page";

// A buyer's checkout for one order: never in search results.
export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Checkout",
};

type CheckoutPageProps = { params: Promise<{ sessionId: string }> };

/**
 * The hosted checkout a website sends its buyer to (cs_live_… / cs_test_…).
 * The public payer routes take the session id in place of a charge code.
 */
export default async function HostedCheckoutPage({ params }: CheckoutPageProps) {
  const { sessionId } = await params;
  return <PayChargePage code={decodeURIComponent(sessionId).trim().toLowerCase()} />;
}
