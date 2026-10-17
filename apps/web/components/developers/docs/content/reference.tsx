import { Badge, Callout, CodeTabs, Endpoint, type Param, ParamList, Table } from "@/components/developers/docs/blocks";
import { createSessionSamples, type DocContext, sampleSession } from "@/components/developers/docs/context";
import { PortalLink } from "@/components/developers/portal/portal-context";

type Props = { ctx: DocContext };

export function ApiOverviewDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        The Checkout API is a REST API. It takes JSON request bodies, returns JSON, uses standard HTTP status codes,
        and authenticates with a secret key.
      </p>

      <h2 id="base-urls">Base URLs</h2>
      <Table
        head={["Environment", "Base URL", "Keys"]}
        rows={[
          ["Live", <code key="l">{ctx.liveApiBase}</code>, <code key="k">sk_live_…</code>],
          ["Sandbox", <code key="s">{ctx.sandboxApiBase}</code>, <code key="k">sk_test_…</code>],
        ]}
      />

      <h2 id="endpoints">Endpoints</h2>
      <Table
        head={["Method", "Path", "Does"]}
        rows={[
          [<Badge key="m">POST</Badge>, <PortalLink href="/docs/api/checkout-sessions#create" key="p"><code>/v1/checkout/sessions</code></PortalLink>, "Create a checkout session"],
          [<Badge key="m">GET</Badge>, <PortalLink href="/docs/api/checkout-sessions#retrieve" key="p"><code>/v1/checkout/sessions/{"{id}"}</code></PortalLink>, "Retrieve a session"],
          [<Badge key="m">GET</Badge>, <PortalLink href="/docs/api/checkout-sessions#list" key="p"><code>/v1/checkout/sessions</code></PortalLink>, "List sessions"],
          [<Badge key="m">POST</Badge>, <PortalLink href="/docs/api/checkout-sessions#expire" key="p"><code>/v1/checkout/sessions/{"{id}"}/expire</code></PortalLink>, "Expire an unpaid session"],
        ]}
      />

      <h2 id="requests">Requests</h2>
      <ul>
        <li>
          Send bodies as JSON with <code>Content-Type: application/json</code>. A body that isn&rsquo;t a JSON object
          is refused with <code>body_invalid</code>.
        </li>
        <li>
          <strong>Money is always a decimal string</strong>, such as <code>&quot;25.00&quot;</code>, with up to six
          decimal places. Numbers are refused so no amount is ever rounded by a float.
        </li>
        <li>Unknown fields are ignored, so adding fields later never breaks you.</li>
        <li>Ids are case-insensitive and look like <code>cs_live_</code> + 24 characters.</li>
      </ul>

      <h2 id="responses">Responses</h2>
      <ul>
        <li>
          Every object has an <code>object</code> field naming its type (<code>checkout.session</code>,{" "}
          <code>list</code>).
        </li>
        <li>Timestamps are ISO 8601 strings in UTC. Fields with no value are <code>null</code>, never missing.</li>
        <li>
          Amounts come back normalised without trailing zeros: <code>&quot;25.00&quot;</code> is returned as{" "}
          <code>&quot;25&quot;</code>.
        </li>
        <li>
          Responses carry <code>Cache-Control: no-store</code>. Errors use one{" "}
          <PortalLink href="/docs/api/errors">error format</PortalLink>.
        </li>
      </ul>

      <h2 id="rate-limits">Rate limits</h2>
      <Table
        head={["Limit", "Value"]}
        rows={[
          ["Requests per secret key", "100 per minute"],
          ["Sessions created per business", "1,000 per hour"],
        ]}
      />
      <p>
        Over the limit you get <code>429</code> with the code <code>rate_limited</code>. Retry with exponential backoff
        (for example 1s, 2s, 4s, with jitter). Need more? Contact SaphraONE support.
      </p>

      <h2 id="limits">Object limits</h2>
      <Table
        head={["Field", "Limit"]}
        rows={[
          [<code key="a">amount</code>, "0.50 to 10,000 per session"],
          [<code key="c">currency</code>, "USDC (default) or EURC"],
          [<code key="e">expires_in_minutes</code>, "30 to 1,440; default 60"],
          [<code key="l">line_items</code>, "Up to 20; quantity 1 to 10,000; name up to 120 characters"],
          [<code key="m">metadata</code>, "Up to 20 keys; keys up to 40 characters, values up to 500"],
          [<code key="d">description</code>, "Up to 140 characters"],
          [<code key="r">client_reference_id</code>, "Up to 200 characters"],
          [<code key="u">success_url, cancel_url</code>, "Up to 2,048 characters"],
          ["Active API keys", "5 per business"],
        ]}
      />

      <h2 id="versioning">Versioning</h2>
      <p>
        The version is in the path: <code>/v1</code>. Within v1 we only make additive changes: new endpoints, new
        optional parameters, new fields in responses and new error codes. Anything that would break an integration
        ships as a new version, announced in the <PortalLink href="/docs/changelog">changelog</PortalLink> well ahead.
      </p>

      <h2 id="openapi">OpenAPI</h2>
      <p>
        A machine-readable description of the API is at <a href="/openapi/checkout-v1.json">/openapi/checkout-v1.json</a>.
        Import it into Postman or Insomnia, or generate a typed client.
      </p>
    </>
  );
}

