"use client";

import { useEffect } from "react";

import { AuthShell, type AuthStory } from "@/components/auth/auth-shell";
import { AllieScene, GrowScene, SendScene } from "@/components/auth/auth-visuals";
import { SignInPanel } from "@/components/landing/sign-in-panel";
import { rememberNextPath } from "@/lib/sign-in-destination";

const stories: AuthStory[] = [
  {
    body: "Send USDC to any One ID and it lands on Arc in under a second. Lagos to London, rent to dinner, for a fraction of a cent.",
    label: "Send",
    scene: <SendScene />,
    title: "Money that moves like a message.",
  },
  {
    body: "Ask ALLIE in plain words: pay a bill, split dinner, see what you spent this week. Nothing moves until you say yes.",
    label: "ALLIE",
    scene: <AllieScene />,
    title: "Meet ALLIE. She handles the busywork.",
  },
  {
    body: "Put idle USDC to work, lock savings toward a goal, and earn ONE Points on every payment you make.",
    label: "Grow",
    scene: <GrowScene />,
    title: "Save, grow and get rewarded.",
  },
];

/** The sign-in / sign-up page: the story panel beside the sign-in options. */
export function SignInScreen() {
  useEffect(() => {
    // A protected page sent the visitor here with ?next=; keep it through
    // the sign-in (and the Google round trip, which drops the query).
    rememberNextPath();
  }, []);

  return (
    <AuthShell stories={stories}>
      <SignInPanel />
    </AuthShell>
  );
}
