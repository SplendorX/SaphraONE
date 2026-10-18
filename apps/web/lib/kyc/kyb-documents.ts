// Server-only. Papers a business sends while KYB is in manual review. Files
// go to the private kyb-documents bucket; only reviewers read them, through
// signed URLs that expire in minutes.
import { randomUUID } from "node:crypto";

import { loadKybProfile, upsertKybProfile, type KybDocument } from "@/lib/kyc/db";
import { kycErrors } from "@/lib/kyc/errors";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const KYB_BUCKET = "kyb-documents";
export const KYB_DOC_MAX_BYTES = 3 * 1024 * 1024;
export const KYB_DOC_MAX_COUNT = 5;
const SIGNED_URL_SECONDS = 600;

/** The file type from its first bytes, never from the name or the browser. */
export function sniffDocumentType(bytes: Uint8Array): { type: string; ext: string } | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { type: "application/pdf", ext: "pdf" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: "image/jpeg", ext: "jpg" };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { type: "image/png", ext: "png" };
  }
  return null;
}

/** A display name with no path parts or control characters. */
export function safeDocumentName(raw: string) {
  const base = raw.split(/[\/]/).pop() ?? "";
  const cleaned = base.replace(/[^\w.\- ()]/g, "").trim().slice(0, 80);
  return cleaned || "document";
}

export async function uploadKybDocument(wallet: string, file: File) {
  const owner = wallet.toLowerCase();
  const { ready, row } = await loadKybProfile(owner);
  if (!ready) throw kycErrors.unavailable("KYB isn't set up yet.");
  if (!row || row.status !== "MANUAL_REVIEW") {
    throw kycErrors.invalid("Documents are only needed while your business is in review.");
  }
  const documents = row.documents ?? [];
  if (documents.length >= KYB_DOC_MAX_COUNT) {
    throw kycErrors.invalid(`You can send up to ${KYB_DOC_MAX_COUNT} documents.`);
  }
  if (file.size === 0 || file.size > KYB_DOC_MAX_BYTES) throw kycErrors.invalid("Send a PDF, JPEG or PNG under 3 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffDocumentType(bytes);
  if (!kind) throw kycErrors.invalid("Send a PDF, JPEG or PNG under 3 MB.");

  const path = `${owner}/${randomUUID()}.${kind.ext}`;
  const { error } = await createSupabaseAdminClient()
    .storage.from(KYB_BUCKET)
    .upload(path, bytes, { contentType: kind.type, upsert: false });
  if (error) {
    console.warn("[kyb] document upload", error.message);
    throw kycErrors.unavailable("Couldn't save the document. Try again shortly.");
  }
  const entry: KybDocument = {
    path,
    name: safeDocumentName(file.name),
    type: kind.type,
    size: bytes.length,
    uploaded_at: new Date().toISOString(),
  };
  await upsertKybProfile(owner, { documents: [...documents, entry] });
  return { documents: [...documents, entry].map(({ name, type, size, uploaded_at }) => ({ name, type, size, uploadedAt: uploaded_at })) };
}

/** Short-lived links for the admin review page. */
export async function signedKybDocuments(documents: KybDocument[] | undefined) {
  if (!documents?.length) return [];
  const storage = createSupabaseAdminClient().storage.from(KYB_BUCKET);
  return Promise.all(
    documents.map(async (doc) => {
      const { data } = await storage.createSignedUrl(doc.path, SIGNED_URL_SECONDS);
      return { name: doc.name, type: doc.type, size: doc.size, uploadedAt: doc.uploaded_at, url: data?.signedUrl ?? null };
    }),
  );
}
