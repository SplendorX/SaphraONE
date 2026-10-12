import type { ArcTokenSymbol } from "@/lib/tokens";

type BuildPaymentRequestUrlInput = {
  amount?: string;
  chainId?: number;
  memo?: string;
  origin: string;
  path?: "/send" | "/pay";
  requestId?: string;
  token?: ArcTokenSymbol;
  username?: string;
  walletAddress?: string;
};

export function buildPaymentRequestUrl({
  amount,
  chainId,
  memo,
  origin,
  path = "/send",
  requestId,
  token,
  username,
  walletAddress,
}: BuildPaymentRequestUrlInput) {
  const requestUrl = new URL(path, origin);

  if (requestId?.trim()) {
    requestUrl.searchParams.set("requestId", requestId.trim());
  }

  if (username) {
    requestUrl.searchParams.set("username", username);
  } else if (walletAddress) {
    requestUrl.searchParams.set("to", walletAddress);
  }

  if (amount?.trim()) {
    requestUrl.searchParams.set("amount", amount.trim());
  }

  if (token) {
    requestUrl.searchParams.set("token", token);
  }

  if (chainId) {
    requestUrl.searchParams.set("chainId", String(chainId));
  }

  if (memo?.trim()) {
    requestUrl.searchParams.set("memo", memo.trim());
  }

  return requestUrl.toString();
}


export function withPaymentRequestId(link: string, requestId: string) {
  const id = requestId.trim();
  if (!id) {
    return link;
  }

  try {
    const url = new URL(link, "https://saphra.local");
    url.searchParams.set("requestId", id);
    if (link.startsWith("http://") || link.startsWith("https://")) {
      return url.toString();
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return link;
  }
}

export function readPaymentRequestIdFromLink(link: string) {
  try {
    return new URL(link, "https://saphra.local").searchParams.get("requestId");
  } catch {
    return null;
  }
}