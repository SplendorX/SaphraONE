// Server-only. ALLIE's answers and hand-offs for the Business products:
// Payroll and the invoices a business issues.
//
// Nothing here moves money or changes a record. Reads answer from the
// business's own data; everything else opens the product page with the
// details filled in, because payroll runs need a workspace approver and
// invoices are reviewed before they go to a customer.
import { loadBusinessAccount } from "@/lib/account/auth";
import { accountDb, accountTables } from "@/lib/account/db";
import { moneyNumber } from "@/lib/account/money";
import {
  formatInvoiceMoney,
  remainingInvoiceBalance,
} from "@/lib/account/invoice-preview";
import type { BusinessAsset, InvoiceRecord } from "@/lib/account/types";
import { getPayrollDashboardSummary } from "@/lib/payroll/dashboard-service";
import { payrollDb, payrollTables } from "@/lib/payroll/db";
import type {
  PayrollGroupRecord,
  PayrollRunRecord,
  PayrollScheduleRecord,
  TeamMemberRecord,
} from "@/lib/payroll/types";

import type { AllieAction } from "@/lib/allie/actions";
import type { AllieOutcome, AllieOutcomeRow } from "@/lib/allie/capabilities";

type PayrollAction = Extract<AllieAction, { type: "Payroll" }>;
type InvoiceStatusAction = Extract<AllieAction, { type: "InvoiceStatus" }>;
type CreateInvoiceAction = Extract<AllieAction, { type: "CreateInvoice" }>;
type InvoiceActionAction = Extract<AllieAction, { type: "InvoiceAction" }>;

/** Most rows a chat panel lists before pointing at the full page. */
const maxRows = 6;

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : "";
}

/** "2026-10-01T09:00:00Z" → "Oct 1". Dates only; payroll is day-grained. */
function shortDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Number(match[2]) - 1
  ];
  return `${month} ${Number(match[3])}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function asset(value: string | null | undefined): BusinessAsset {
  return value === "EURC" ? "EURC" : "USDC";
}

function plural(count: number, word: string) {
  if (word === "person") return count === 1 ? "1 person" : `${count} people`;
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const businessOnly = (title: string): AllieOutcome => ({
  kind: "panel",
  title,
  summary: `${title} is part of SaphraONE Business. Switch this account to Business to use it.`,
  rows: [],
  cta: "Upgrade to Business",
  href: "/settings#account-type",
});

async function businessWallet(ownerWallet: string) {
  try {
    const business = await loadBusinessAccount(ownerWallet);
    return business ? business.businessWallet || business.actorWallet : null;
  } catch {
    return null;
  }
}

// ─── Payroll ─────────────────────────────────────────────────────────────────

const frequencyLabel: Record<string, string> = {
  WEEKLY: "weekly",
  BIWEEKLY: "every 2 weeks",
  MONTHLY: "monthly",
  MANUAL: "per run",
};

const runStatusLabel: Record<string, string> = {
  DRAFT: "draft",
  READY: "awaiting approval",
  APPROVED: "approved",
  PROCESSING: "paying out",
  COMPLETED: "paid",
  PARTIALLY_COMPLETED: "partly paid",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const awaitingApproval = ["DRAFT", "READY"];
const needsAttention = ["FAILED", "PARTIALLY_COMPLETED"];

function runAmount(run: Pick<PayrollRunRecord, "total_amount" | "asset">) {
  return formatInvoiceMoney(run.total_amount || "0", asset(run.asset));
}

async function loadRuns(account: string, statuses: string[]) {
  const { data } = await payrollDb()
    .from(payrollTables.runs)
    .select("*")
    .eq("account_id", account)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(maxRows);
  return (data ?? []) as PayrollRunRecord[];
}

async function payrollOverview(account: string): Promise<AllieOutcome> {
  const summary = await getPayrollDashboardSummary(account);
  const pending = summary.recentRuns.filter((run) => awaitingApproval.includes(run.status));
  const failed = summary.recentRuns.filter((run) => needsAttention.includes(run.status));
  const upcoming = summary.upcomingRun;

  const rows: AllieOutcomeRow[] = [
    { label: "Active team", value: plural(summary.activeTeamMembersCount, "person") },
    {
      label: "Next payroll",
      value: summary.nextPayrollDate
        ? `${shortDate(summary.nextPayrollDate)}${
            upcoming ? ` · ${runAmount(upcoming)} · ${runStatusLabel[upcoming.status] ?? upcoming.status}` : ""
          }`
        : "Nothing scheduled",
    },
    {
      label: "Last payroll",
      value: summary.lastPayrollDate
        ? `${shortDate(summary.lastPayrollDate)} · ${formatInvoiceMoney(summary.lastPayrollAmount ?? "0", "USDC")} · ${
            runStatusLabel[summary.lastPayrollStatus ?? ""] ?? summary.lastPayrollStatus
          }`
        : "None yet",
    },
  ];

  if (pending.length > 0) {
    rows.push({
      label: "Awaiting approval",
      value: pending.map((run) => `${run.name} (${runAmount(run)})`).join(", "),
    });
  }

  if (failed.length > 0) {
    rows.push({
      label: "Needs attention",
      value: failed.map((run) => `${run.name} — ${runStatusLabel[run.status]}`).join(", "),
    });
  }

  // Point at whatever most needs the owner: an approval, a failure, or the hub.
  const focus = pending[0] ?? failed[0];

  return {
    kind: "panel",
    title: "Payroll",
    summary:
      pending.length > 0
        ? `${plural(pending.length, "run")} waiting for your approval.`
        : failed.length > 0
          ? `${plural(failed.length, "run")} didn't fully pay out.`
          : summary.activeTeamMembersCount === 0
            ? "No one is on payroll yet — add your team to get started."
            : "Everything is up to date.",
    rows,
    cta: focus ? "Open the run" : "Open Payroll",
    href: focus ? `/business/payroll/runs/${focus.id}` : "/business/payroll",
  };
}

