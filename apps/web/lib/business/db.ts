import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const businessTables = {
  audit: "business_audit_logs",
  identities: "payment_identities",
  invitations: "workspace_invitations",
  members: "workspace_members",
  payments: "business_payments",
  paymentApprovals: "payment_approvals",
  profiles: "business_profiles",
  requests: "business_payment_requests",
  settings: "workspace_settings",
  workspaces: "workspaces",
  userProfiles: process.env.SUPABASE_PROFILES_TABLE ?? "profiles",
} as const;

export function businessDb() {
  return createSupabaseAdminClient();
}

export function readBusinessDbError(
  error: { code?: string; message?: string } | null,
  fallback: string,
) {
  const message = error?.message ?? "";

  if (message.toLowerCase().includes("permission denied")) {
    return "Supabase rejected access to business tables. Run packages/database/supabase/business-workspaces.sql in your SQL editor.";
  }

  if (message.toLowerCase().includes("does not exist")) {
    return "Create the business tables with packages/database/supabase/business-workspaces.sql before using SaphraONE Business.";
  }

  if (error?.code === "23505") {
    if (message.toLowerCase().includes("username")) {
      return "That ONE ID is already taken.";
    }
    return "That record already exists.";
  }

  return message || fallback;
}
