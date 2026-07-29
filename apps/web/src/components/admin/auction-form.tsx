"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import {
  createAuction,
  AdminAuctionClientError,
  updateAuction,
} from "@/lib/admin/admin-auction-client";
import {
  compareLocalDateTimeInputs,
  localDateTimeInputToUtcIso,
  utcIsoToLocalDateTimeInput,
} from "@/lib/date-time";
import type { AdminAuction } from "@/lib/admin/admin-auction-types";
import { FormMessage } from "@/components/admin/form-message";

import styles from "./auction-form.module.css";

type AuctionFormProps =
  | {
      mode: "create";
    }
  | {
      mode: "edit";
      auction: AdminAuction;
    };

type SubmissionState =
  | { type: "idle" }
  | { type: "success"; message: string }
  | { type: "error"; message: string; canRefresh?: boolean };

export function AuctionForm(props: AuctionFormProps) {
  const router = useRouter();
  const creationRequestId = useRef(crypto.randomUUID());
  const initialValues = useMemo(() => getInitialValues(props), [props]);
  const [title, setTitle] = useState(initialValues.title);
  const [description, setDescription] = useState(initialValues.description);
  const [currency, setCurrency] = useState(initialValues.currency);
  const [startTime, setStartTime] = useState(initialValues.startTime);
  const [revealTime, setRevealTime] = useState(initialValues.revealTime);
  const [endTime, setEndTime] = useState(initialValues.endTime);
  const [state, setState] = useState<SubmissionState>({ type: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const validation = validateSchedule(startTime, revealTime, endTime);
    if (validation) {
      setState({ type: "error", message: validation });
      return;
    }

    setIsSubmitting(true);
    setState({ type: "idle" });

    try {
      const request = {
        title: title.trim(),
        description: description.trim() || null,
        currency: currency.trim().toUpperCase(),
        startTime: localDateTimeInputToUtcIso(startTime),
        revealTime: localDateTimeInputToUtcIso(revealTime),
        endTime: localDateTimeInputToUtcIso(endTime),
      };

      if (props.mode === "create") {
        const response = await createAuction({
          creationRequestId: creationRequestId.current,
          ...request,
        });
        creationRequestId.current = crypto.randomUUID();
        router.push(`/admin/auctions/${response.auction.id}`);
        router.refresh();
        return;
      }

      await updateAuction(props.auction.id, {
        expectedVersion: props.auction.version,
        ...request,
      });
      setState({ type: "success", message: "Draft auction updated." });
      router.refresh();
    } catch (error) {
      const message = getSubmissionMessage(error);
      setState({
        type: "error",
        message,
        canRefresh: error instanceof AdminAuctionClientError && error.status === 409,
      });
      if (error instanceof AdminAuctionClientError && error.status === 401) {
        router.replace("/login");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Title</span>
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Currency</span>
          <input
            required
            maxLength={3}
            minLength={3}
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
      </div>

      <label className={styles.field}>
        <span>Description</span>
        <textarea
          maxLength={5000}
          rows={5}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span>Start time</span>
          <input
            required
            type="datetime-local"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Reveal time</span>
          <input
            required
            type="datetime-local"
            value={revealTime}
            onChange={(event) => setRevealTime(event.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>End time</span>
          <input
            required
            type="datetime-local"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
          />
        </label>
      </div>

      <p className={styles.timezone}>Times use your local timezone and are submitted as UTC.</p>

      {state.type !== "idle" ? (
        <FormMessage tone={state.type === "success" ? "success" : "danger"}>
          {state.message}
          {state.type === "error" && state.canRefresh ? (
            <button type="button" className={styles.inlineButton} onClick={() => router.refresh()}>
              Refresh
            </button>
          ) : null}
        </FormMessage>
      ) : null}

      <div className={styles.actions}>
        <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : props.mode === "create" ? "Create draft" : "Update draft"}
        </button>
      </div>
    </form>
  );
}

function getInitialValues(props: AuctionFormProps) {
  if (props.mode === "edit") {
    return {
      title: props.auction.title,
      description: props.auction.description ?? "",
      currency: props.auction.currency,
      startTime: utcIsoToLocalDateTimeInput(props.auction.startTime),
      revealTime: utcIsoToLocalDateTimeInput(props.auction.revealTime),
      endTime: utcIsoToLocalDateTimeInput(props.auction.endTime),
    };
  }

  const now = new Date();
  const start = new Date(now.getTime() + 60 * 60 * 1000);
  const reveal = new Date(start.getTime() + 60 * 60 * 1000);
  const end = new Date(reveal.getTime() + 60 * 60 * 1000);

  return {
    title: "",
    description: "",
    currency: "USD",
    startTime: utcIsoToLocalDateTimeInput(start.toISOString()),
    revealTime: utcIsoToLocalDateTimeInput(reveal.toISOString()),
    endTime: utcIsoToLocalDateTimeInput(end.toISOString()),
  };
}

function validateSchedule(startValue: string, revealValue: string, endValue: string): string | null {
  const startToReveal = compareLocalDateTimeInputs(startValue, revealValue);
  const revealToEnd = compareLocalDateTimeInputs(revealValue, endValue);
  const startToNow = compareLocalDateTimeInputs(startValue, utcIsoToLocalDateTimeInput(new Date().toISOString()));

  if (startToReveal === null || revealToEnd === null || startToNow === null) {
    return "Enter valid start, reveal, and end times.";
  }

  if (!(startToReveal < 0 && revealToEnd < 0)) {
    return "Schedule must follow start, reveal, then end.";
  }

  if (startToNow <= 0) {
    return "The final start time must be in the future.";
  }

  return null;
}

function getSubmissionMessage(error: unknown): string {
  if (error instanceof AdminAuctionClientError) {
    if (error.status === 409) return "This auction changed elsewhere. Refresh before retrying.";
    if (error.status === 503) return "Auction service is unavailable.";
    return error.message;
  }
  return "The auction could not be saved.";
}