async function payrollTeam(account: string, action: PayrollAction): Promise<AllieOutcome> {
  let request = payrollDb()
    .from(payrollTables.teamMembers)
    .select("*", { count: "exact" })
    .eq("account_id", account)
    .eq("status", "ACTIVE")
    .order("full_name", { ascending: true })
    .limit(maxRows);
  if (action.memberType) request = request.eq("member_type", action.memberType);

  const { data, count } = await request;
  const members = (data ?? []) as TeamMemberRecord[];
  const total = count ?? members.length;
  const who =
    action.memberType === "CONTRACTOR"
      ? "contractor"
      : action.memberType === "EMPLOYEE"
        ? "employee"
        : "person";

  return {
    kind: "panel",
    title: action.memberType === "CONTRACTOR" ? "Contractors" : "Your team",
    summary:
      total === 0
        ? `No active ${who === "person" ? "team members" : `${who}s`} on payroll.`
        : `${plural(total, who)} on payroll${
            total > members.length ? ` — showing ${members.length}` : ""
          }.`,
    rows: members.map((member) => ({
      label: `${member.full_name}${member.role ? ` · ${member.role}` : ""}`,
      value:
        member.payment_frequency === "MANUAL" || moneyNumber(member.default_payment_amount) === 0
          ? "Set per run"
          : `${formatInvoiceMoney(member.default_payment_amount, asset(member.preferred_asset))} ${
              frequencyLabel[member.payment_frequency]
            }`,
    })),
    cta: total === 0 ? "Add a team member" : "Manage team",
    href: total === 0 ? "/business/payroll/team?add=1" : "/business/payroll/team",
  };
}

