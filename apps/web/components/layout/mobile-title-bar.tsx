"use client";

import { ChevronLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import "./mobile-app.css";

const backSelector = 'a[aria-label^="Back"], button[aria-label^="Back"]';

/** The page's own back control, if it shows one (tab roots hide theirs). */
function findBack(main: HTMLElement | null) {
  if (!main) return null;
  return [...main.querySelectorAll<HTMLElement>(backSelector)].find((el) => el.offsetParent !== null) ?? null;
}

/**
 * Phones: the iOS large-title behaviour. Each page draws its own big title;
 * once it scrolls up under the top edge, a compact frosted bar slides in
 * with the title and the page's back button. Pages switch views without a
 * route change, so it reads the current title on every scroll.
 */
export function MobileTitleBar() {
  const pathname = usePathname();
  const [bar, setBar] = useState<{ back: boolean; title: string } | null>(null);

  useEffect(() => {
    setBar(null);
    const main = document.querySelector<HTMLElement>(".platform-shell .app-main");
    if (!main) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const heading = main.querySelector<HTMLElement>("h1");
      const title = heading?.textContent?.trim();
      if (!heading || !title) {
        setBar(null);
        return;
      }
      const tucked = heading.getBoundingClientRect().bottom < main.getBoundingClientRect().top + 8;
      setBar((current) => {
        if (!tucked) return null;
        const back = Boolean(findBack(main));
        return current?.title === title && current.back === back ? current : { back, title };
      });
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    main.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      main.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [pathname]);

  // The page's own back control does the work, so history and in-page views
  // behave exactly as they do from the page header.
  function goBack() {
    findBack(document.querySelector<HTMLElement>(".platform-shell .app-main"))?.click();
  }

  return (
    <div aria-hidden={!bar} className="mtitle" data-shown={bar ? "" : undefined} inert={!bar}>
      {bar?.back ? (
        <button aria-label="Back" className="mtitle-back" onClick={goBack} type="button">
          <ChevronLeft aria-hidden className="h-5 w-5" strokeWidth={2.4} />
        </button>
      ) : (
        <span />
      )}
      <p className="mtitle-title">{bar?.title}</p>
      <span />
    </div>
  );
}
