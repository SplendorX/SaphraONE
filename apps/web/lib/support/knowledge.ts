/**
 * SaphraONE's help library: the curated answers the support assistant gives.
 * Client-safe and free to run — no model calls. Figures here come from the
 * code (lib/fees.ts, lib/contracts.ts, referral cashback, ALLIE monetization);
 * change them together.
 */
import { bulkFeeSummary, recurringFeeSummary, sendFeeSummary, usesLegacyPayrollFee } from "@/lib/fees";
import { multichainEnabled } from "@/lib/multichain/flag";

export type SupportCategory =
  | "getting-started"
  | "payments"
  | "fees"
  | "business"
  | "invoices"
  | "payroll"
  | "recurring"
  | "savings"
  | "allie"
  | "rewards"
  | "account"
  | "security";

export type SupportArticle = {
  id: string;
  category: SupportCategory;
  title: string;
  /** Extra words people use for this topic, beyond the title and answer. */
  keywords: string[];
  answer: string;
  steps?: string[];
  links?: { label: string; href: string }[];
  /** Paths where this article is most likely what's wanted. */
  paths?: string[];
  /** Hand straight to a person as well: money or access may be at risk. */
  urgent?: boolean;
};

export const supportCategories: { id: SupportCategory; label: string }[] = [
  { id: "getting-started", label: "Getting started" },
  { id: "payments", label: "Sending & receiving" },
  { id: "fees", label: "Fees" },
  { id: "business", label: "Business & verification" },
  { id: "invoices", label: "Invoices" },
  { id: "payroll", label: "Payroll" },
  { id: "recurring", label: "RecurePay" },
  { id: "savings", label: "Save & Invest" },
  { id: "allie", label: "ALLIE" },
  { id: "rewards", label: "OnePoints & referrals" },
  { id: "account", label: "Account & settings" },
  { id: "security", label: "Security" },
];

