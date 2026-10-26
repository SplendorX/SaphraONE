import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  Code2,
  Fingerprint,
  Globe2,
  Layers3,
  LockKeyhole,
  Network,
  Orbit,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";

import styles from "./company-home.module.css";

const productLinks = [
  {
    description: "One home for balances, payments, savings and your portable ONE ID.",
    href: "https://app.saphra.one",
    icon: WalletCards,
    label: "Saphra App",
    eyebrow: "For individuals",
  },
  {
    description: "Build payment flows, automate settlement and ship on dependable APIs.",
    href: "https://developers.saphra.one",
    icon: Code2,
    label: "Developers",
    eyebrow: "For builders",
  },
  {
    description: "Accept, send and manage modern money movement from one operating layer.",
    href: "https://app.saphra.one/business",
    icon: Building2,
    label: "Business",
    eyebrow: "For teams",
  },
];

const infrastructure = [
  {
    copy: "Stablecoin-native rails designed for always-on transfers, collections and settlement.",
    icon: CircleDollarSign,
    title: "Value layer",
  },
  {
    copy: "A human-readable identity that makes value move to people, not long addresses.",
    icon: Fingerprint,
    title: "Identity layer",
  },
  {
    copy: "Composable APIs and workflows that let teams embed finance into their own products.",
    icon: Braces,
    title: "Programmable layer",
  },
  {
    copy: "Clear controls, auditable activity and safeguards designed into every interaction.",
    icon: ShieldCheck,
    title: "Trust layer",
  },
];

const capabilities = [
  "Collect payments with hosted checkout and payment links",
  "Send to people and businesses, including bulk payouts",
  "Create invoices, recurring flows and programmable money rules",
  "Manage multi-chain balances from a single experience",
  "Move teams faster with developer tools and webhooks",
  "Grow participation through rewards and partner programs",
];

function BrandMark() {
  return (
    <span aria-hidden className={styles.brandMark}>
      <i />
      <i />
      <i />
    </span>
  );
}