function addMember(action: PayrollAction): AllieOutcome {
  const recipient = action.recipient?.trim();
  const isWallet = recipient ? /^0x[a-fA-F0-9]{40}$/.test(recipient) : false;
  const username = recipient && !isWallet ? recipient.replace(/^@/, "").replace(/\.one$/i, "") : undefined;
  const frequency = action.frequency?.toUpperCase();

  return {
    kind: "prepare",
    title: action.memberType === "CONTRACTOR" ? "Add a contractor" : "Add a team member",
    summary: "I've filled in what you told me — check it and finish on the Team page.",
    rows: [
      ...(action.name ? [{ label: "Name", value: action.name }] : []),
      ...(action.role ? [{ label: "Role", value: action.role }] : []),
      { label: "Type", value: action.memberType === "CONTRACTOR" ? "Contractor" : "Employee" },
      ...(recipient
        ? [{ label: "Paid to", value: isWallet ? `${recipient.slice(0, 6)}…${recipient.slice(-4)}` : `${username}.one` }]
        : []),
      ...(action.amountUsdc
        ? [
            {
              label: "Pay",
              value: `${action.amountUsdc} USDC${action.frequency ? ` ${frequencyLabel[frequency ?? ""]}` : ""}`,
            },
          ]
        : []),
    ],
    href: `/business/payroll/team${query({
      add: 1,
      amount: action.amountUsdc,
      frequency,
      name: action.name,
      role: action.role,
      type: action.memberType,
      username,
      wallet: isWallet ? recipient : undefined,
    })}`,
    cta: "Review and add",
    handoff: "New team members are confirmed on the Team page, where their payout details are checked.",
  };
}

async function startRun(account: string, action: PayrollAction): Promise<AllieOutcome> {
  const [{ count }, groups] = await Promise.all([
    payrollDb()
      .from(payrollTables.teamMembers)
      .select("id", { count: "exact", head: true })
      .eq("account_id", account)
      .eq("status", "ACTIVE"),
    action.group ? loadGroups(account) : Promise.resolve([] as PayrollGroupRecord[]),
  ]);
  const group = action.group ? findByName(groups, action.group) : null;

  if ((count ?? 0) === 0) {
    return {
      kind: "panel",
      title: "Start a payroll run",
      summary: "There's no one on payroll yet. Add your team first, then I can start a run.",
      rows: [],
      cta: "Add a team member",
      href: "/business/payroll/team?add=1",
    };
  }

  return {
    kind: "prepare",
    title: "Start a payroll run",
    summary: group
      ? `A run for ${group.name}, with each person's default pay filled in.`
      : action.group
        ? `I couldn't find a group called “${action.group}”, so the run starts with everyone — pick the group on the next page.`
        : "A run for your whole team, with each person's default pay filled in.",
    rows: [
      { label: "Who", value: group ? `${group.name} group` : `Everyone active (${count})` },
      { label: "Approval", value: "You review amounts and approve before anything is paid" },
    ],
    href: `/business/payroll/runs/new${query({ group: group?.id })}`,
    cta: "Review the run",
    handoff: "Payroll runs are approved in the business workspace and paid from the business wallet — I can't approve on your behalf.",
  };
}

async function openRun(
  account: string,
  statuses: string[],
  labels: { title: string; none: string; cta: string },
): Promise<AllieOutcome> {
  const runs = await loadRuns(account, statuses);
  const run = runs[0];

  if (!run) {
    return {
      kind: "panel",
      title: labels.title,
      summary: labels.none,
      rows: [],
      cta: "Open Payroll",
      href: "/business/payroll",
    };
  }

  return {
    kind: "prepare",
    title: labels.title,
    summary:
      runs.length > 1
        ? `${plural(runs.length, "run")} match — opening the most recent, ${run.name}.`
        : `Opening ${run.name}.`,
    rows: [
      { label: "Run", value: run.name },
      { label: "Amount", value: runAmount(run) },
      { label: "People", value: String(run.recipient_count) },
      { label: "Status", value: runStatusLabel[run.status] ?? run.status },
    ],
    href: `/business/payroll/runs/${run.id}`,
    cta: labels.cta,
    handoff: "Approving and retrying payouts need the workspace approver's own confirmation.",
  };
}

async function loadGroups(account: string) {
  const { data } = await payrollDb()
    .from(payrollTables.groups)
    .select("*")
    .eq("account_id", account)
    .order("name", { ascending: true });
  return (data ?? []) as PayrollGroupRecord[];
}

