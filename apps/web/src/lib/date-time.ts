const localInputPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export function utcIsoToLocalDateTimeInput(isoValue: string): string {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return "";

  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0"),
  ].join("-")
    + "T"
    + [
      date.getHours().toString().padStart(2, "0"),
      date.getMinutes().toString().padStart(2, "0"),
    ].join(":");
}

export function localDateTimeInputToUtcIso(localValue: string): string {
  const date = parseLocalDateTimeInput(localValue);
  if (!date) throw new Error("Invalid local date and time");
  return date.toISOString();
}

export function compareLocalDateTimeInputs(left: string, right: string): number | null {
  const leftDate = parseLocalDateTimeInput(left);
  const rightDate = parseLocalDateTimeInput(right);
  if (!leftDate || !rightDate) return null;
  return leftDate.getTime() - rightDate.getTime();
}

export function formatLocalDateTime(value: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Invalid date";

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function parseLocalDateTimeInput(value: string): Date | null {
  const match = localInputPattern.exec(value);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}
