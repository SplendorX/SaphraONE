"use client";

import { Check, Loader2, Pencil, Search, Trash2, UserRound, Users, X } from "lucide-react";
import { useMemo, useState } from "react";

import { RecipientSpinner, RecipientStatus } from "@/components/recipient-status";
import { type BeneficiaryRecord } from "@/lib/beneficiaries";
import { formatUsernameLabel } from "@/lib/profile";
import { useResolvedRecipient } from "@/lib/use-resolved-recipient";

export type ContactEdit = {
  name: string;
  wallet: string;
  /** Set when the new recipient was entered as, or resolves to, a username. */
  username: string | null;
};

export function BeneficiaryContacts({
  isLoading,
  onDelete,
  onSelect,
  onUpdate,
  savedBeneficiaries,
  selectedWallet,
  shortenAddress,
}: {
  isLoading: boolean;
  /** Resolves when the contact is gone; rejects with a message to show. */
  onDelete: (beneficiary: BeneficiaryRecord) => Promise<void>;
  onSelect: (beneficiary: BeneficiaryRecord) => void;
  /** Resolves when saved; rejects with a message to show. */
  onUpdate: (beneficiary: BeneficiaryRecord, edit: ContactEdit) => Promise<void>;
  savedBeneficiaries: BeneficiaryRecord[];
  selectedWallet?: string;
  shortenAddress: (value?: string) => string;
}) {
  const [query, setQuery] = useState("");
  // One row at a time is being edited or confirming a delete.
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ wallet: string; message: string } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return savedBeneficiaries;
    }

    return savedBeneficiaries.filter((beneficiary) => {
      const username = beneficiary.username?.toLowerCase() ?? "";
      return (
        beneficiary.name.toLowerCase().includes(needle) ||
        beneficiary.beneficiary_wallet.toLowerCase().includes(needle) ||
        username.includes(needle.replace(/^@/, ""))
      );
    });
  }, [query, savedBeneficiaries]);

  async function remove(beneficiary: BeneficiaryRecord) {
    setDeleting(beneficiary.beneficiary_wallet);
    setRowError(null);
    try {
      await onDelete(beneficiary);
      setConfirmingDelete(null);
    } catch (error) {
      setRowError({
        wallet: beneficiary.beneficiary_wallet,
        message: error instanceof Error ? error.message : "Contact could not be deleted.",
      });
    } finally {
      setDeleting(null);
    }
  }

  return (
    <section className="pay-contacts glass-panel min-w-0 self-start p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-eyebrow">Contacts</p>
          <h2 className="mt-1 font-heading text-lg font-semibold tracking-tight">
            Beneficiaries
          </h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Saved names with username or wallet. Pick one to fill Pay.
          </p>
        </div>
        <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.9rem] border border-border bg-primary/8 text-primary">
          <Users className="h-4 w-4" />
        </div>
      </div>

      <label className="field-shell mb-3 flex h-10 items-center gap-2 px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="Search contacts"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, ONE ID, or wallet"
          value={query}
        />
      </label>

      {isLoading ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading contacts…
        </div>
      ) : savedBeneficiaries.length === 0 ? (
        <div className="rounded-[1.1rem] border border-dashed border-border bg-muted/30 px-3 py-6 text-center">
          <UserRound className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No contacts yet</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Name a recipient in Pay and save them here.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="px-1 py-4 text-sm text-muted-foreground">
          No contacts match “{query.trim()}”.
        </p>
      ) : (
        <div className="pay-contacts-list">
          {filtered.map((beneficiary) => {
            const wallet = beneficiary.beneficiary_wallet;
            const key = `${beneficiary.owner_wallet}-${wallet}`;

            if (editing === wallet) {
              return (
                <ContactEditor
                  beneficiary={beneficiary}
                  key={key}
                  onCancel={() => setEditing(null)}
                  onSave={async (edit) => {
                    await onUpdate(beneficiary, edit);
                    setEditing(null);
                  }}
                />
              );
            }

            const selected = selectedWallet?.toLowerCase() === wallet.toLowerCase();
            const handle = beneficiary.username
              ? formatUsernameLabel(beneficiary.username)
              : shortenAddress(wallet);
            const confirming = confirmingDelete === wallet;
            const error = rowError?.wallet === wallet ? rowError.message : null;

            return (
              <div className="pay-contact-item" data-confirming={confirming} key={key}>
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    className="pay-contact-row min-w-0 flex-1"
                    data-selected={selected ? "true" : "false"}
                    onClick={() => onSelect(beneficiary)}
                    type="button"
                  >
                    <span className="pay-contact-avatar" aria-hidden="true">
                      {initials(beneficiary.name)}
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {beneficiary.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                        {handle}
                      </span>
                    </span>
                  </button>
                  {!confirming ? (
                    <div className="pay-contact-actions">
                      <button
                        aria-label={`Edit ${beneficiary.name}`}
                        className="pay-contact-action"
                        onClick={() => {
                          setConfirmingDelete(null);
                          setRowError(null);
                          setEditing(wallet);
                        }}
                        title="Edit"
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        aria-label={`Delete ${beneficiary.name}`}
                        className="pay-contact-action pay-contact-action-danger"
                        onClick={() => {
                          setEditing(null);
                          setRowError(null);
                          setConfirmingDelete(wallet);
                        }}
                        title="Delete"
                        type="button"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>

                {confirming ? (
                  <div className="pay-contact-confirm" role="alert">
                    <span className="min-w-0 flex-1 text-xs">
                      Delete <strong>{beneficiary.name}</strong> from your contacts?
                    </span>
                    <button
                      className="pay-contact-confirm-keep"
                      disabled={deleting === wallet}
                      onClick={() => setConfirmingDelete(null)}
                      type="button"
                    >
                      Keep
                    </button>
                    <button
                      className="pay-contact-confirm-delete"
                      disabled={deleting === wallet}
                      onClick={() => void remove(beneficiary)}
                      type="button"
                    >
                      {deleting === wallet ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                      Delete
                    </button>
                  </div>
                ) : null}

                {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A contact row turned into a small form: name, and who it pays. */
function ContactEditor({
  beneficiary,
  onCancel,
  onSave,
}: {
  beneficiary: BeneficiaryRecord;
  onCancel: () => void;
  onSave: (edit: ContactEdit) => Promise<void>;
}) {
  const [name, setName] = useState(beneficiary.name);
  const [recipient, setRecipient] = useState(
    beneficiary.username ? `@${beneficiary.username}` : beneficiary.beneficiary_wallet,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolution = useResolvedRecipient(recipient);
  const fieldId = `contact-edit-${beneficiary.beneficiary_wallet}`;

  const trimmedName = name.trim();
  const canSave =
    Boolean(trimmedName) && trimmedName.length <= 80 && resolution.isValid && !saving;

  async function save() {
    if (!canSave || !resolution.resolvedAddress) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: trimmedName,
        wallet: resolution.resolvedAddress,
        username: resolution.resolvedUsername,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contact could not be saved.");
      setSaving(false);
    }
  }

  return (
    <form
      className="pay-contact-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label className="grid gap-1">
        <span className="text-[0.7rem] font-semibold text-muted-foreground">Name</span>
        <input
          autoFocus
          className="field-shell h-9 px-3 text-sm outline-none"
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </label>
      <label className="grid gap-1">
        <span className="text-[0.7rem] font-semibold text-muted-foreground">
          Wallet or @username
        </span>
        <span className="relative">
          <input
            aria-describedby={`${fieldId}-status`}
            autoComplete="off"
            className="field-shell h-9 w-full px-3 pr-8 font-mono text-xs outline-none"
            onChange={(event) => setRecipient(event.target.value)}
            spellCheck={false}
            value={recipient}
          />
          <RecipientSpinner resolution={resolution} />
        </span>
      </label>
      <RecipientStatus id={`${fieldId}-status`} resolution={resolution} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-1.5">
        <button className="pay-contact-confirm-keep" onClick={onCancel} type="button">
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
        <button className="pay-contact-save" disabled={!canSave} type="submit">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </button>
      </div>
    </form>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}