/** "engineering", "the engineering team" → the Engineering group. */
function findByName<T extends { name: string }>(records: T[], wanted: string) {
  const clean = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(?:the|team|group|department|dept)\b/g, "")
      .replace(/[^a-z0-9]+/g, "");
  const target = clean(wanted);
  if (!target) return null;
  return (
    records.find((record) => clean(record.name) === target) ??
    records.find((record) => clean(record.name).includes(target) || target.includes(clean(record.name))) ??
    null
  );
}

async function payrollGroups(account: string): Promise<AllieOutcome> {
  const groups = await loadGroups(account);
  return {
    kind: "panel",
    title: "Payroll groups",
    summary:
      groups.length === 0
        ? "No groups yet. Groups let you pay a department or a set of contractors on its own."
        : `${plural(groups.length, "group")}.`,
    rows: groups.slice(0, maxRows).map((group) => ({
      label: group.name,
      value: group.default_schedule ?? (group.description || "—"),
    })),
    cta: groups.length === 0 ? "Create a group" : "Manage groups",
    href: "/business/payroll/groups",
  };
}

async function payrollSchedules(account: string): Promise<AllieOutcome> {
  const { data } = await payrollDb()
    .from(payrollTables.schedules)
    .select("*")
    .eq("account_id", account)
    .order("next_run_at", { ascending: true });
  const schedules = (data ?? []) as PayrollScheduleRecord[];
  const active = schedules.filter((schedule) => schedule.is_active);

  return {
    kind: "panel",
    title: "Payroll schedules",
    summary:
      schedules.length === 0
        ? "No schedules yet. A schedule drafts each run for you on time — you still approve it."
        : `${plural(active.length, "active schedule")}${
            schedules.length > active.length ? `, ${schedules.length - active.length} paused` : ""
          }.`,
    rows: schedules.slice(0, maxRows).map((schedule) => ({
      label: `${schedule.schedule_config.description || frequencyLabel[schedule.frequency]}${
        schedule.is_active ? "" : " (paused)"
      }`,
      value: schedule.is_active ? `next ${shortDate(schedule.next_run_at)}` : "paused",
    })),
    cta: schedules.length === 0 ? "Set up a schedule" : "Manage schedules",
    href: "/business/payroll/schedules",
  };
}

export async function resolvePayroll(
  action: PayrollAction | { type: "PayrollStatus" },
  ownerWallet: string,
): Promise<AllieOutcome> {
  const account = await businessWallet(ownerWallet);
  if (!account) return businessOnly("Payroll");

  try {
    if (action.type === "PayrollStatus") return await payrollOverview(account);

    switch (action.action) {
      case "team":
        return await payrollTeam(account, action);
      case "add":
        return addMember(action);
      case "run":
        return await startRun(account, action);
      case "approve":
        return await openRun(account, awaitingApproval, {
          title: "Approve payroll",
          none: "No payroll runs are waiting for approval.",
          cta: "Review and approve",
        });
      case "retry":
        return await openRun(account, needsAttention, {
          title: "Retry failed payouts",
          none: "No payroll runs have failed payouts.",
          cta: "Review failed payouts",
        });
      case "groups":
        return await payrollGroups(account);
      case "schedules":
        return await payrollSchedules(account);
    }
  } catch {
    return {
      kind: "panel",
      title: "Payroll",
      summary: "I couldn't read your payroll just now. It's all still in the Payroll hub.",
      rows: [],
      cta: "Open Payroll",
      href: "/business/payroll",
    };
  }
}

// ─── Invoices you issue ─────────────────────────────────────────────────────

const openStatuses = ["SENT", "VIEWED", "PENDING", "PARTIALLY_PAID", "OVERDUE"];

function isOverdue(invoice: InvoiceRecord, today: string) {
  return (
    openStatuses.includes(invoice.status) &&
    (invoice.status === "OVERDUE" || Boolean(invoice.due_date && invoice.due_date < today))
  );
}

function customerLabel(invoice: InvoiceRecord) {
  return (
    invoice.customer_company ||
    invoice.customer_name ||
    (invoice.customer_username ? `${invoice.customer_username}.one` : null) ||
    invoice.customer_email ||
    "No customer"
  );
}