export function CompanyHome() {
  return (
    <main className={styles.site}>
      <div aria-hidden className={styles.noise} />
      <header className={styles.header}>
        <a aria-label="Saphra home" className={styles.logo} href="#top">
          <BrandMark />
          <span>Saphra</span>
        </a>
        <nav aria-label="Primary navigation" className={styles.nav}>
          <a href="#platform">Platform</a>
          <a href="#infrastructure">Infrastructure</a>
          <a href="#company">Company</a>
        </nav>
        <a className={styles.headerCta} href="https://app.saphra.one">
          Open app <ArrowUpRight aria-hidden size={15} />
        </a>
      </header>

      <section className={styles.hero} id="top">
        <div className={styles.heroGlow} />
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}><span /> Saphra Systems Limited</p>
          <h1>Infrastructure for the next era of <em>money.</em></h1>
          <p className={styles.heroLead}>
            Saphra is building the rails for people, businesses and the products they create—so value can move with more clarity, speed and possibility.
          </p>
          <div className={styles.heroActions}>
            <a className={styles.primaryButton} href="https://app.saphra.one">
              Explore Saphra <ArrowRight aria-hidden size={17} />
            </a>
            <a className={styles.textButton} href="#platform">See the platform <ChevronRight aria-hidden size={16} /></a>
          </div>
        </div>

        <div aria-label="Saphra infrastructure overview" className={styles.heroVisual}>
          <div className={`${styles.orbit} ${styles.orbitOne}`} />
          <div className={`${styles.orbit} ${styles.orbitTwo}`} />
          <div className={styles.core}>
            <BrandMark />
            <span>Saphra</span>
          </div>
          <div className={`${styles.node} ${styles.nodeApp}`}><WalletCards size={18} /><span>App</span></div>
          <div className={`${styles.node} ${styles.nodeCode}`}><Code2 size={18} /><span>Build</span></div>
          <div className={`${styles.node} ${styles.nodeBusiness}`}><Building2 size={18} /><span>Business</span></div>
          <div className={`${styles.node} ${styles.nodeIdentity}`}><Fingerprint size={18} /><span>ONE ID</span></div>
          <div className={styles.visualCaption}><span /> Designed for flow</div>
        </div>
      </section>

      <section aria-label="Platform principles" className={styles.ticker}>
        <div><Zap size={16} /> Always-on settlement</div>
        <div><Fingerprint size={16} /> Identity, not addresses</div>
        <div><Network size={16} /> Built for interoperability</div>
        <div><LockKeyhole size={16} /> Security by design</div>
      </section>

      <section className={styles.intro} id="company">
        <p className={styles.sectionKicker}>A company building for the long term</p>
        <div className={styles.introGrid}>
          <h2>Financial infrastructure should feel <em>more human.</em></h2>
          <div>
            <p>We believe the internet needs a more useful foundation for value: one that is open to builders, intuitive for everyone, and capable of serving the real ways people and businesses move.</p>
            <a className={styles.inlineLink} href="#infrastructure">How Saphra works <ArrowRight aria-hidden size={16} /></a>
          </div>
        </div>
      </section>

      <section className={styles.platform} id="platform">
        <div className={styles.sectionHeading}>
          <p className={styles.sectionKicker}>The Saphra ecosystem</p>
          <h2>One infrastructure layer. <em>Many ways in.</em></h2>
          <p>Start wherever you are. Every Saphra surface is connected by a shared commitment to better money movement.</p>
        </div>
        <div className={styles.productGrid}>
          {productLinks.map((product, index) => {
            const Icon = product.icon;
            return (
              <a className={styles.productCard} href={product.href} key={product.label}>
                <span className={styles.productNumber}>0{index + 1}</span>
                <span className={styles.productIcon}><Icon size={24} /></span>
                <p className={styles.cardEyebrow}>{product.eyebrow}</p>
                <h3>{product.label}</h3>
                <p>{product.description}</p>
                <span className={styles.cardLink}>Explore <ArrowUpRight aria-hidden size={16} /></span>
              </a>
            );
          })}
        </div>
      </section>

      <section className={styles.infrastructure} id="infrastructure">
        <div className={styles.infrastructureTop}>
          <div>
            <p className={styles.sectionKicker}>A connected foundation</p>
            <h2>Engineered to make value <em>move better.</em></h2>
          </div>
          <p>Our infrastructure brings together the rails, identity and tools needed to move from a transaction to a trusted relationship.</p>
        </div>
        <div className={styles.infrastructureGrid}>
          {infrastructure.map((item) => {
            const Icon = item.icon;
            return (
              <article className={styles.infrastructureCard} key={item.title}>
                <span><Icon size={21} /></span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            );
          })}
        </div>
        <div className={styles.flowPanel}>
          <div className={styles.flowTitle}>
            <Orbit aria-hidden size={21} />
            <span>The Saphra flow</span>
          </div>
          <div className={styles.flowSteps}>
            <div><b>01</b><span>Identity</span></div><i /><div><b>02</b><span>Value</span></div><i /><div><b>03</b><span>Rules</span></div><i /><div><b>04</b><span>Connection</span></div>
          </div>
          <p>From one trusted identity to a growing network of services, each layer makes the next interaction simpler.</p>
        </div>
      </section>

      <section className={styles.capabilities}>
        <div className={styles.capabilityArt}>
          <div className={styles.gridGlow} />
          <Globe2 aria-hidden size={47} strokeWidth={1.25} />
          <span className={styles.artTagOne}>Interoperate</span>
          <span className={styles.artTagTwo}>Settle</span>
          <span className={styles.artTagThree}>Build</span>
        </div>
        <div className={styles.capabilityCopy}>
          <p className={styles.sectionKicker}>What you can do</p>
          <h2>From a first payment to a <em>complete financial system.</em></h2>
          <ul>
            {capabilities.map((capability) => <li key={capability}><Check aria-hidden size={17} />{capability}</li>)}
          </ul>
          <a className={styles.inlineLink} href="https://developers.saphra.one">Explore developer tools <ArrowUpRight aria-hidden size={16} /></a>
        </div>
      </section>

      <section className={styles.trustSection}>
        <div className={styles.trustBadge}><ShieldCheck size={26} /><span>Trust is infrastructure.</span></div>
        <div>
          <h2>Designed with care for every <em>move that matters.</em></h2>
          <p>Saphra combines clear product design with security-minded systems, transparent activity and controls that give people and teams confidence to act.</p>
        </div>
        <a className={styles.secondaryButton} href="https://app.saphra.one/support">Visit support <ArrowUpRight aria-hidden size={16} /></a>
      </section>

      <section className={styles.finalCta}>
        <span aria-hidden className={styles.ctaSphere} />
        <p className={styles.sectionKicker}>Build what moves next</p>
        <h2>The future of value needs <em>better rails.</em></h2>
        <p>Whether you are moving money, managing a business or creating the next category of financial products, Saphra is ready to be your foundation.</p>
        <div className={styles.finalActions}>
          <a className={styles.lightButton} href="https://app.saphra.one">Get started <ArrowRight aria-hidden size={17} /></a>
          <a className={styles.ghostButton} href="https://developers.saphra.one">Build with Saphra <Code2 aria-hidden size={17} /></a>
        </div>
      </section>

      <footer className={styles.footer}>
        <a aria-label="Saphra home" className={styles.logo} href="#top"><BrandMark /><span>Saphra</span></a>
        <div className={styles.footerLinks}>
          <a href="https://app.saphra.one">App</a>
          <a href="https://developers.saphra.one">Developers</a>
          <a href="https://app.saphra.one/business">Business</a>
          <a href="https://app.saphra.one/support">Support</a>
        </div>
        <p>© {new Date().getFullYear()} Saphra Systems Limited.</p>
      </footer>
    </main>
  );
}
