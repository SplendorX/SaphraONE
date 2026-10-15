/**
 * A landing-page photo that downloads only as it scrolls near (loading=lazy),
 * as a WebP about a third the size of the JPG, which stays as the fallback.
 * The <picture> takes no box of its own, so the page's CSS for the <img>
 * (size, crop, hover) applies exactly as before.
 *
 * `src` is the JPG ("/landing/pay-laptop.jpg"); a WebP of the same name sits
 * beside it (made with sharp at 1200px wide).
 */
export function LazyPhoto({
  alt,
  height,
  src,
  width,
}: {
  alt: string;
  height: number;
  src: string;
  width: number;
}) {
  return (
    <picture style={{ display: "contents" }}>
      <source srcSet={src.replace(/\.jpe?g$/i, ".webp")} type="image/webp" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt}
        decoding="async"
        draggable={false}
        height={height}
        loading="lazy"
        src={src}
        width={width}
      />
    </picture>
  );
}
