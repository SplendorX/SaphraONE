"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AllieMark } from "@/components/allie/AllieMark";
import { LaunchAppLink } from "@/components/landing/launch-app-link";
import { cn } from "@/lib/utils";

import "./allie-showcase.css";

/**
 * ALLIE, for people who have not signed in yet.
 *
 * The launcher is hidden on "/", so this is the only place a visitor meets
 * her. It shows rather than tells: a real prompt is typed, she thinks, and the
 * card she would actually produce appears. The scenarios are illustrative —
 * fixed sample figures, never live balances — so nothing here implies an
 * account that does not exist.
 */

type Scenario = {
  prompt: string;
  title: string;
  rows: { label: string; value: string }[];
  foot: string;
};

const scenarios: Scenario[] = [
  {
    prompt: "Send $20 to alex.one",
    title: "Payment ready",
    rows: [
      { label: "Recipient", value: "alex.one" },
      { label: "Amount", value: "20.00 USDC" },
      { label: "Rail", value: "Agent Wallet (Arc)" },
    ],
    foot: "Nothing moves until you press Confirm.",
  },
  {
    prompt: "Split $60 between Sam, Dami and Ada",
    title: "3 payments ready",
    rows: [
      { label: "Sam", value: "20.00 USDC" },
      { label: "Dami", value: "20.00 USDC" },
      { label: "Ada", value: "20.00 USDC" },
    ],
    foot: "One confirmation covers the batch.",
  },
  {
    prompt: "What's my balance?",
    title: "Across your wallets",
    rows: [
      { label: "USDC", value: "248.50" },
      { label: "EURC", value: "32.00" },
      { label: "Savings", value: "120.00" },
    ],
    foot: "Answered from your own data — no payment made.",
  },
  {
    prompt: "Pay rent.one $500 on the 1st, monthly",
    title: "Schedule prepared",
    rows: [
      { label: "Recipient", value: "rent.one" },
      { label: "Amount", value: "500.00 USDC" },
      { label: "Repeats", value: "Monthly, 1st" },
    ],
    foot: "Pause or cancel it any time.",
  },
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    if (!query) {
      return;
    }

    setReduced(query.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);

    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/** How the "Meet ALLIE" title loops: type, hold, erase, pause, repeat. */
const titleLoop = {
  typeMs: 105,
  holdMs: 6000,
  eraseMs: 55,
  gapMs: 700,
};

/**
 * Types `text`, holds it for `holdMs`, erases it and types it again, on a
 * loop. The loop only runs while `active` (the section is on screen).
 * `introduced` turns true the first time the text is complete and stays true,
 * so what enters beside the title (mark, subtitle) does not replay.
 * Reduced motion gets the finished string and no loop.
 */
function useLoopingTypewriter(text: string, reduced: boolean, active: boolean) {
  const [count, setCount] = useState(0);
  const [introduced, setIntroduced] = useState(false);
  const countRef = useRef(0);
  const directionRef = useRef<"typing" | "erasing">("typing");

  useEffect(() => {
    if (reduced) {
      countRef.current = text.length;
      setCount(text.length);
      setIntroduced(true);
      return;
    }
    if (!active) return;

    let timer: number | undefined;
    const step = () => {
      const current = countRef.current;
      if (directionRef.current === "typing") {
        if (current < text.length) {
          countRef.current = current + 1;
          setCount(current + 1);
          if (current + 1 >= text.length) setIntroduced(true);
          timer = window.setTimeout(step, titleLoop.typeMs);
        } else {
          directionRef.current = "erasing";
          timer = window.setTimeout(step, titleLoop.holdMs);
        }
      } else if (current > 0) {
        countRef.current = current - 1;
        setCount(current - 1);
        timer = window.setTimeout(step, titleLoop.eraseMs);
      } else {
        directionRef.current = "typing";
        timer = window.setTimeout(step, titleLoop.gapMs);
      }
    };

    // Resume where it left off when the section scrolls back into view.
    timer = window.setTimeout(step, titleLoop.typeMs);
    return () => window.clearTimeout(timer);
  }, [active, reduced, text]);

  return {
    shown: text.slice(0, count),
    /** The whole title is showing (holding before the next erase). */
    done: count >= text.length,
    introduced,
  };
}

/** Whether `ref` is on screen, so offscreen animation loops can pause. */
function useInView<T extends Element>(ref: { current: T | null }) {
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      threshold: 0.1,
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return inView;
}

function AllieDemoStage({ reduced }: { reduced: boolean }) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"typing" | "thinking" | "result">(
    "typing",
  );
  const scenario = scenarios[index];
  const typedRef = useRef(0);
  const [typed, setTyped] = useState(0);

  // One scenario: type the prompt, think, then show the card.
  useEffect(() => {
    if (reduced) {
      setTyped(scenario.prompt.length);
      setPhase("result");
      return;
    }

    setTyped(0);
    setPhase("typing");
    typedRef.current = 0;

    const timer = window.setInterval(() => {
      typedRef.current += 1;
      setTyped(typedRef.current);

      if (typedRef.current >= scenario.prompt.length) {
        window.clearInterval(timer);
        setPhase("thinking");
      }
    }, 42);

    return () => window.clearInterval(timer);
  }, [reduced, scenario.prompt]);

  useEffect(() => {
    if (phase !== "thinking") {
      return;
    }

    const timer = window.setTimeout(() => setPhase("result"), 850);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "result") {
      return;
    }

    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % scenarios.length),
      reduced ? 6000 : 3400,
    );

    return () => window.clearTimeout(timer);
  }, [phase, reduced]);

  return (
    <div className="allie-stage">
      <div className="allie-stage-bar">
        <span className="allie-stage-dot" />
        <span className="allie-stage-dot" />
        <span className="allie-stage-dot" />
        <span className="allie-stage-name">ALLIE</span>
      </div>

      <div className="allie-stage-body">
        {/* Every scenario's finished state, invisible, in the same cell as
            the live one: the board is always as tall as the tallest of them,
            at any width, so cycling never moves the page around it. */}
        {scenarios.map((item) => (
          <div aria-hidden className="allie-stage-layer allie-stage-sizer" key={item.prompt}>
            <div className="allie-stage-prompt">
              <span>{item.prompt}</span>
            </div>
            <div className="allie-stage-card">
              <p className="allie-stage-card-title">{item.title}</p>
              <div className="allie-stage-rows">
                {item.rows.map((row) => (
                  <div className="allie-stage-row" key={row.label}>
                    <span>{row.label}</span>
                    <span>{row.value}</span>
                  </div>
                ))}
              </div>
              <p className="allie-stage-foot">{item.foot}</p>
            </div>
          </div>
        ))}

        <div className="allie-stage-layer">
        <div className="allie-stage-prompt">
          <span>{scenario.prompt.slice(0, typed)}</span>
          {phase === "typing" ? <i className="allie-stage-caret" /> : null}
        </div>

        {phase === "thinking" ? (
          <div className="allie-stage-thinking">
            <i />
            <i />
            <i />
          </div>
        ) : null}

        {phase === "result" ? (
          <div className="allie-stage-card" key={index}>
            <p className="allie-stage-card-title">{scenario.title}</p>

            <div className="allie-stage-rows">
              {scenario.rows.map((row, rowIndex) => (
                <div
                  className="allie-stage-row"
                  key={`${rowIndex}-${row.label}`}
                  style={{ animationDelay: `${60 * rowIndex}ms` }}
                >
                  <span>{row.label}</span>
                  <span>{row.value}</span>
                </div>
              ))}
            </div>

            <p className="allie-stage-foot">{scenario.foot}</p>
          </div>
        ) : null}
        </div>
      </div>

      <div className="allie-stage-pips" role="presentation">
        {scenarios.map((item, pipIndex) => (
          <span
            className={cn("allie-pip", pipIndex === index && "is-on")}
            key={item.prompt}
          />
        ))}
      </div>
    </div>
  );
}