export const supportArticles: SupportArticle[] = [
  // ── Getting started ────────────────────────────────────────────────────
  {
    id: "what-is-saphra",
    category: "getting-started",
    title: "What is SaphraONE?",
    keywords: ["about", "overview", "how does it work", "arc", "stablecoin", "usdc", "eurc"],
    answer:
      "SaphraONE is a payments app for USDC and EURC on the Arc network. You can send and request money, swap between USDC and EURC, save in pockets, run payroll and send invoices — and payments settle in seconds.",
    links: [{ label: "Open your dashboard", href: "/dashboard" }],
  },
  {
    id: "sign-in-options",
    category: "getting-started",
    title: "How do I sign in?",
    keywords: ["login", "log in", "sign up", "register", "create account", "google", "email", "metamask", "wallet connect", "external wallet"],
    answer:
      "Sign in with Google or email to get a SaphraONE wallet created for you, or connect your own wallet (like MetaMask). With your own wallet you sign a one-time message to prove it's yours — that signature never moves money.",
    steps: [
      "Go to the home page and choose Sign in.",
      "Pick Google, email, or Connect wallet.",
      "If you connected a wallet, approve the sign-in message it shows.",
    ],
    links: [{ label: "Sign in", href: "/sign-in" }],
  },
  {
    id: "add-funds",
    category: "getting-started",
    title: "How do I add money to my wallet?",
    keywords: ["deposit", "fund", "top up", "load", "receive usdc", "buy usdc", "bridge", "fund wallet", "no balance"],
    answer:
      "Open Deposit to see your wallet address and ways to fund it. You can receive USDC or EURC on Arc from any wallet or exchange that supports Arc.",
    steps: ["Open Deposit.", "Copy your address or show the QR code.", "Send USDC or EURC on the Arc network to it."],
    links: [{ label: "Open Deposit", href: "/deposit" }],
    paths: ["/dashboard", "/deposit"],
  },
  ...(multichainEnabled
    ? [
        {
          id: "receive-other-network",
          category: "getting-started",
          title: "How do I receive USDC from Base, Polygon or another network?",
          keywords: [
            "base", "polygon", "arbitrum", "optimism", "avalanche", "ethereum", "other network",
            "other chain", "binance", "bybit", "exchange", "withdraw to saphra", "network address",
          ],
          answer:
            "Open Add money and pick Receive from another network. Choose the network the sender uses and share that address. USDC sent there moves to your SaphraONE balance by itself, usually in a minute or two, minus Circle's network fee of about 2 cents. Send USDC only, and only on the network shown: other tokens and networks are not credited. Amounts below the minimum wait until the total reaches it.",
          steps: [
            "Open Add money.",
            "Tap Receive from another network.",
            "Pick the network and copy the address or show the QR code.",
            "Watch it under Incoming; it lands in your balance on its own.",
          ],
          links: [{ label: "Open Add money", href: "/deposit" }],
          paths: ["/deposit"],
        } satisfies SupportArticle,
      ]
    : []),

  // ── Payments ───────────────────────────────────────────────────────────
  {
    id: "send-money",
    category: "payments",
    title: "How do I send money?",
    keywords: ["send", "pay someone", "transfer", "username", "@", "pay a friend", "send usdc", "send eurc"],
    answer:
      `Go to Send, enter a @username or wallet address, the amount and the token, then confirm. A service fee (${sendFeeSummary()}) is added and shown before you confirm.`,
    steps: ["Open Send.", "Enter the recipient and amount.", "Review the total, then confirm in your wallet."],
    links: [{ label: "Open Send", href: "/send" }],
    paths: ["/send", "/dashboard"],
  },
  {
    id: "request-money",
    category: "payments",
    title: "How do I request money?",
    keywords: ["request", "get paid", "payment link", "ask for money", "collect", "bill a friend"],
    answer:
      "Create a payment request to get a link anyone can pay — with or without a SaphraONE account. You'll see it in Activity when it's paid.",
    links: [{ label: "Request a payment", href: "/pay" }],
  },
  {
    id: "payment-pending",
    category: "payments",
    title: "My payment is pending or hasn't arrived",
    keywords: ["pending", "stuck", "not received", "didn't arrive", "missing payment", "where is my money", "processing", "delayed", "not showing"],
    answer:
      "Arc payments usually settle in seconds. If it's still pending, check Transactions and open the transaction on the explorer. A payment that shows as confirmed on the explorer has arrived — the recipient may need to refresh.",
    steps: [
      "Open Transactions (Dashboard → View all) and find the payment.",
      "Open it on the Arc explorer to see its status.",
      "If it failed, your funds stayed in your wallet — you can try again.",
    ],
    links: [{ label: "Open Transactions", href: "/transactions" }],
  },
  {
    id: "wrong-address",
    category: "payments",
    title: "I sent money to the wrong address",
    keywords: ["wrong address", "wrong person", "mistake", "reverse", "refund", "undo", "cancel payment", "sent by mistake"],
    answer:
      "Blockchain payments can't be reversed by SaphraONE. If you know the recipient, ask them to send it back. If you sent to a SaphraONE @username, our team can try to contact them for you.",
    links: [{ label: "Open Transactions", href: "/transactions" }],
    urgent: true,
  },
  {
    id: "batchpay",
    category: "payments",
    title: "How do I pay many people at once?",
    keywords: ["batch", "batchpay", "bulkpay", "bulk", "multiple recipients", "mass payout", "csv", "pay many"],
    answer:
      `BulkPay sends one token to up to 500 recipients in a single transaction, with a service fee of ${bulkFeeSummary()}. You can paste a list or upload a CSV.`,
    links: [{ label: "Open BulkPay", href: "/bulkpay" }],
    paths: ["/bulkpay"],
  },
  {
    id: "swap",
    category: "payments",
    title: "How do I swap USDC and EURC?",
    keywords: ["swap", "convert", "exchange", "buy eurc", "sell eurc", "euro", "dollar", "rate", "quote"],
    answer:
      "Open Swap, choose the pair and amount, review the live quote, and confirm. A 0.3% service fee is included. You can also tap a coin on your dashboard and choose Buy or Sell.",
    links: [{ label: "Open Swap", href: "/swap" }],
    paths: ["/swap", "/dashboard"],
  },

  // ── Fees ───────────────────────────────────────────────────────────────
  {
    id: "fees",
    category: "fees",
    title: "What are SaphraONE's fees?",
    keywords: ["fee", "fees", "cost", "charge", "pricing", "how much", "service fee", "commission", "percentage"],
    answer:
      `Sending: ${sendFeeSummary()}. Swaps: 0.3%. BulkPay and Payroll: ${bulkFeeSummary()}. RecurePay: ${recurringFeeSummary()}. Receiving money, requests and invoices you're paid through are free. Every fee is shown before you confirm.`,
    links: [{ label: "Open Send", href: "/send" }],
  },

  // ── Business ───────────────────────────────────────────────────────────
  {
    id: "business-account",
    category: "business",
    title: "How do I get a Business account?",
    keywords: ["business account", "upgrade", "switch to business", "company account", "merchant", "personal to business"],
    answer:
      "Upgrade in Settings → Account type. Business accounts get invoices, payroll, a team workspace and verification. Upgrading can't be undone.",
    links: [{ label: "Account type", href: "/settings#account-type" }],
  },
  {
    id: "business-verification",
    category: "business",
    title: "How do I get my business verified?",
    keywords: ["verify", "verification", "verified badge", "kyb", "registration number", "tax id", "tin", "vat", "cac", "rc number", "lei", "documents", "under review"],
    answer:
      "Complete your business profile (logo, name, description, category, website, contact email and country). Business verification then unlocks: submit your registration number or tax ID. EU VAT numbers and French, Norwegian, UK and Australian company numbers are checked instantly; others are reviewed by our team, usually within two business days.",
    steps: [
      "Open Business → Profile and fill in every required field.",
      "Save, then scroll to Business verification.",
      "Choose your ID type, enter the number and submit.",
    ],
    links: [{ label: "Business profile", href: "/business/profile" }],
    paths: ["/business/profile", "/business"],
  },
  {
    id: "verification-rejected",
    category: "business",
    title: "My verification wasn't approved",
    keywords: ["rejected", "not approved", "declined", "failed verification", "no record", "name doesn't match"],
    answer:
      "The reason is shown in Business verification. Most often the number has a typo, or the name on your profile doesn't match the registered name. Fix it and submit again — you have five attempts a day.",
    links: [{ label: "Business profile", href: "/business/profile" }],
  },

  // ── Invoices ───────────────────────────────────────────────────────────
  {
    id: "create-invoice",
    category: "invoices",
    title: "How do I create and send an invoice?",
    keywords: ["invoice", "create invoice", "bill customer", "send invoice", "billing", "line items", "due date"],
    answer:
      "Business accounts can create invoices in Invoices: add the customer, line items and due date, then send it. Customers get a link they can pay from any wallet — no SaphraONE account needed.",
    links: [{ label: "Open Invoices", href: "/business/invoices" }],
    paths: ["/business/invoices"],
  },
  {
    id: "pay-invoice",
    category: "invoices",
    title: "How do I pay an invoice I received?",
    keywords: ["pay invoice", "invoice link", "customer", "pay without account", "guest", "external wallet", "pay a bill"],
    answer:
      "Open the invoice link and connect any wallet holding the invoice's currency on Arc, then approve the payment. You don't need a SaphraONE account, and paying doesn't create one. If you have SaphraONE, choose Pay with my SaphraONE account instead.",
    paths: ["/invoice"],
  },
  {
    id: "invoice-unpaid",
    category: "invoices",
    title: "A customer paid but the invoice still shows unpaid",
    keywords: ["invoice unpaid", "not marked paid", "customer paid", "invoice status", "payment not recorded"],
    answer:
      "An invoice is marked paid once its payment is confirmed on Arc and matched to the invoice's wallet and currency. If the customer paid a different address or token, it can't be matched automatically — contact us with the transaction link.",
    links: [{ label: "Open Invoices", href: "/business/invoices" }],
  },
  {
    id: "invoice-reminder",
    category: "invoices",
    title: "How do I remind a customer to pay?",
    keywords: ["reminder", "remind", "chase", "overdue", "follow up", "nudge", "late payment"],
    answer:
      "In Invoices, use Email on an open invoice to send it again with its payment link. You can also ask ALLIE: “remind Acme about their invoice”.",
    links: [{ label: "Open Invoices", href: "/business/invoices" }],
  },

  // ── Payroll ────────────────────────────────────────────────────────────
  {
    id: "payroll-run",
    category: "payroll",
    title: "How do I run payroll?",
    keywords: ["payroll", "pay team", "salaries", "wages", "employees", "run payroll", "approve payroll", "pay staff"],
    answer:
      `Add your team in Payroll → Team, then start a run. Review each person's amount, approve, and the run pays everyone from your business wallet. A service fee of ${bulkFeeSummary(usesLegacyPayrollFee())} applies.`,
    steps: ["Add team members.", "Start a new run (optionally for one group).", "Review, approve, and pay."],
    links: [{ label: "Open Payroll", href: "/business/payroll" }],
    paths: ["/business/payroll"],
  },
  {
    id: "payroll-schedule",
    category: "payroll",
    title: "How do payroll schedules work?",
    keywords: ["payroll schedule", "automatic payroll", "monthly payroll", "payday", "delete schedule", "pause schedule"],
    answer:
      "A schedule drafts a payroll run for you on time — weekly, every two weeks or monthly. You still review and approve each run before anyone is paid. You can pause or delete a schedule at any time; past runs are kept.",
    links: [{ label: "Payroll schedules", href: "/business/payroll/schedules" }],
  },

  // ── RecurePay ──────────────────────────────────────────────────────────
  {
    id: "recurepay",
    category: "recurring",
    title: "How do recurring payments work?",
    keywords: ["recurring", "recurepay", "subscription", "standing order", "every month", "autopay", "schedule payment", "rent"],
    answer:
      `RecurePay sends the same payment on a schedule. Confirm each one from the Due queue, or authorize Autopay so it runs by itself. Each payment has a service fee of ${recurringFeeSummary()}.`,
    links: [{ label: "Open RecurePay", href: "/recurepay" }],
    paths: ["/recurepay"],
  },
  {
    id: "delete-schedule",
    category: "recurring",
    title: "How do I stop or delete a recurring payment?",
    keywords: ["cancel recurring", "stop subscription", "delete schedule", "pause", "turn off autopay", "stop payments"],
    answer:
      "In RecurePay, pause a schedule to stop it for now, or delete it to remove it for good. Deleting also stops Autopay for that schedule.",
    links: [{ label: "Open RecurePay", href: "/recurepay" }],
  },

  // ── Save & Earn ────────────────────────────────────────────────────────
  {
    id: "save-pockets",
    category: "savings",
    title: "How do savings pockets work?",
    keywords: ["save", "savings", "pocket", "goal", "spend and save", "round up", "lock", "withdraw savings"],
    answer:
      "Save lets you set aside money in pockets for goals. Spend & Save can put a little into a pocket each time you pay. You can withdraw from a pocket back to your wallet unless you locked it.",
    links: [{ label: "Open Save", href: "/save" }],
    paths: ["/save"],
  },
  {
    id: "earn",
    category: "savings",
    title: "How does Invest work?",
    keywords: ["earn", "yield", "interest", "vault", "apy", "returns", "deposit to earn"],
    answer:
      "Invest deposits your stablecoins into a yield vault. The APY moves with the market and isn't guaranteed; you can withdraw your position from Invest.",
    links: [{ label: "Open Invest", href: "/earn" }],
    paths: ["/earn"],
  },
  {
    id: "circles",
    category: "savings",
    title: "What are Circles?",
    keywords: ["circle", "group savings", "contribution", "ajo", "esusu", "group", "pool money"],
    answer:
      "Circles let a group pool contributions toward a shared goal, with every contribution and payout recorded for all members.",
    links: [{ label: "Open Circles", href: "/circle" }],
    paths: ["/circle"],
  },

  // ── ALLIE ──────────────────────────────────────────────────────────────
  {
    id: "allie",
    category: "allie",
    title: "What is ALLIE and what does it cost?",
    keywords: ["allie", "assistant", "ai", "pay with allie", "agent", "chat payments", "allie pro"],
    answer:
      "ALLIE is SaphraONE's payment assistant: tell it what to do (“send 20 usdc to @ada”) and it prepares the payment for you to confirm. It pays from a separate Agent Wallet you fund. Free tier: a 0.002 USDC fee per payment on top of the service fee. ALLIE Pro: 5 USDC (or 500 OnePoints) a month for understanding everyday language, with 50 requests a day included.",
    links: [{ label: "Agent Wallet & ALLIE", href: "/settings#agent-wallet" }],
  },
  {
    id: "agent-wallet",
    category: "allie",
    title: "How do I fund, pause or limit ALLIE's wallet?",
    keywords: ["agent wallet", "fund allie", "daily limit", "pause allie", "revoke", "spending limit"],
    answer:
      "Settings → Agent Wallet shows ALLIE's balance and limits. Add funds from your main wallet, set per-payment and daily limits, and pause or revoke ALLIE at any time. ALLIE can never reach your main wallet.",
    links: [{ label: "Agent Wallet settings", href: "/settings#agent-wallet" }],
  },

  // ── Rewards ────────────────────────────────────────────────────────────
  {
    id: "swiftpoints",
    category: "rewards",
    title: "How do OnePoints and cashback work?",
    keywords: ["swiftpoints", "points", "cashback", "rewards", "earn points", "redeem"],
    answer:
      "Payments of $20 or more earn OnePoints: 1 point from $20, 5 from $100, 20 from $500 and 50 from $1,000. A point is worth $0.01 and can be spent on features like ALLIE Pro.",
    links: [{ label: "Rewards", href: "/referral" }],
  },
  {
    id: "referrals",
    category: "rewards",
    title: "How do referrals work?",
    keywords: ["referral", "invite", "refer a friend", "invite link", "referral bonus", "reward friends"],
    answer:
      "Share your invite link from Rewards. When someone you invite joins and reaches the activity milestone, you both earn OnePoints — and you keep earning a little from their activity.",
    links: [{ label: "Rewards", href: "/referral" }],
  },

  // ── Account ────────────────────────────────────────────────────────────
  {
    id: "change-username",
    category: "account",
    title: "How do I change my username or profile?",
    keywords: ["username", "profile", "display name", "avatar", "photo", "bio", "edit profile"],
    answer: "Edit your username, name and photo in Settings → Profile.",
    links: [{ label: "Profile settings", href: "/settings#wallet-profile" }],
  },
  {
    id: "display-settings",
    category: "account",
    title: "How do I change currency, language or hide my balance?",
    keywords: ["currency", "display currency", "language", "hide balance", "dark mode", "theme", "appearance"],
    answer:
      "Settings has Display currency, Language and Appearance. Tap the eye icon on your dashboard to hide or show balances.",
    links: [{ label: "Settings", href: "/settings" }],
  },
  {
    id: "sessions",
    category: "account",
    title: "How do I sign out other devices?",
    keywords: ["sessions", "devices", "sign out", "log out everywhere", "other device"],
    answer: "Settings → Sessions & devices lists where you're signed in; sign any of them out there.",
    links: [{ label: "Sessions & devices", href: "/settings#sessions-devices" }],
  },

  // ── Security ───────────────────────────────────────────────────────────
  {
    id: "account-compromised",
    category: "security",
    title: "I think my account or wallet was compromised",
    keywords: ["hacked", "stolen", "compromised", "unauthorized", "didn't make this", "scam", "phishing", "drained", "lost funds", "someone accessed"],
    answer:
      "Act now: sign out all other devices, pause ALLIE if you use it, and move remaining funds to a wallet you control. SaphraONE will never ask for your seed phrase or private key — anyone who does is a scammer. Our team is being notified.",
    steps: [
      "Settings → Sessions & devices → sign out everything else.",
      "Settings → Agent Wallet → Pause.",
      "Move remaining funds to a safe wallet.",
    ],
    links: [{ label: "Sessions & devices", href: "/settings#sessions-devices" }],
    urgent: true,
  },
  {
    id: "seed-phrase",
    category: "security",
    title: "Does SaphraONE ever ask for my seed phrase?",
    keywords: ["seed phrase", "private key", "recovery phrase", "support asked", "dm", "impersonation", "is this legit"],
    answer:
      "Never. SaphraONE staff will never ask for your seed phrase, private key or one-time codes, and won't message you first on social media. Treat anyone who asks as a scammer.",
  },
];


