import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { readBusinessDbError } from "@/lib/business/db";

export const accountTables = {
  history: "account_type_history",
  invoices: "business_invoices",
  invoiceItems: "business_invoice_items",
  invoicePayments: "business_invoice_payments",
  profiles: process.env.SUPABASE_PROFILES_TABLE ?? "profiles",
  businessProfiles: "business_account_profiles",
  charges: "business_charges",
  chargePayments: "business_charge_payments",
  checkoutCursors: "business_checkout_scan_cursors",
  chargeRefunds: "business_charge_refunds",
  checkoutSessions: "checkout_sessions",
  merchantApiKeys: "merchant_api_keys",
  webhookEndpoints: "merchant_webhook_endpoints",
  webhookEvents: "merchant_webhook_events",
  webhookDeliveries: "merchant_webhook_deliveries",
} as const;

export function accountDb() {
  return createSupabaseAdminClient();
}

export function readAccountDbError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  const message = error?.message ?? "";
  if (message.toLowerCase().includes("does not exist")) {
    if (
      message.includes("merchant_") ||
      message.includes("checkout_sessions") ||
      message.includes("business_charge_refunds") ||
      message.includes("amount_refunded")
    ) {
      return "Run packages/database/supabase/merchant-api.sql in the Supabase SQL editor.";
    }
    if (message.includes("business_charge") || message.includes("business_checkout")) {
      return "Run packages/database/supabase/business-checkout.sql in the Supabase SQL editor.";
    }
    return "Run packages/database/supabase/account-business.sql in the Supabase SQL editor.";
  }
  return readBusinessDbError(error, fallback);
}