function matchesCustomer(invoice: InvoiceRecord, wanted: string) {
  const needle = wanted.toLowerCase().replace(/^@/, "").replace(/\.one$/i, "").trim();
  if (!needle) return true;
  return [
    invoice.customer_company,
    invoice.customer_name,
    invoice.customer_username,
    invoice.customer_email,
  ].some((field) => field?.toLowerCase().includes(needle));
}

/** Money still owed on an invoice, in its own currency. */
function owed(invoice: InvoiceRecord) {
  return remainingInvoiceBalance({ amountReceived: invoice.amount_received, total: invoice.total });
}

/** "1,250.00 USDC + 90.00 EURC" — never adds dollars to euros. */
function sumByCurrency(invoices: InvoiceRecord[], amount: (invoice: InvoiceRecord) => number) {
  const totals = new Map<BusinessAsset, number>();
  for (const invoice of invoices) {
    const currency = asset(invoice.currency);
    totals.set(currency, (totals.get(currency) ?? 0) + amount(invoice));
  }
  if (totals.size === 0) return formatInvoiceMoney(0, "USDC");
  return [...totals].map(([currency, value]) => formatInvoiceMoney(value, currency)).join(" + ");
}

async function loadInvoices(wallet: string) {
  const { data, error } = await accountDb()
    .from(accountTables.invoices)
    .select("*")
    .eq("wallet_address", wallet)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as InvoiceRecord[];
}

function invoiceRow(invoice: InvoiceRecord, today: string): AllieOutcomeRow {
  const currency = asset(invoice.currency);
  const status = isOverdue(invoice, today)
    ? `overdue since ${shortDate(invoice.due_date)}`
    : invoice.status === "PAID"
      ? `paid ${shortDate(invoice.paid_at)}`
      : openStatuses.includes(invoice.status)
        ? invoice.due_date
          ? `due ${shortDate(invoice.due_date)}`
          : invoice.status.toLowerCase().replace(/_/g, " ")
        : invoice.status.toLowerCase();
  const amount = openStatuses.includes(invoice.status) ? owed(invoice) : moneyNumber(invoice.total);

  return {
    label: `${invoice.invoice_number} · ${customerLabel(invoice)}`,
    value: `${formatInvoiceMoney(amount, currency)} · ${status}`,
  };
}

async function invoiceStatus(wallet: string, action: InvoiceStatusAction): Promise<AllieOutcome> {
  const today = todayIso();
  const all = (await loadInvoices(wallet)).filter((invoice) =>
    action.customer ? matchesCustomer(invoice, action.customer) : true,
  );
  const open = all.filter((invoice) => openStatuses.includes(invoice.status));
  const overdue = open.filter((invoice) => isOverdue(invoice, today));
  const paid = all.filter((invoice) => invoice.status === "PAID");
  const drafts = all.filter((invoice) => invoice.status === "DRAFT");
  const filter = action.filter ?? "open";
  const who = action.customer ? ` for ${action.customer}` : "";

  const listed =
    filter === "overdue"
      ? overdue
      : filter === "paid"
        ? paid
        : filter === "draft"
          ? drafts
          : filter === "all"
            ? all
            : open;

  const summary =
    all.length === 0
      ? action.customer
        ? `No invoices${who}.`
        : "You haven't issued any invoices yet."
      : filter === "paid"
        ? `${plural(paid.length, "paid invoice")}${who} · ${sumByCurrency(paid, (invoice) => moneyNumber(invoice.total))} received.`
        : filter === "draft"
          ? `${plural(drafts.length, "draft")}${who} not sent yet.`
          : filter === "overdue"
            ? overdue.length === 0
              ? `Nothing overdue${who}.`
              : `${plural(overdue.length, "overdue invoice")}${who} · ${sumByCurrency(overdue, owed)} past due.`
            : open.length === 0
              ? `Nothing outstanding${who} — every sent invoice is paid.`
              : `${sumByCurrency(open, owed)} outstanding${who} across ${plural(open.length, "invoice")}${
                  overdue.length > 0 ? `, ${overdue.length} overdue` : ""
                }.`;

  return {
    kind: "panel",
    title: action.customer ? `Invoices · ${action.customer}` : "Invoices",
    summary,
    rows: listed.slice(0, maxRows).map((invoice) => invoiceRow(invoice, today)),
    cta: all.length === 0 ? "Create an invoice" : "Open Invoices",
    href: all.length === 0 ? "/business/invoices?new=1" : "/business/invoices",
  };
}