export function AuthenticationDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        Authenticate every request with a secret key in the <code>Authorization</code> header, as a bearer token.
      </p>
      <CodeTabs
        samples={[
          {
            code: `curl ${ctx.apiBase}/checkout/sessions \\
  -H "Authorization: Bearer ${ctx.keyPrefix}…"`,
            label: "cURL",
            language: "bash",
          },
          {
            code: `await fetch("${ctx.apiBase}/checkout/sessions", {
  headers: { Authorization: \`Bearer \${process.env.SAPHRA_SECRET_KEY}\` },
});`,
            label: "Node.js",
            language: "javascript",
          },
        ]}
      />

      <h2 id="keys">Secret keys</h2>
      <Table
        head={["Prefix", "Environment", "Moves real money"]}
        rows={[
          [<code key="l">sk_live_</code>, "Live", "Yes"],
          [<code key="t">sk_test_</code>, "Sandbox", "No"],
        ]}
      />
      <ul>
        <li>
          Create and revoke keys in the <PortalLink href="/console">console</PortalLink>. Only the business owner and
          admins can manage keys.
        </li>
        <li>A key is shown once when it is created. Store it straight away.</li>
        <li>Live keys can be created only once your business is verified.</li>
        <li>Revoking is immediate; requests with a revoked key fail with <code>api_key_invalid</code>.</li>
      </ul>

      <h2 id="failures">When authentication fails</h2>
      <Table
        head={["HTTP", "code", "Why"]}
        rows={[
          ["401", <code key="c">api_key_missing</code>, "No Authorization: Bearer header."],
          ["401", <code key="c">api_key_invalid</code>, "The key is malformed, unknown or revoked."],
          ["401", <code key="c">api_key_wrong_mode</code>, "A test key on the live API, or a live key on the sandbox."],
          ["403", <code key="c">account_not_business</code>, "The key's account is no longer a Business account."],
          ["403", <code key="c">business_not_verified</code>, "A live key whose business is no longer verified."],
        ]}
      />
      <Callout title="Server-side only" tone="danger">
        Secret keys give full access to your business&rsquo;s Checkout API. Never use them in browsers or apps. Browser
        requests from other sites are refused with <code>403</code>.
      </Callout>
    </>
  );
}

const errorCodes: [string, string, string, string][] = [
  ["400", "invalid_request_error", "parameter_invalid", "A parameter is missing or invalid. `param` names it."],
  ["400", "invalid_request_error", "body_invalid", "The body isn't a JSON object."],
  ["401", "authentication_error", "api_key_missing", "No secret key was sent."],
  ["401", "authentication_error", "api_key_invalid", "The key is unknown or revoked."],
  ["401", "authentication_error", "api_key_wrong_mode", "The key belongs to the other environment."],
  ["403", "permission_error", "account_not_business", "The account isn't a Business account."],
  ["403", "permission_error", "business_not_verified", "Live payments need a verified business."],
  ["404", "not_found_error", "resource_missing", "No such session (or it belongs to another business)."],
  ["409", "invalid_request_error", "session_state_invalid", "The session can't do that in its current state."],
  ["429", "rate_limit_error", "rate_limited", "Too many requests. Back off and retry."],
  ["500", "api_error", "internal_error", "Something failed on our side. Retry with the same Idempotency-Key."],
];

