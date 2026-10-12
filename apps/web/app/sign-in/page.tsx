import type { Metadata } from "next";

import { SignInScreen } from "@/components/auth/sign-in-screen";

export const metadata: Metadata = {
  description: "Sign in to SaphraONE or create your account with email, Google or a wallet.",
  title: "Sign in | SaphraONE",
};

export default function SignInPage() {
  return <SignInScreen />;
}
