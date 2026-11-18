export const APP_VERSION = "0.1.0";

export const formatWelcomeDate = (date: Date): string => new Intl.DateTimeFormat("cs-CZ", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
}).format(date);

export const formatWelcomeTime = (date: Date): string => new Intl.DateTimeFormat("cs-CZ", {
  hour: "2-digit",
  minute: "2-digit",
}).format(date);