export function ErrorsDoc() {
  return (
    <>
      <p className="dp-lead">
        Errors use conventional HTTP status codes and always return the same JSON shape, so you can handle them in one
        place.
      </p>
      <CodeTabs
        samples={[
          {
            code: `HTTP/1.1 400 Bad Request
{
  "error": {
    "type": "invalid_request_error",
    "code": "parameter_invalid",
    "message": "line_items must add up to amount.",
    "param": "line_items"
  }
}`,
            label: "Error response",
            language: "json",
          },
        ]}
      />
      <ParamList
        params={[
          { children: "The category: decides how your code should react.", name: "type", type: "string" },
          { children: "A stable, machine-readable code. Branch on this.", name: "code", type: "string" },
          { children: "A human-readable explanation. It may change; don't parse it.", name: "message", type: "string" },
          { children: <>The parameter at fault, for <code>parameter_invalid</code>. Nested fields look like <code>line_items[0].unit_amount</code>.</>, name: "param", type: "string, optional" },
        ]}
        title="The error object"
      />

      <h2 id="types">Error types</h2>
      <Table
        head={["type", "Retry?", "Meaning"]}
        rows={[
          [<code key="t">invalid_request_error</code>, "No — fix the request", "Bad input, or not allowed in the session's state."],
          [<code key="t">authentication_error</code>, "No — fix the key", "The key is missing, invalid or for the other environment."],
          [<code key="t">permission_error</code>, "No", "The account can't use the API right now."],
          [<code key="t">not_found_error</code>, "No", "The object doesn't exist for this business."],
          [<code key="t">rate_limit_error</code>, "Yes, with backoff", "Too many requests."],
          [<code key="t">api_error</code>, "Yes, with backoff", "A problem on SaphraONE's side."],
        ]}
      />

      <h2 id="codes">Error codes</h2>
      <Table
        head={["HTTP", "type", "code", "Meaning"]}
        rows={errorCodes.map(([status, type, code, meaning]) => [
          status,
          <code key="t">{type}</code>,
          <code key="c">{code}</code>,
          meaning.split("`").map((part, index) => (index % 2 ? <code key={index}>{part}</code> : part)),
        ])}
      />
      <p>
        Amount limits from the payment engine (for example below 0.50) come back as <code>parameter_invalid</code>{" "}
        with <code>param: &quot;amount&quot;</code>.
      </p>

      <h2 id="handling">Handling errors</h2>
      <CodeTabs
        samples={[
          {
            code: `async function withRetry(call, attempts = 4) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      const retryable = error.status === 429 || error.status >= 500 || error.status === undefined;
      if (!retryable || attempt + 1 >= attempts) throw error;
      const delay = 2 ** attempt * 1000 + Math.random() * 250;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// Safe: the Idempotency-Key makes the retried create return the same session.
const session = await withRetry(() =>
  saphra("/checkout/sessions", { method: "POST", headers: { "Idempotency-Key": "order-1042" }, body }),
);`,
            label: "Node.js",
            language: "javascript",
          },
        ]}
      />
    </>
  );
}

export function IdempotencyDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">
        Networks fail. An idempotency key lets you retry a create without ever creating a second session for the same
        order.
      </p>
      <CodeTabs
        samples={[
          {
            code: `curl ${ctx.apiBase}/checkout/sessions \\
  -H "Authorization: Bearer ${ctx.keyPrefix}…" \\
  -H "Idempotency-Key: order-1042" \\
  -H "Content-Type: application/json" \\
  -d '{"amount": "25.00", "success_url": "https://shop.example/thanks"}'`,
            label: "cURL",
            language: "bash",
          },
        ]}
      />
      <h2 id="how">How it works</h2>
      <ul>
        <li>
          Send <code>Idempotency-Key</code> on <code>POST /v1/checkout/sessions</code>: 8 to 128 characters, unique per
          order.
        </li>
        <li>
          The first request creates the session. Any later request with the same key, from the same business,
          returns <strong>that same session</strong> with its current state, instead of creating another.
        </li>
        <li>Keys are remembered permanently for your business. Never reuse one for a different order.</li>
        <li>Two requests racing with the same key still produce exactly one session.</li>
        <li>
          The original session is returned even if the retried body differs, so build the key from the order (
          <code>order-1042</code>), not from a random value per attempt.
        </li>
      </ul>
      <Callout title="Which requests need it" tone="tip">
        Creating sessions. Retrieving, listing and expiring are naturally safe to repeat.
      </Callout>
    </>
  );
}

