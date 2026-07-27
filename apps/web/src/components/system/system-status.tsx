"use client";

import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/ui/status-badge";

import styles from "./system-status.module.css";

type HealthResponse = {
  status: "ok" | "error";
  services: {
    web: "up";
    api: "up" | "down";
    database: "up" | "unknown";
  };
};

type StatusState = "checking" | "available" | "unavailable";

export function SystemStatus() {
  const [status, setStatus] = useState<StatusState>("checking");
  const [services, setServices] = useState<HealthResponse["services"]>({
    web: "up",
    api: "down",
    database: "unknown",
  });

  const checkStatus = useCallback((signal?: AbortSignal) => {
    setStatus("checking");

    fetch("/api/system/health", {
      cache: "no-store",
      signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as HealthResponse | null;

        if (
          response.ok &&
          body?.status === "ok" &&
          body.services.web === "up" &&
          body.services.api === "up" &&
          body.services.database === "up"
        ) {
          setServices(body.services);
          setStatus("available");
          return;
        }

        setServices({
          web: "up",
          api: body?.services?.api === "up" ? "up" : "down",
          database: body?.services?.database === "up" ? "up" : "unknown",
        });
        setStatus("unavailable");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setServices({
          web: "up",
          api: "down",
          database: "unknown",
        });
        setStatus("unavailable");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => checkStatus(controller.signal), 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [checkStatus]);

  const badge =
    status === "available" ? (
      <StatusBadge tone="success">Available</StatusBadge>
    ) : status === "checking" ? (
      <StatusBadge tone="neutral">Checking</StatusBadge>
    ) : (
      <StatusBadge tone="danger">Unavailable</StatusBadge>
    );

  return (
    <section className={styles.panel} aria-labelledby="system-status-title">
      <div className={styles.summary}>
        <h3 id="system-status-title" className={styles.title}>
          System status
        </h3>
        {badge}
      </div>
      <dl className={styles.grid}>
        <div className={styles.service}>
          <dt className={styles.serviceName}>Web application</dt>
          <dd className={styles.serviceValue}>{services.web}</dd>
        </div>
        <div className={styles.service}>
          <dt className={styles.serviceName}>Backend API</dt>
          <dd className={styles.serviceValue}>{services.api}</dd>
        </div>
        <div className={styles.service}>
          <dt className={styles.serviceName}>Database</dt>
          <dd className={styles.serviceValue}>{services.database}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={() => checkStatus()}>
          Retry
        </button>
      </div>
    </section>
  );
}