/** A customer string as the form wants it: username, email, or a name. */
function splitCustomer(customer: string | undefined) {
  const value = customer?.trim();
  if (!value) return {};
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { email: value };
  if (value.startsWith("@")) return { username: value.slice(1) };
  return { name: value };
}

function createInvoice(action: CreateInvoiceAction, isBusiness: boolean): AllieOutcome {
  const due =
    action.dueDate ?? (action.dueInDays !== undefined ? addDays(action.dueInDays) : undefined);
  const customer = splitCustomer(action.customer);

  if (!isBusiness) {
    // Invoices are a Business feature; a payment request does the same job.
    return {
      kind: "prepare",
      title: "Request a payment",
      summary: "Invoices are part of SaphraONE Business — I've set this up as a payment request instead.",
      rows: [
        { label: "Amount", value: action.amountUsdc ? `${action.amountUsdc} ${action.asset}` : "Any amount" },
        ...(action.customer ? [{ label: "From", value: action.customer }] : []),
        ...(action.description ? [{ label: "For", value: action.description }] : []),
      ],
      href: `/pay${query({
        amount: action.amountUsdc,
        from: customer.username ? `${customer.username}.one` : undefined,
        memo: action.description ?? action.note,
        token: action.asset,
      })}`,
      cta: "Create the request",
      handoff: "Upgrade to Business in Settings to send full invoices with line items and due dates.",
    };
  }

  return {
    kind: "prepare",
    title: "Create an invoice",
    summary: "I've filled in the invoice — review it, then create and send it from Invoices.",
    rows: [
      { label: "Customer", value: action.customer ?? "Add on the next page" },
      {
        label: "Amount",
        value: action.amountUsdc ? formatInvoiceMoney(action.amountUsdc, action.asset) : "Add on the next page",
      },
      ...(action.description ? [{ label: "For", value: action.description }] : []),
      ...(due ? [{ label: "Due", value: shortDate(due) }] : []),
      ...(action.note ? [{ label: "Note", value: action.note }] : []),
    ],
    href: `/business/invoices${query({
      new: 1,
      amount: action.amountUsdc,
      currency: action.asset,
      customer: customer.name,
      description: action.description,
      due,
      email: customer.email,
      notes: action.note,
      username: customer.username,
    })}`,
    cta: "Review the invoice",
    handoff: "Invoices go out from your Invoices hub so you see exactly what the customer will get.",
  };
}