export function PaginationDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">List endpoints return results newest first, a page at a time, with a cursor.</p>
      <ParamList
        params={[
          { children: "How many objects to return, 1 to 100. Default 10.", name: "limit", type: "integer" },
          { children: "A session id: return the page of objects that come after it (older).", name: "starting_after", type: "string" },
        ]}
        title="Query parameters"
      />
      <CodeTabs
        samples={[
          {
            code: `{
  "object": "list",
  "data": [ { "id": "cs_…", "object": "checkout.session", ... } ],
  "has_more": true
}`,
            label: "Response",
            language: "json",
          },
        ]}
      />
      <h2 id="all">Fetching everything</h2>
      <p>
        While <code>has_more</code> is true, pass the last id of the page as <code>starting_after</code>:
      </p>
      <CodeTabs
        samples={[
          {
            code: `async function* allSessions(params = {}) {
  let startingAfter;
  for (;;) {
    const query = new URLSearchParams({ limit: "100", ...params });
    if (startingAfter) query.set("starting_after", startingAfter);
    const page = await saphra(\`/checkout/sessions?\${query}\`);
    yield* page.data;
    if (!page.has_more) return;
    startingAfter = page.data.at(-1).id;
  }
}

for await (const session of allSessions({ status: "complete" })) {
  console.log(session.id, session.amount);
}`,
            label: "Node.js",
            language: "javascript",
          },
          {
            code: `curl "${ctx.apiBase}/checkout/sessions?limit=100&starting_after=cs_…" \\
  -H "Authorization: Bearer ${ctx.keyPrefix}…"`,
            label: "cURL",
            language: "bash",
          },
        ]}
      />
    </>
  );
}

const sessionFields: Param[] = [
  { children: <>Unique id, <code>cs_live_…</code> or <code>cs_test_…</code>.</>, name: "id", type: "string" },
  { children: <>Always <code>checkout.session</code>.</>, name: "object", type: "string" },
  { children: <><code>open</code>, <code>complete</code>, <code>expired</code> or <code>cancelled</code>.</>, name: "status", type: "enum" },
  { children: <><code>unpaid</code>, <code>partially_paid</code> or <code>paid</code>, from <code>amount_received</code>.</>, name: "payment_status", type: "enum" },
  { children: "The amount to collect, as a decimal string.", name: "amount", type: "string" },
  { children: <><code>USDC</code> or <code>EURC</code>.</>, name: "currency", type: "enum" },
  { children: "Everything verified on chain so far, including any excess.", name: "amount_received", type: "string" },
  { children: <>Received above <code>amount</code>. Refund it to the buyer.</>, name: "overpayment", type: "string" },
  { children: <>Refunded so far. Always <code>&quot;0&quot;</code> until refunds ship.</>, name: "amount_refunded", type: "string" },
  { children: "The hosted payment page. Redirect the buyer here.", name: "url", type: "string" },
  { children: "Where the buyer goes after paying, as you sent it.", name: "success_url", type: "string" },
  { children: "Where “Cancel and return” goes, or null.", name: "cancel_url", type: "string | null" },
  { children: "Your order id, or null. Never shown to the buyer.", name: "client_reference_id", type: "string | null" },
  { children: "The buyer's email, or null. Never shown on the page.", name: "customer_email", type: "string | null" },
  { children: "What the buyer sees, or null.", name: "description", type: "string | null" },
  { children: <>Display lines: <code>{"{ name, quantity, unit_amount }"}</code>.</>, name: "line_items", type: "array" },
  { children: "Your key–value strings. Never shown to the buyer.", name: "metadata", type: "object" },
  {
    children: (
      <>
        Each verified transfer: <code>tx_hash</code>, <code>amount</code>, <code>method</code> (<code>wallet</code>,{" "}
        <code>saphraone</code>, <code>card_or_bank</code>, <code>cross_chain</code> or <code>manual</code>),{" "}
        <code>paid_at</code>, <code>explorer_url</code>.
      </>
    ),
    name: "payments",
    type: "array",
  },
  { children: "Refund objects. Empty until refunds ship.", name: "refunds", type: "array" },
  { children: <><code>true</code> in live, <code>false</code> in the sandbox.</>, name: "livemode", type: "boolean" },
  { children: "When the session was created.", name: "created_at", type: "timestamp" },
  { children: "When it stops accepting payments (unless a slow payment is on its way).", name: "expires_at", type: "timestamp" },
  { children: "When the full amount arrived, or null.", name: "completed_at", type: "timestamp | null" },
];

