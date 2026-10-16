/**
 * The serif line under a tab's large title on phones, as in the iPhone app:
 * "Build your savings, *one payment at a time.*" The part after the last
 * comma is set in italic purple. Hidden on desktop (components/layout/ios-skin.css).
 */
export function PageTagline({ text }: { text: string }) {
  const cut = text.lastIndexOf(", ");
  return (
    <p className="ios-tagline">
      {cut > 0 ? (
        <>
          {text.slice(0, cut + 1)} <em>{text.slice(cut + 2)}</em>
        </>
      ) : (
        <em>{text}</em>
      )}
    </p>
  );
}