export function AllieShowcase() {
  const reduced = usePrefersReducedMotion();
  const heading = "Meet ALLIE";
  const sectionRef = useRef<HTMLElement | null>(null);
  const inView = useInView(sectionRef);
  const { shown, done, introduced } = useLoopingTypewriter(heading, reduced, inView);

  const capabilities = useMemo(
    () => [
      "Send and split payments",
      "Answer questions about your money",
      "Schedule what repeats",
      "Move funds into savings",
    ],
    [],
  );

  return (
    <section className="marketing-section allie-landing" id="allie" ref={sectionRef}>
      {/* Two columns on desktop: the board sits left and carries the proof,
          the words sit right and carry the pitch. Stacked on small screens
          with the words first, so the headline still leads. */}
      <div className="allie-landing-grid">
        <div className="allie-landing-board">
          <span aria-hidden className="allie-board-glow" />
          <span aria-hidden className="allie-board-ghost" />
          <AllieDemoStage reduced={reduced} />
        </div>

        <div className="allie-landing-inner">
          <div className="allie-landing-lockup">
            <div className={cn("allie-landing-mark", introduced && "is-in")}>
              <span aria-hidden className="allie-landing-halo" />
              <AllieMark />
            </div>

            <h2 aria-label={heading} className="allie-landing-title">
              {/* An invisible copy holds the full width, so the looping
                  type-and-erase never shifts the mark beside it. */}
              <span aria-hidden className="allie-title-ghost">
                {heading}
              </span>
              <span aria-hidden className="allie-title-typed">
                {shown}
                <i className={cn("allie-title-caret", done && "is-idle")} />
              </span>
            </h2>
          </div>

          <p className={cn("allie-landing-sub", introduced && "is-in")}>
            Your financial assistant.
          </p>

          <ul className="allie-landing-chips">
            {capabilities.map((item, index) => (
              <li
                className="allie-landing-chip"
                key={item}
                style={{ animationDelay: `${1200 + index * 110}ms` }}
              >
                {item}
              </li>
            ))}
          </ul>

          {/* The section exists to convert, so it has to end with a way to
              act. LaunchAppLink already knows where a visitor goes versus
              someone who is signed in, so this borrows that rather than
              guessing. */}
          <LaunchAppLink className="allie-landing-cta">
            <span>Start with ALLIE</span>
            <ArrowRight className="h-4 w-4" />
          </LaunchAppLink>

          <p className="allie-landing-note">
            <ShieldCheck className="h-3.5 w-3.5" />
            Free to start. Every payment waits for your confirmation — sample
            figures shown.
          </p>
        </div>
      </div>
    </section>
  );
}
