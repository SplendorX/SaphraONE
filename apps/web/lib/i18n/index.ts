import type { AppLocale } from "@/lib/locales";
import { resolveAppLocale } from "@/lib/locales";

import { ar } from "./ar";
import { de } from "./de";
import { en, type Messages } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { pt } from "./pt";
import { zh } from "./zh";

export type { Messages };

export const catalogs: Record<AppLocale, Messages> = {
  en,
  es,
  fr,
  de,
  pt,
  ar,
  zh,
  ja,
  ko,
};

type LeafPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string];

export type MessageKey = LeafPaths<Messages>;

export type TranslateVars = Record<string, string | number>;

function readPath(messages: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let current: unknown = messages;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}


export function translate(
  locale: string,
  key: MessageKey,
  vars?: TranslateVars,
): string {
  const resolved = resolveAppLocale(locale);
  const value =
    readPath(catalogs[resolved], key) ?? readPath(en, key) ?? key;
  if (!vars) return value;
  return Object.entries(vars).reduce(
    (text, [name, replacement]) =>
      text.replaceAll(`{${name}}`, String(replacement)),
    value,
  );
}

export type Translator = (
  key: MessageKey,
  vars?: TranslateVars,
) => string;

export function createTranslator(locale: string): Translator {
  const resolved = resolveAppLocale(locale);
  return (key, vars) => translate(resolved, key, vars);
}

type PageCopy = {
  subtitle?: MessageKey;
  title: MessageKey;
};

export function pageCopyForPath(pathname: string): PageCopy | null {
  if (pathname.startsWith("/business/checkout")) {
    return { title: "pages.checkoutTitle", subtitle: "pages.checkoutSubtitle" };
  }
  if (pathname.startsWith("/business/invoices")) {
    return { title: "pages.invoicesTitle", subtitle: "pages.invoicesSubtitle" };
  }
  if (pathname.startsWith("/business/profile")) {
    return {
      title: "pages.businessProfileTitle",
      subtitle: "pages.businessProfileSubtitle",
    };
  }
  if (pathname.startsWith("/business/payroll")) {
    return { title: "pages.payrollTitle", subtitle: "pages.payrollSubtitle" };
  }
  if (pathname === "/business" || pathname.startsWith("/business/")) {
    return { title: "pages.overviewTitle", subtitle: "pages.overviewSubtitle" };
  }
  if (pathname.startsWith("/circle/")) {
    return {
      title: "pages.circleTitle",
      subtitle: "pages.circleDetailSubtitle",
    };
  }
  if (pathname.startsWith("/save/")) {
    return { title: "pages.saveTitle", subtitle: "pages.saveDetailSubtitle" };
  }

  const exact: Record<string, PageCopy> = {
    "/dashboard": {
      title: "pages.dashboardTitle",
      subtitle: "pages.dashboardSubtitle",
    },
    "/pay": { title: "pages.requestTitle", subtitle: "pages.requestSubtitle" },
    "/swap": { title: "pages.swapTitle", subtitle: "pages.swapSubtitle" },
    "/circle": {
      title: "pages.circleTitle",
      subtitle: "pages.circleSubtitle",
    },
    "/save": { title: "pages.saveTitle", subtitle: "pages.saveSubtitle" },
    "/earn": { title: "pages.earnTitle", subtitle: "pages.earnSubtitle" },
    "/bulkpay": {
      title: "pages.batchTitle",
      subtitle: "pages.batchSubtitle",
    },
    "/recurepay": {
      title: "pages.recureTitle",
      subtitle: "pages.recureSubtitle",
    },
    "/settings": {
      title: "pages.settingsTitle",
      subtitle: "pages.settingsSubtitle",
    },
  };

  return exact[pathname] ?? null;
}

export const navLabelKeys = {
  "/dashboard": "nav.dashboard",
  "/business": "nav.overview",
  "/business/invoices": "nav.invoices",
  "/business/checkout": "nav.checkout",
  "/business/payroll": "nav.payroll",
  "/pay": "nav.request",
  "/swap": "nav.swap",
  "/circle": "nav.circle",
  "/save": "nav.save",
  "/earn": "nav.earn",
  "/bulkpay": "nav.batchPay",
  "/recurepay": "nav.recurePay",
  "/insights": "nav.insights",
  "/settings": "nav.settings",
} as const satisfies Record<string, MessageKey>;
