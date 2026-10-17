import { Badge, Table } from "@/components/developers/docs/blocks";
import { type DocContext } from "@/components/developers/docs/context";

type Props = { ctx: DocContext };

export function ChangelogDoc({ ctx }: Props) {
  return (
    <>
      <p className="dp-lead">Changes to the Checkout API, newest first. v1 only ever changes additively.</p>

      <h2 id="2026-10-17-hosts">
        17 October 2026 · Developer platform <Badge tone="new">New</Badge>
      </h2>
      <ul>
        <li>
          The API has its own hosts: <code>{ctx.liveApiBase}</code> and <code>{ctx.sandboxApiBase}</code>. The earlier
          addresses (<code>/api/v1</code> on the SaphraONE app) keep working.
        </li>
        <li>A developer portal with these docs, a console for keys and payments, and a Sandbox / Live switch.</li>
        <li>OpenAPI description at <a href="/openapi/checkout-v1.json">/openapi/checkout-v1.json</a>.</li>
      </ul>

      <h2 id="2026-10-17-v1">17 October 2026 · Checkout API v1</h2>
      <ul>
        <li>Checkout sessions: create, retrieve, list and expire.</li>
        <li>Hosted payment page with SaphraONE account, Arc wallet, card or bank, and cross-chain payment.</li>
        <li>Secret keys for live and sandbox, idempotent creates, cursor pagination.</li>
      </ul>

      <h2 id="roadmap">Roadmap</h2>
      <Table
        head={["Feature", "What it does", "Status"]}
        rows={[
          ["Webhooks", "Signed notifications for completed, paid, expired and refunded sessions.", <Badge key="s" tone="soon">In development</Badge>],
          ["Refunds API", "Request full or partial refunds; you approve them in SaphraONE.", <Badge key="s" tone="soon">In development</Badge>],
          ["Payment links", "Reusable no-code links that open a checkout.", <Badge key="s">Planned</Badge>],
          ["Embedded checkout", "A saphra.js popup so buyers never leave your site.", <Badge key="s">Planned</Badge>],
          ["Plugins", "WooCommerce first, then Shopify.", <Badge key="s">Planned</Badge>],
          ["More ways to pay", "Local bank transfer (starting with Naira) and more chains.", <Badge key="s">Planned</Badge>],
        ]}
      />
    </>
  );
}