const createParams: Param[] = [
  { children: <>Amount to collect as a decimal string, 0.50 to 10,000, up to 6 decimals. Example <code>&quot;25.00&quot;</code>.</>, name: "amount", required: true, type: "string" },
  {
    children: (
      <>
        https URL for after payment. <code>{"{CHECKOUT_SESSION_ID}"}</code> is replaced with the id. http is allowed
        for localhost with test keys.
      </>
    ),
    name: "success_url",
    required: true,
    type: "string",
  },
  { children: <><code>USDC</code> (default) or <code>EURC</code>. Card and cross-chain payment need USDC.</>, name: "currency", type: "string" },
  { children: "https URL for “Cancel and return”.", name: "cancel_url", type: "string" },
  { children: "Shown to the buyer. Up to 140 characters.", name: "description", type: "string" },
  {
    children: (
      <>
        Up to 20 <code>{"{ name, quantity, unit_amount }"}</code>. <code>quantity</code> defaults to 1. They must add
        up to <code>amount</code> exactly.
      </>
    ),
    name: "line_items",
    type: "array",
  },
  { children: "Your order id, up to 200 characters.", name: "client_reference_id", type: "string" },
  { children: "The buyer's email, kept for your records.", name: "customer_email", type: "string" },
  { children: "Up to 20 keys (40 chars) with string values (500 chars). Numbers and booleans are stored as strings.", name: "metadata", type: "object" },
  { children: "How long the session can be paid: 30 to 1,440. Default 60.", name: "expires_in_minutes", type: "integer" },
];

