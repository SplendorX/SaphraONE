"use client";

import { AlertTriangle, Check, Copy, Info, Lightbulb, ShieldAlert } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "@/lib/utils";

export type CodeSample = { label: string; language?: string; code: string };

/** Code with language tabs and a copy button. */
export function CodeTabs({ samples, title }: { samples: CodeSample[]; title?: string }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = samples[Math.min(active, samples.length - 1)];

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <figure className="dp-code">
      <div className="dp-code-bar">
        {title ? <span className="dp-code-title">{title}</span> : null}
        {samples.length > 1 || !title ? (
          <div className="dp-code-tabs" role="tablist">
            {samples.map((sample, index) => (
              <button
                aria-selected={index === active}
                className="dp-code-tab"
                key={sample.label}
                onClick={() => setActive(index)}
                role="tab"
                type="button"
              >
                {sample.label}
              </button>
            ))}
          </div>
        ) : null}
        <button aria-label="Copy code" className="dp-code-copy" onClick={() => void copy()} type="button">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="dp-code-body">
        <code data-language={current.language ?? current.label.toLowerCase()}>{current.code}</code>
      </pre>
    </figure>
  );
}

const calloutIcons = {
  danger: ShieldAlert,
  info: Info,
  tip: Lightbulb,
  warning: AlertTriangle,
};

export function Callout({
  children,
  title,
  tone = "info",
}: {
  children: ReactNode;
  title?: string;
  tone?: keyof typeof calloutIcons;
}) {
  const Icon = calloutIcons[tone];
  return (
    <aside className="dp-callout" data-tone={tone}>
      <Icon aria-hidden className="dp-callout-icon" />
      <div>
        {title ? <p className="dp-callout-title">{title}</p> : null}
        <div className="dp-callout-body">{children}</div>
      </div>
    </aside>
  );
}

export type Param = {
  name: string;
  type: string;
  required?: boolean;
  children: ReactNode;
};

/** A table of request parameters or object fields. */
export function ParamList({ params, title }: { params: Param[]; title?: string }) {
  return (
    <div className="dp-params">
      {title ? <p className="dp-params-title">{title}</p> : null}
      <dl>
        {params.map((param) => (
          <div className="dp-param" key={param.name}>
            <dt>
              <code className="dp-param-name">{param.name}</code>
              <span className="dp-param-type">{param.type}</span>
              {param.required ? <span className="dp-param-required">required</span> : null}
            </dt>
            <dd>{param.children}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const methodTone: Record<string, string> = { DELETE: "danger", GET: "get", PATCH: "post", POST: "post" };

/** `POST /v1/checkout/sessions` as a header for an endpoint section. */
export function Endpoint({ method, path, className }: { method: string; path: string; className?: string }) {
  return (
    <p className={cn("dp-endpoint", className)}>
      <span className="dp-method" data-tone={methodTone[method] ?? "get"}>
        {method}
      </span>
      <code>{path}</code>
    </p>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="dp-steps">{children}</ol>;
}

export function Step({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="dp-step">
      <p className="dp-step-title">{title}</p>
      <div className="dp-step-body">{children}</div>
    </li>
  );
}

/** A simple data table: first row is the header. */
export function Table({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="dp-table-wrap">
      <table className="dp-table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "soon" | "new" }) {
  return (
    <span className="dp-badge" data-tone={tone}>
      {children}
    </span>
  );
}
