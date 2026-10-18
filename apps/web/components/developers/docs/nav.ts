/** Every docs page, in reading order. The slug is the path under /docs. */
export type DocEntry = {
  slug: string;
  title: string;
  description: string;
  group: DocGroup;
  /** Extra words the sidebar search matches. */
  keywords?: string;
  soon?: boolean;
};

export type DocGroup = "Get started" | "Guides" | "API reference" | "Resources";

export const docGroups: DocGroup[] = ["Get started", "Guides", "API reference", "Resources"];

export const docEntries: DocEntry[] = [
  {
    description: "What the SaphraONE Checkout API is, who it is for, and how the pieces fit.",
    group: "Get started",
    keywords: "overview intro",
    slug: "",
    title: "Introduction",
  },
  {
    description: "Create your first checkout session and take a test payment in five minutes.",
    group: "Get started",
    keywords: "curl first payment start",
    slug: "quickstart",
    title: "Quickstart",
  },
  {
    description: "The payment flow from your server to the buyer and back, and the ways buyers can pay.",
    group: "Get started",
    keywords: "flow diagram hosted page payment methods wallet card bank cross-chain",
    slug: "how-it-works",
    title: "How Checkout works",
  },
  {
    description: "Two environments with their own keys, hosts and data. Build in sandbox, then switch to live.",
    group: "Get started",
    keywords: "test mode testnet mainnet environment toggle faucet",
    slug: "sandbox-and-live",
    title: "Sandbox and live",
  },
  {
    description: "A complete server integration in Node.js, Python and PHP: create, redirect, confirm.",
    group: "Guides",
    keywords: "integration express flask php node python example",
    slug: "accept-a-payment",
    title: "Accept a payment",
  },
  {
    description: "When an order is paid, how to know for sure, and what to do with partial, late and extra payments.",
    group: "Guides",
    keywords: "fulfil fulfill polling status partial overpayment expired late",
    slug: "fulfil-orders",
    title: "Confirm and fulfil orders",
  },
  {
    description: "Test every path of your integration in the sandbox before real money moves.",
    group: "Guides",
    keywords: "testing faucet scenarios localhost",
    slug: "testing",
    title: "Testing",
  },
  {
    description: "The checklist to work through before you switch your site to live keys.",
    group: "Guides",
    keywords: "production launch checklist verification",
    slug: "going-live",
    title: "Go-live checklist",
  },
  {
    description: "Keep keys secret, verify every payment on your server, and lock down redirects.",
    group: "Guides",
    keywords: "secret keys leaked rotate revoke cors",
    slug: "security",
    title: "Security",
  },
  {
    description: "For owners and finance teams: what it costs, where the money goes, and what you need to start.",
    group: "Guides",
    keywords: "business owner pricing fees settlement verification non-technical",
    slug: "business-guide",
    title: "For business owners",
  },
  {
    description: "Base URLs, request and response format, versioning, limits and rate limits.",
    group: "API reference",
    keywords: "base url conventions rate limit versioning",
    slug: "api",
    title: "API overview",
  },
  {
    description: "Authenticate with a secret key in the Authorization header.",
    group: "API reference",
    keywords: "bearer secret key sk_live sk_test",
    slug: "api/authentication",
    title: "Authentication",
  },
  {
    description: "The error object, HTTP status codes, and every error code the API returns.",
    group: "API reference",
    keywords: "error codes status 400 401 403 404 409 429 500",
    slug: "api/errors",
    title: "Errors",
  },
  {
    description: "Retry any create safely with the Idempotency-Key header.",
    group: "API reference",
    keywords: "retry idempotency key duplicate",
    slug: "api/idempotency",
    title: "Idempotent requests",
  },
  {
    description: "Page through lists with limit and starting_after.",
    group: "API reference",
    keywords: "list cursor has_more starting_after",
    slug: "api/pagination",
    title: "Pagination",
  },
  {
    description: "The checkout session object, and the endpoints to create, retrieve, list and expire sessions.",
    group: "API reference",
    keywords: "create retrieve list expire session object endpoint",
    slug: "api/checkout-sessions",
    title: "Checkout Sessions",
  },
  {
    description: "Request full or partial refunds; the merchant approves and sends them.",
    group: "API reference",
    keywords: "refund requested succeeded cancelled destination wallet partial",
    slug: "api/refunds",
    title: "Refunds",
  },
  {
    description: "Signed event notifications to your server: events, signatures, retries.",
    group: "API reference",
    keywords: "webhook events signature standard webhooks svix retries resend verify hmac",
    slug: "api/webhooks",
    title: "Webhooks",
  },
  {
    description: "What changed in the API, and what is coming next.",
    group: "Resources",
    keywords: "changelog roadmap refunds payment links plugins",
    slug: "changelog",
    title: "Changelog and roadmap",
  },
];

export function docEntry(slug: string) {
  return docEntries.find((entry) => entry.slug === slug) ?? null;
}

/** The pages before and after `slug`, for the pager under each page. */
export function docNeighbours(slug: string) {
  const index = docEntries.findIndex((entry) => entry.slug === slug);
  return {
    next: index >= 0 ? (docEntries[index + 1] ?? null) : null,
    previous: index > 0 ? docEntries[index - 1] : null,
  };
}

export function docHref(slug: string) {
  return slug ? `/docs/${slug}` : "/docs";
}
