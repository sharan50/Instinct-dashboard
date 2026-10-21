/**
 * Date and time helpers.
 *
 * Two kinds of values come from the sheet and they are handled differently:
 *
 * - Deadlines are calendar dates ("2026-10-29"). They have no time or
 *   timezone, so they are never turned into a moment in time: the 29th stays
 *   the 29th for every viewer. (new Date("2026-10-29") would be midnight UTC,
 *   which is still the 28th in the Americas.)
 * - "Last update" values are moments in time with an offset
 *   ("2026-10-21T02:50:00+05:30"). They are shown in the viewer's own
 *   timezone, always with a timezone label.
 */

export interface CalendarDate {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
  /** YYYY-MM-DD */
  iso: string;
}

export interface FormatOptions {
  /** BCP 47 locale, e.g. "en-GB". Defaults to the browser's language. */
  locale?: string;
  /** IANA timezone, e.g. "Asia/Kolkata". Defaults to the viewer's timezone. */
  timeZone?: string;
}

const MS_PER_DAY = 86_400_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_WITH_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/** Midnight UTC for a calendar date. Safe for years below 100, unlike Date.UTC. */
function utcMidnight(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Parses "YYYY-MM-DD". Returns null for anything else, including impossible dates like 2026-02-30. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = utcMidnight(year, month + 1, 0).getUTCDate();
  if (day > daysInMonth) return null;
  return { year, month, day, iso: `${pad(year, 4)}-${pad(month)}-${pad(day)}` };
}

/** A day count that only depends on the calendar date, never on a timezone. */
export function dayNumber(date: CalendarDate): number {
  return Math.round(utcMidnight(date.year, date.month, date.day).getTime() / MS_PER_DAY);
}

export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  return dayNumber(a) - dayNumber(b);
}

/** Today's calendar date where the viewer is (or in the given timezone). */
export function todayIn(now: Date, timeZone?: string): CalendarDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = part('year');
  const month = part('month');
  const day = part('day');
  return { year, month, day, iso: `${pad(year, 4)}-${pad(month)}-${pad(day)}` };
}

/** Whole days from `today` until `date`: 0 means today, negative means past. */
export function daysBetween(today: CalendarDate, date: CalendarDate): number {
  return dayNumber(date) - dayNumber(today);
}

/** "Thu, 29 Oct 2026" (wording follows the locale). Never shifts the day. */
export function formatCalendarDate(date: CalendarDate, options: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcMidnight(date.year, date.month, date.day));
}

/**
 * Parses an ISO 8601 timestamp that includes a timezone offset or "Z".
 * Timestamps without an offset are rejected: they would silently be read in
 * the viewer's timezone, which may not be what the sheet meant.
 */
export function parseTimestamp(value: string): Date | null {
  const match = TIMESTAMP_WITH_OFFSET.exec(value.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s = '00', fraction = '', rawOffset = 'Z'] = match;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const daysInMonth = utcMidnight(Number(y), month + 1, 0).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  // Engines disagree on more than 3 fraction digits and on "+0530": normalise both.
  const millis = fraction ? fraction.slice(0, 4).padEnd(4, '0') : '';
  const offset = /^[+-]\d{4}$/.test(rawOffset)
    ? `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`
    : rawOffset.toUpperCase();
  const time = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${millis}${offset}`);
  return Number.isNaN(time) ? null : new Date(time);
}

/** "21 Oct 2026, 02:50 GMT+5:30": the viewer's timezone, always labelled. */
export function formatTimestamp(date: Date, options: FormatOptions = {}): string {
  return new Intl.DateTimeFormat(options.locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: options.timeZone,
  }).format(date);
}

/** "09:41 GMT+5:30" when `date` is today for the viewer, otherwise the full timestamp. */
export function formatTimeOrTimestamp(date: Date, now: Date, options: FormatOptions = {}): string {
  if (todayIn(date, options.timeZone).iso !== todayIn(now, options.timeZone).iso) {
    return formatTimestamp(date, options);
  }
  return new Intl.DateTimeFormat(options.locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: options.timeZone,
  }).format(date);
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago". */
export function formatRelative(date: Date, now: Date, options: FormatOptions = {}): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 60) return 'just now';
  const format = new Intl.RelativeTimeFormat(options.locale, { numeric: 'auto' });
  const minutes = Math.trunc(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.trunc(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  const days = daysBetween(todayIn(now, options.timeZone), todayIn(date, options.timeZone));
  return format.format(days, 'day');
}

/** Old zone names some browsers still report, mapped to their current names. */
const RENAMED_ZONES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Europe/Kiev': 'Europe/Kyiv',
};

/** "Asia/Kolkata (GMT+5:30)": tells the viewer which timezone times are shown in. */
export function describeTimeZone(now: Date, options: FormatOptions = {}): string {
  const formatter = new Intl.DateTimeFormat(options.locale, {
    timeZone: options.timeZone,
    timeZoneName: 'short',
  });
  const resolved = formatter.resolvedOptions().timeZone;
  const zone = RENAMED_ZONES[resolved] ?? resolved;
  const label = formatter.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value;
  return label && label !== zone ? `${zone} (${label})` : zone;
}
