"use client";

import { FadeUp } from "@/components/design/motion";
import { LazyPhoto } from "@/components/landing/lazy-photo";
import { useT } from "@/components/locale-provider";

export function FeatureStories() {
  const t = useT();
  const stories = [
    {
      body: t("landing.storyPayBody"),
      image: "/landing/pay-laptop.jpg",
      imageSize: [1600, 1067],
      imageAlt: t("landing.storyPayAlt"),
      kicker: t("landing.storyPayKicker"),
      title: t("landing.storyPayTitle"),
    },
    {
      body: t("landing.storyCircleBody"),
      flip: true,
      image: "/landing/circle-group.jpg",
      imageSize: [1600, 1095],
      imageAlt: t("landing.storyCircleAlt"),
      kicker: t("landing.storyCircleKicker"),
      title: t("landing.storyCircleTitle"),
    },
    {
      body: t("landing.storyRecureBody"),
      image: "/landing/recurepay-rest.jpg",
      imageSize: [1600, 1067],
      imageAlt: t("landing.storyRecureAlt"),
      kicker: t("landing.storyRecureKicker"),
      title: t("landing.storyRecureTitle"),
    },
  ];

  return (
    <section className="marketing-section" id="stories">
      <div className="marketing-section-header">
        <p className="section-eyebrow">{t("landing.storiesEyebrow")}</p>
        <h2 className="section-title">{t("landing.storiesTitle")}</h2>
        <p className="section-copy">{t("landing.storiesCopy")}</p>
      </div>
      <div className="landing-story-grid">
        {stories.map((story) => (
          <FadeUp
            className={`landing-story ${story.flip ? "landing-story-flip" : ""}`}
            key={story.title}
          >
            <div className="landing-story-media">
              <LazyPhoto
                alt={story.imageAlt}
                height={story.imageSize[1]}
                src={story.image}
                width={story.imageSize[0]}
              />
            </div>
            <div className="landing-story-copy">
              <p className="section-eyebrow">{story.kicker}</p>
              <h3 className="mt-2">{story.title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted-foreground sm:text-base">
                {story.body}
              </p>
            </div>
          </FadeUp>
        ))}
      </div>
    </section>
  );
}
