import { AppShell } from "@/components/layout/app-shell";
import { SystemStatus } from "@/components/system/system-status";

import styles from "./page.module.css";

const capabilities = [
  {
    title: "Scheduled auctions",
    description: "Auction phases are derived from authoritative PostgreSQL time.",
  },
  {
    title: "Sealed commitments",
    description: "Bid values stay private while cryptographic commitments are accepted.",
  },
  {
    title: "Timed bid reveals",
    description: "Bidders reveal amounts only during the configured reveal window.",
  },
  {
    title: "Deterministic settlement",
    description: "Settled auctions resolve winners with stable database-backed rules.",
  },
];

export default function Home() {
  return (
    <AppShell>
      <div className={styles.intro}>
        <section className={styles.hero} aria-labelledby="home-title">
          <p className={styles.eyebrow}>Auction House</p>
          <h1 id="home-title" className={styles.title}>
            Secure sealed-bid auctions
          </h1>
          <p className={styles.lead}>
            A foundation for private bid commitments, timed revelations, and
            administrator-controlled settlement workflows.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="status-title">
          <div className={styles.sectionHeader}>
            <h2 id="status-title" className={styles.sectionTitle}>
              Platform status
            </h2>
            <p className={styles.sectionText}>
              The browser checks this Next.js application, the backend API, and
              the database through a safe same-origin health route.
            </p>
          </div>
          <SystemStatus />
        </section>

        <section className={styles.section} aria-labelledby="capabilities-title">
          <div className={styles.sectionHeader}>
            <h2 id="capabilities-title" className={styles.sectionTitle}>
              Platform capabilities
            </h2>
            <p className={styles.sectionText}>
              The frontend foundation is ready for authenticated workflows in
              later milestones.
            </p>
          </div>
          <ul className={styles.capabilities}>
            {capabilities.map((capability) => (
              <li key={capability.title} className={styles.capability}>
                <h3 className={styles.capabilityTitle}>{capability.title}</h3>
                <p className={styles.capabilityText}>{capability.description}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}