/** "INV-4", "inv 0004", "4" all name INV-0004. */
function invoiceNumberKey(value: string) {
  const match = /^(?:inv[-\s#]*)?#?\s*0*([0-9a-z-]+)$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

function findInvoice(invoices: InvoiceRecord[], ref: string, action: InvoiceActionAction["action"]) {
  // What each action can apply to, so "remind acme" finds their open invoice.
  const eligible = (invoice: InvoiceRecord) =>
    action === "send"
      ? invoice.status === "DRAFT"
      : action === "remind"
        ? openStatuses.includes(invoice.status)
        : action === "cancel"
          ? invoice.status !== "PAID" && invoice.status !== "CANCELLED"
          : true;

  if (/^(?:last|latest|most recent|newest)$/i.test(ref.trim())) {
    return invoices.find(eligible) ?? invoices[0] ?? null;
  }

  const key = invoiceNumberKey(ref);
  if (key) {
    const byNumber = invoices.find((invoice) => invoiceNumberKey(invoice.invoice_number) === key);
    if (byNumber) return byNumber;
  }

  const forCustomer = invoices.filter((invoice) => matchesCustomer(invoice, ref));
  return forCustomer.find(eligible) ?? forCustomer[0] ?? null;
}

async function invoiceAction(wallet: string, action: InvoiceActionAction): Promise<AllieOutcome> {
  const today = todayIso();
  const invoice = findInvoice(await loadInvoices(wallet), action.ref, action.action);

  if (!invoice) {
    return {
      kind: "panel",
      title: "Invoices",
      summary: `I couldn't find an invoice matching “${action.ref}”.`,
      rows: [],
      cta: "Open Invoices",
      href: "/business/invoices",
    };
  }

  const number = invoice.invoice_number;
  const rows: AllieOutcomeRow[] = [
    { label: "Customer", value: customerLabel(invoice) },
    { label: "Amount", value: formatInvoiceMoney(invoice.total, asset(invoice.currency)) },
    ...(openStatuses.includes(invoice.status) && moneyNumber(invoice.amount_received ?? "0") > 0
      ? [{ label: "Still owed", value: formatInvoiceMoney(owed(invoice), asset(invoice.currency)) }]
      : []),
    {
      label: "Status",
      value: isOverdue(invoice, today)
        ? `overdue since ${shortDate(invoice.due_date)}`
        : invoice.status.toLowerCase().replace(/_/g, " "),
    },
    ...(invoice.due_date ? [{ label: "Due", value: shortDate(invoice.due_date) }] : []),
  ];
  const href = `/business/invoices${query({ do: action.action, invoice: invoice.id })}`;

  // Say so plainly when the action no longer applies, rather than opening a
  // page where it can't be done.
  const blocked =
    action.action === "send" && invoice.status !== "DRAFT" && invoice.status !== "CANCELLED"
      ? `${number} has already been sent. Want me to send a reminder instead?`
      : action.action === "remind" && !openStatuses.includes(invoice.status)
        ? invoice.status === "PAID"
          ? `${number} is already paid — no reminder needed.`
          : `${number} hasn't been sent yet, so there's nothing to remind about. Send it first.`
        : action.action === "cancel" && (invoice.status === "PAID" || invoice.status === "CANCELLED")
          ? `${number} is already ${invoice.status.toLowerCase()}.`
          : null;

  if (action.action === "view" || blocked) {
    return {
      kind: "panel",
      title: number,
      summary: blocked ?? undefined,
      rows,
      cta: "Open invoice",
      href: `/business/invoices${query({ do: "view", invoice: invoice.id })}`,
    };
  }

  const verb = { send: "Send", remind: "Remind", cancel: "Cancel" }[action.action];

  return {
    kind: "prepare",
    title:
      action.action === "remind"
        ? `Remind ${customerLabel(invoice)} about ${number}`
        : `${verb} ${number}`,
    summary:
      action.action === "remind"
        ? invoice.customer_email
          ? `I'll open the reminder email to ${invoice.customer_email} for you to send.`
          : "There's no email on this invoice — add one and send the reminder from Invoices."
        : action.action === "send"
          ? "Sending shares the payment link with your customer."
          : "Cancelling stops the customer from paying this invoice.",
    rows,
    href,
    cta: action.action === "remind" ? "Review the reminder" : `${verb} ${number}`,
    handoff: "Invoices change from your Invoices hub, where you confirm before anything reaches the customer.",
  };
}

export async function resolveInvoices(
  action: InvoiceStatusAction | CreateInvoiceAction | InvoiceActionAction,
  ownerWallet: string,
): Promise<AllieOutcome> {
  const wallet = await businessWallet(ownerWallet);

  if (action.type === "CreateInvoice") return createInvoice(action, Boolean(wallet));
  if (!wallet) return businessOnly("Invoices");

  try {
    return action.type === "InvoiceStatus"
      ? await invoiceStatus(wallet, action)
      : await invoiceAction(wallet, action);
  } catch {
    return {
      kind: "panel",
      title: "Invoices",
      summary: "I couldn't read your invoices just now. They're all still in the Invoices hub.",
      rows: [],
      cta: "Open Invoices",
      href: "/business/invoices",
    };
  }
}