export function CheckoutSessionsDoc({ ctx }: Props) {
  const auth = `-H "Authorization: Bearer ${ctx.keyPrefix}…"`;
  const paid = sampleSession(ctx, {
    amount_received: "25",
    completed_at: "2026-10-17T09:34:12+00:00",
    payment_status: "paid",
    payments: [
      {
        amount: "25",
        explorer_url: `${ctx.explorer}/tx/0x7c1e…`,
        method: "wallet",
        paid_at: "2026-10-17T09:34:12+00:00",
        tx_hash: "0x7c1e…",
      },
    ],
    status: "complete",
  });
  return (
    <>
      <p className="dp-lead">
        A checkout session is one payment for one order on the hosted payment page. Create one when the buyer is
        ready to pay, redirect them to its <code>url</code>, and retrieve it to confirm payment.
      </p>

      <h2 id="object">The session object</h2>
      <ParamList params={sessionFields} title="Fields" />
      <CodeTabs samples={[{ code: paid, label: "A completed session", language: "json" }]} />

      <h2 id="create">Create a session</h2>
      <Endpoint method="POST" path="/v1/checkout/sessions" />
      <p>
        Creates a session and returns it with status <code>201</code>. Send an{" "}
        <PortalLink href="/docs/api/idempotency">Idempotency-Key</PortalLink> header so retries are safe.
      </p>
      <ParamList params={createParams} title="Body parameters" />
      <CodeTabs samples={createSessionSamples(ctx)} />
      <CodeTabs samples={[{ code: sampleSession(ctx), label: "Response 201", language: "json" }]} />

      <h2 id="retrieve">Retrieve a session</h2>
      <Endpoint method="GET" path="/v1/checkout/sessions/{id}" />
      <p>
        Returns the session as it stands. This is how you confirm payment. Retrieving also prompts SaphraONE to check
        for card and cross-chain payments in progress, so polling keeps them moving. Another business&rsquo;s id
        returns <code>404</code>.
      </p>
      <CodeTabs
        samples={[
          { code: `curl ${ctx.apiBase}/checkout/sessions/${ctx.sampleSessionId} \\\n  ${auth}`, label: "cURL", language: "bash" },
          {
            code: `const session = await saphra(\`/checkout/sessions/\${id}\`);
if (session.status === "complete") await fulfil(session);`,
            label: "Node.js",
            language: "javascript",
          },
        ]}
      />

      <h2 id="list">List sessions</h2>
      <Endpoint method="GET" path="/v1/checkout/sessions" />
      <p>Returns your sessions, newest first. See <PortalLink href="/docs/api/pagination">Pagination</PortalLink>.</p>
      <ParamList
        params={[
          { children: "1 to 100. Default 10.", name: "limit", type: "integer" },
          { children: "Return sessions after this session id.", name: "starting_after", type: "string" },
          { children: <>Only sessions with this status: <code>open</code>, <code>complete</code>, <code>expired</code> or <code>cancelled</code>.</>, name: "status", type: "enum" },
        ]}
        title="Query parameters"
      />
      <CodeTabs
        samples={[
          { code: `curl "${ctx.apiBase}/checkout/sessions?status=open&limit=20" \\\n  ${auth}`, label: "cURL", language: "bash" },
        ]}
      />

      <h2 id="expire">Expire a session</h2>
      <Endpoint method="POST" path="/v1/checkout/sessions/{id}/expire" />
      <p>
        Ends an unpaid session so its link can&rsquo;t be paid, for example when the cart changed. Returns the
        session. Expiring an already expired or cancelled session returns it unchanged.
      </p>
      <Table
        head={["When", "Result"]}
        rows={[
          [<span key="1"><code>open</code>, nothing received</span>, <span key="2"><code>200</code>, now <code>expired</code></span>],
          [<span key="1"><code>open</code>, a payment arrived</span>, <span key="2"><code>409</code> <code>session_state_invalid</code></span>],
          [<code key="1">complete</code>, <span key="2"><code>409</code> <code>session_state_invalid</code></span>],
        ]}
      />
      <CodeTabs
        samples={[
          { code: `curl -X POST ${ctx.apiBase}/checkout/sessions/${ctx.sampleSessionId}/expire \\\n  ${auth}`, label: "cURL", language: "bash" },
        ]}
      />
    </>
  );
}

export function WebhooksDoc() {
  return (
    <>
      <p className="dp-lead">
        Webhooks will notify your server the moment a session completes, so you won&rsquo;t need to poll.{" "}
        <Badge tone="soon">In development</Badge>
      </p>
      <Callout title="Until webhooks are live" tone="info">
        Confirm payments by retrieving the session on your return page and with a short reconcile job. See{" "}
        <PortalLink href="/docs/fulfil-orders#reconcile">Confirm and fulfil orders</PortalLink>. That integration
        keeps working after webhooks launch.
      </Callout>

      <h2 id="planned">What&rsquo;s planned</h2>
      <Table
        head={["Event", "When"]}
        rows={[
          [<code key="e">checkout.session.completed</code>, "The full amount arrived. Fires once per session."],
          [<code key="e">checkout.session.payment_received</code>, "Every verified transfer, including partial and extra payments."],
          [<code key="e">checkout.session.expired</code>, "A session expired."],
          [<code key="e">refund.succeeded</code>, "A refund was sent and verified."],
        ]}
      />
      <ul>
        <li>
          Signed with the open <a href="https://www.standardwebhooks.com" rel="noreferrer" target="_blank">Standard Webhooks</a>{" "}
          scheme (<code>webhook-id</code>, <code>webhook-timestamp</code>, <code>webhook-signature</code>), so you can
          verify with off-the-shelf libraries.
        </li>
        <li>The payload&rsquo;s <code>data.object</code> is the same session object the API returns.</li>
        <li>Retried with backoff for about three days, with a delivery log and Resend in the console.</li>
      </ul>
    </>
  );
}
