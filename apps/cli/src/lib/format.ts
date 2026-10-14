import { formatDistanceToNowStrict, parseISO } from "date-fns";

export function formatAgo(value: string | null | undefined): string {
  if (!value) return "never";
  try {
    return formatDistanceToNowStrict(parseISO(value), { addSuffix: true });
  } catch {
    return value;
  }
}

export function microUsdToDisplay(microUsd: number): string {
  return `$${(microUsd / 1_000_000).toFixed(2)}`;
}

export function labelled(label: string, value: string, width = 14): string {
  return `  ${label.padEnd(width)}${value}`;
}
