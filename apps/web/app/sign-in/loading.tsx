/**
 * Shown the moment sign-in is tapped, while its code finishes loading. It
 * also lets landing-page links prefetch this much without rendering the page.
 */
export default function SignInLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Opening sign-in"
      className="flex min-h-dvh flex-col bg-background"
      role="status"
    >
      <div className="h-[38dvh] bg-[linear-gradient(135deg,#6a0ef4_0%,#3b2cf6_55%,#0078ff_100%)]" />
      <div className="-mt-8 flex flex-1 flex-col items-center rounded-t-[2rem] bg-background px-6 pt-12">
        <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-primary/20 border-t-primary" />
        <p className="mt-4 text-sm font-medium text-muted-foreground">Opening sign-in…</p>
      </div>
    </div>
  );
}
