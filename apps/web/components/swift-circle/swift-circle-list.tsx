"use client";

import { ArrowLeft, Loader2, MessageCircle, PiggyBank, Plus, Split, UsersRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";

import { useT } from "@/components/locale-provider";
import { CircleInviteInbox } from "@/components/swift-circle/circle-invite-inbox";
import { CircleIllustration } from "@/components/swift-circle/circle-illustration";
import { CircleAvatar } from "@/components/swift-circle/circle-visuals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetGrabber, SheetTitle } from "@/components/ui/sheet";
import {
  circleSessionEventName,
  getCircleLoginIdentity,
  readCircleLogin,
} from "@/lib/circle-session";
import {
  createCircleClient,
  fetchCircles,
  respondToInvitationClient,
} from "@/lib/swift-circle/client";
import { formatUsd } from "@/lib/swift-circle/money";
import type {
  CircleInvitationRecord,
  CircleListItem,
  CirclePlatformLimits,
} from "@/lib/swift-circle/types";
import { useSheetSide } from "@/lib/use-media-query";
import { usePlatformWallet } from "@/lib/use-platform-wallet";
import { cn } from "@/lib/utils";
import {
  fetchWalletSessionForAddress,
  signInWalletSession,
  walletSessionChangedEventName,
} from "@/lib/wallet-auth-client";

import "./circle-list.css";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function SwiftCircleList() {
  const t = useT();
  const { address: wagmiAddress } = useAccount();
  const {
    address: platformAddress,
    circleSocialUuid: platformCircleSocialUuid,
  } = usePlatformWallet();
  const address = (platformAddress ?? wagmiAddress)?.toLowerCase() ?? "";
  const { signMessageAsync, isPending: isSigning } = useSignMessage();

  const [circles, setCircles] = useState<CircleListItem[]>([]);
  const [inbox, setInbox] = useState<CircleInvitationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [invites, setInvites] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [limits, setLimits] = useState<CirclePlatformLimits | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const social =
    platformCircleSocialUuid ??
    getCircleLoginIdentity(readCircleLogin())?.socialUserUUID;

  const load = useCallback(async () => {
    if (!address) {
      setCircles([]);
      setInbox([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!social) {
        const session = await fetchWalletSessionForAddress(address);
        if (!session.authenticated) {
          setAuthorized(false);
          setCircles([]);
          setInbox([]);
          return;
        }
      }
      setAuthorized(true);
      const result = await fetchCircles(address, social);
      setCircles(result.circles);
      setInbox(result.inbox);
      setLimits(result.limits);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [address, social]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      setHighlightId(invite);
      window.requestAnimationFrame(() => {
        document.getElementById(`circle-invite-${invite}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  }, [inbox]);

  useEffect(() => {
    function refresh() {
      void load();
    }
    window.addEventListener(walletSessionChangedEventName, refresh);
    window.addEventListener(circleSessionEventName, refresh);
    return () => {
      window.removeEventListener(walletSessionChangedEventName, refresh);
      window.removeEventListener(circleSessionEventName, refresh);
    };
  }, [load]);

  async function authorize() {
    if (!address) return;
    setError(null);
    try {
      if (social) {
        setAuthorized(true);
        await load();
        return;
      }
      await signInWalletSession({
        ownerWallet: address,
        signMessage: async (message) => signMessageAsync({ message }),
      });
      setAuthorized(true);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onCreate() {
    if (!address) return;
    setCreating(true);
    setError(null);
    try {
      const inviteUsernames = invites
        .split(/[,\s]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      await createCircleClient(
        address,
        { name, description, inviteUsernames },
        social,
      );
      setName("");
      setDescription("");
      setInvites("");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  async function respond(id: string, action: "accept" | "decline") {
    if (!address) return;
    setBusyId(id);
    try {
      await respondToInvitationClient(id, address, action, social);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const bar = (
    <header className="cl-bar">
      <Link aria-label="Back to the dashboard" className="cl-round" href="/dashboard">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <h1 className="cl-title">Circle</h1>
      {authorized ? (
        <button
          aria-label={t("circle.startCircle")}
          className="cl-round is-primary"
          onClick={() => setCreateOpen(true)}
          title={t("circle.startCircle")}
          type="button"
        >
          <Plus className="h-5 w-5" />
        </button>
      ) : (
        <span />
      )}
    </header>
  );

  if (!address) {
    return (
      <div className="cl-page">
        {bar}
        <div className="cl-card cl-pad text-sm text-muted-foreground">Connect a wallet to open Circle.</div>
      </div>
    );
  }

  const totalSaved = circles.reduce((sum, circle) => sum + (Number(circle.save_balance) || 0), 0);
  const unread = circles.reduce((sum, circle) => sum + (circle.unread_count ?? 0), 0);

  return (
    <div className="cl-page">
      {bar}

      {error ? <p className="cl-error">{error}</p> : null}

      {!authorized && !loading ? (
        <div className="cl-card cl-pad">
          <p className="text-sm text-muted-foreground">{t("circle.authorizeToLoad")}</p>
          <Button className="mt-3 h-11" disabled={isSigning} onClick={() => void authorize()}>
            {isSigning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("common.authorizeWallet")}
          </Button>
        </div>
      ) : loading ? (
        <p className="cl-loading">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading Circles…
        </p>
      ) : (
        <>
          {inbox.length > 0 ? (
            <section className="cl-section">
              <h2 className="cl-section-title">
                {t("circle.invitations")} <span className="cl-count">{inbox.length}</span>
              </h2>
              <div className="cl-card cl-pad">
                <CircleInviteInbox
                  busyId={busyId}
                  emptyLabel={t("circle.noPending")}
                  highlightId={highlightId}
                  invitations={inbox}
                  onAccept={(id) => void respond(id, "accept")}
                  onDecline={(id) => void respond(id, "decline")}
                />
              </div>
            </section>
          ) : null}

          {circles.length === 0 ? (
            <div className="cl-intro">
              <CircleIllustration className="cl-illustration" />
              <h2 className="cl-intro-title">Money is better together.</h2>
              <p className="cl-intro-body">
                A Circle is a private group for the people you share money with: chat, split bills, request and pay
                each other, and save toward a goal together.
              </p>
              <ul className="cl-intro-points">
                <li>
                  <MessageCircle className="h-4 w-4" /> Group chat with payments right in the conversation
                </li>
                <li>
                  <Split className="h-4 w-4" /> Split bills and send requests to members
                </li>
                <li>
                  <PiggyBank className="h-4 w-4" /> Circle Save: a shared pot everyone can add to
                </li>
              </ul>
              <Button className="cl-cta" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("circle.startCircle")}
              </Button>
            </div>
          ) : (
            <>
              <section className="cl-hero">
                <span aria-hidden className="cl-hero-glow" />
                <p className="cl-hero-label">Saved together</p>
                <p className="cl-hero-amount">{formatUsd(totalSaved)}</p>
                <div className="cl-hero-foot">
                  <span>
                    <UsersRound className="h-3.5 w-3.5" /> {circles.length} Circle{circles.length === 1 ? "" : "s"}
                  </span>
                  {unread > 0 ? (
                    <span>
                      <MessageCircle className="h-3.5 w-3.5" /> {unread} unread
                    </span>
                  ) : null}
                </div>
              </section>

              <section className="cl-section">
                <h2 className="cl-section-title">Your Circles</h2>
                <ul className="cl-card cl-list">
                  {circles.map((circle) => (
                    <li key={circle.id}>
                      <Link className="cl-row" href={`/circle/${circle.id}`}>
                        <CircleAvatar label={circle.name} size={48} src={circle.image_url} />
                        <span className="cl-row-main">
                          <span className="cl-row-title">
                            <span className="truncate">{circle.name}</span>
                            <em className="cl-role">{circle.role}</em>
                            {circle.financial_frozen ? <em className="cl-role is-frozen">Frozen</em> : null}
                          </span>
                          <span className="cl-row-sub">
                            {circle.member_count} people
                            {circle.pending_requests ? ` · ${circle.pending_requests} requests` : " · Open chat"}
                          </span>
                        </span>
                        <span className="cl-row-side">
                          <span className="cl-row-amount">{formatUsd(circle.save_balance)}</span>
                          {circle.unread_count ? (
                            <span className="cl-unread">{circle.unread_count}</span>
                          ) : (
                            <span className="cl-row-sub">saved</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      )}

      <CreateCircleSheet
        authorized={authorized}
        creating={creating}
        description={description}
        invites={invites}
        limits={limits}
        name={name}
        onClose={() => setCreateOpen(false)}
        onCreate={async () => {
          await onCreate();
          setCreateOpen(false);
        }}
        onDescriptionChange={setDescription}
        onInvitesChange={setInvites}
        onNameChange={setName}
        open={createOpen}
      />
    </div>
  );
}

function CreateCircleSheet({
  authorized,
  creating,
  description,
  invites,
  limits,
  name,
  onClose,
  onCreate,
  onDescriptionChange,
  onInvitesChange,
  onNameChange,
  open,
}: {
  authorized: boolean;
  creating: boolean;
  description: string;
  invites: string;
  limits: CirclePlatformLimits | null;
  name: string;
  onClose: () => void;
  onCreate: () => Promise<void>;
  onDescriptionChange: (value: string) => void;
  onInvitesChange: (value: string) => void;
  onNameChange: (value: string) => void;
  open: boolean;
}) {
  const t = useT();
  const side = useSheetSide();
  return (
    <Sheet onOpenChange={(next) => !next && onClose()} open={open}>
      <SheetContent
        className={cn("gap-0 p-0", side === "bottom" ? "max-h-[92dvh] rounded-t-[1.75rem] border-t-0" : "w-full sm:max-w-md")}
        showCloseButton={false}
        side={side}
      >
        {side === "bottom" ? <SheetGrabber /> : null}
        <div className="cl-sheet">
          <SheetTitle className="text-center text-lg font-bold">{t("circle.startCircle")}</SheetTitle>
          <SheetDescription className="text-center text-sm text-muted-foreground">
            {t("circle.startCircleBody")}
          </SheetDescription>
          <label className="cl-field">
            <span>{t("circle.circleName")}</span>
            <Input onChange={(event) => onNameChange(event.target.value)} placeholder="e.g. Flatmates" value={name} />
          </label>
          <label className="cl-field">
            <span>Description</span>
            <Input
              onChange={(event) => onDescriptionChange(event.target.value)}
              placeholder="Optional"
              value={description}
            />
          </label>
          <label className="cl-field">
            <span>Invite people</span>
            <Input onChange={(event) => onInvitesChange(event.target.value)} placeholder="alice.one bob.one" value={invites} />
            <em>
              SaphraONE usernames, separated by spaces or commas.
              {limits?.max_members ? ` Up to ${limits.max_members} members.` : ""}
            </em>
          </label>
          <Button
            className="h-12 font-bold"
            disabled={creating || !name.trim() || !authorized}
            onClick={() => void onCreate()}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Circle
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
