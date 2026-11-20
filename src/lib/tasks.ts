import { parseCalendarDate, parseTimestamp, type CalendarDate } from './dates.ts';
import { parseLinks, type TaskLink } from './linkify.ts';

/**
 * The data contract with the "Tasks" tab of the tracker sheet.
 *
 * Required header row: Task ID | Task | Status | Deadline | Last update | Notes.
 * The columns in OPTIONAL_COLUMNS are used when present. Columns are found by
 * header name, so their order in the sheet does not matter and any optional
 * column may be missing.
 */

export const STATUSES = ['open', 'waiting on you', 'waiting on someone else', 'done'] as const;
export type Status = (typeof STATUSES)[number];

export const ACTIVE_STATUSES: readonly Status[] = ['open', 'waiting on you', 'waiting on someone else'];

export const STATUS_LABELS: Record<Status, string> = {
  open: 'Open',
  'waiting on you': 'Waiting on you',
  'waiting on someone else': 'Waiting on someone else',
  done: 'Done',
};

/** Who started a task: the optional "Origin" column. */
export const ORIGINS = ['you requested', 'inbound'] as const;
export type Origin = (typeof ORIGINS)[number];

export const ORIGIN_LABELS: Record<Origin, string> = {
  'you requested': 'You requested',
  inbound: 'Inbound',
};

/** Why delay would cost money: the optional "Delay-cost basis" column. A blank cell means "unknown". */
export const DELAY_COST_BASES = ['avoidable charge', 'deadline', 'opportunity', 'sunk or reference', 'unknown'] as const;
export type DelayCostBasis = (typeof DELAY_COST_BASES)[number];

/**
 * Whether the date in the Deadline column was checked against its source: the
 * optional "Date verified" column. "planning" marks a planning or check date.
 * A blank cell means "unknown".
 */
export const DATE_VERIFICATIONS = ['verified', 'planning', 'unknown'] as const;
export type DateVerification = (typeof DATE_VERIFICATIONS)[number];

export const COLUMNS = {
  id: 'Task ID',
  title: 'Task',
  status: 'Status',
  deadline: 'Deadline',
  lastUpdate: 'Last update',
  notes: 'Notes',
} as const;

/** Columns the dashboard uses when present, but doesn't require. */
export const OPTIONAL_COLUMNS = {
  links: 'Links',
  origin: 'Origin',
  moneyAtStake: 'Money at stake',
  progress: 'Progress',
  effort: 'Hands-on effort',
  basis: 'Delay-cost basis',
  expectedFinish: 'Expected finish incl. waits',
  dateVerification: 'Date verified',
} as const;

type Field = keyof typeof COLUMNS;
export type OptionalField = keyof typeof OPTIONAL_COLUMNS;
const FIELDS = Object.keys(COLUMNS) as Field[];
const OPTIONAL_FIELDS = Object.keys(OPTIONAL_COLUMNS) as OptionalField[];

/** Which optional columns the header row has. */
export type SheetColumns = Record<OptionalField, boolean>;

/** The free-text columns shown as labelled lines on each task, in display order. */
export const DETAIL_FIELDS = ['progress', 'moneyAtStake', 'effort', 'expectedFinish'] as const;

/** True when the sheet has a column that adds a labelled line (or the basis badge) to each task. */
export function hasDetailColumns(columns: SheetColumns): boolean {
  return columns.basis || DETAIL_FIELDS.some((field) => columns[field]);
}

/** The sheet range the dashboard reads; rows past it are invisible to the dashboard. */
export const LAST_ROW_READ = 1000;

export interface Task {
  /** Unique within one fetch, for rendering. The Task ID when it is unique. */
  key: string;
  /** Row number in the sheet (the header is row 1). */
  rowNumber: number;
  id: string;
  title: string;
  /** null when the cell is blank or holds something other than the four statuses. */
  status: Status | null;
  rawStatus: string;
  /**
   * The date written in the Deadline column. It is a recorded date: it may be a
   * planning or check date rather than an enforced deadline (see dateVerification).
   */
  deadline: CalendarDate | null;
  rawDeadline: string;
  lastUpdate: Date | null;
  rawLastUpdate: string;
  notes: string;
  /** Links to work delivered for the task (the optional "Links" column). */
  links: TaskLink[];
  rawLinks: string;
  /** Notes that start with "Ongoing" mark continuing work without a fixed date. */
  ongoing: boolean;
  /** null when the cell is blank or holds something other than the two origins. */
  origin: Origin | null;
  rawOrigin: string;
  /** Free text, shown as written. The dashboard never reads amounts or dates out of these. */
  moneyAtStake: string;
  progress: string;
  /** "Hands-on effort": the work the owner has to do, without waiting time. */
  effort: string;
  /** "Expected finish incl. waits": when the task should be finished, waiting included. */
  expectedFinish: string;
  /** "unknown" when the cell is blank; null when it holds something other than the five values. */
  basis: DelayCostBasis | null;
  rawBasis: string;
  /** "unknown" when the cell is blank; null when it holds something other than the three values. */
  dateVerification: DateVerification | null;
  rawDateVerification: string;
}

export type IssueKind =
  | 'missing-id'
  | 'duplicate-id'
  | 'missing-title'
  | 'missing-status'
  | 'unknown-status'
  | 'bad-deadline'
  | 'bad-last-update'
  | 'unknown-origin'
  | 'unknown-basis'
  | 'unknown-date-verification'
  | 'verified-without-date'
  | 'row-limit';

/** A problem with one row (or the sheet's size) that does not stop the dashboard. */
export interface DataIssue {
  kind: IssueKind;
  rowNumber: number | null;
  message: string;
}

export interface ParsedSheet {
  tasks: Task[];
  issues: DataIssue[];
  columns: SheetColumns;
}

/** The header row is unusable, so no rows can be trusted. */
export class SheetFormatError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[]) {
    super(message);
    this.name = 'SheetFormatError';
    this.details = details;
  }
}

const ONGOING = /^\s*ongoing\b/i;
/** Hyphen look-alikes that keyboards and autocorrect put in place of "-". */
const DASHES = /[‐-―−]/g;

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Headers also match when a hyphen was typed as another dash ("Hands–on effort"). */
function normalizeHeader(value: string): string {
  return normalizeLabel(value).replace(DASHES, '-');
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Exact match after ignoring letter case and extra spaces. No guessing from similar words. */
function parseOneOf<T extends string>(options: readonly T[], raw: string): T | null {
  const normalized = normalizeLabel(raw);
  return options.find((option) => option === normalized) ?? null;
}

export function parseStatus(raw: string): Status | null {
  return parseOneOf(STATUSES, raw);
}

/** "you requested" or "inbound" in any letter case. Anything else, including a blank cell, is null. */
export function parseOrigin(raw: string): Origin | null {
  return parseOneOf(ORIGINS, raw);
}

/** A blank cell counts as "unknown". Anything outside the five values is null. */
export function parseDelayCostBasis(raw: string): DelayCostBasis | null {
  return normalizeLabel(raw) === '' ? 'unknown' : parseOneOf(DELAY_COST_BASES, raw);
}

/** A blank cell counts as "unknown". Anything outside the three values is null. */
export function parseDateVerification(raw: string): DateVerification | null {
  return normalizeLabel(raw) === '' ? 'unknown' : parseOneOf(DATE_VERIFICATIONS, raw);
}

type ColumnIndexes = Record<Field, number> & Partial<Record<OptionalField, number>>;

function mapHeaders(headerRow: unknown[]): ColumnIndexes {
  const labels = headerRow.map((cell) => normalizeHeader(cellText(cell)));
  const problems: string[] = [];
  const indexes: Partial<ColumnIndexes> = {};

  const find = (name: string, required: boolean): number | undefined => {
    const wanted = normalizeHeader(name);
    const found = labels.flatMap((label, index) => (label === wanted ? [index] : []));
    if (found.length === 0) {
      if (required) problems.push(`Missing column: “${name}”.`);
    } else if (found.length > 1) {
      const where = found.map((index) => columnLetter(index)).join(' and ');
      problems.push(`“${name}” appears more than once (columns ${where}).`);
    } else {
      return found[0];
    }
    return undefined;
  };
  for (const field of FIELDS) indexes[field] = find(COLUMNS[field], true);
  for (const field of OPTIONAL_FIELDS) indexes[field] = find(OPTIONAL_COLUMNS[field], false);

  if (problems.length > 0) {
    const present = headerRow.map(cellText).filter(Boolean);
    problems.push(`Expected these headers in row 1: ${Object.values(COLUMNS).join(', ')}.`);
    problems.push(
      present.length > 0 ? `Row 1 currently has: ${present.join(', ')}.` : 'Row 1 is currently empty.',
    );
    throw new SheetFormatError('The header row of the Tasks tab does not match what the dashboard expects.', problems);
  }
  return indexes as ColumnIndexes;
}

/**
 * Turns the Sheets API `values` array into tasks.
 *
 * The API leaves out trailing empty cells (a row with no notes is one cell
 * shorter), so missing cells count as blank, and so does every cell of an
 * optional column the sheet does not have. Completely blank rows are skipped.
 * Rows with a bad status, deadline, timestamp, origin, basis or "Date
 * verified" value are kept and reported as issues rather than hidden.
 */
export function parseTaskSheet(values: unknown): ParsedSheet {
  if (!Array.isArray(values) || values.length === 0) {
    throw new SheetFormatError('The Tasks tab is empty.', [
      `Row 1 should hold these headers: ${Object.values(COLUMNS).join(', ')}.`,
    ]);
  }
  const rows = values.map((row) => (Array.isArray(row) ? (row as unknown[]) : []));
  const indexes = mapHeaders(rows[0] ?? []);
  const columns = Object.fromEntries(
    OPTIONAL_FIELDS.map((field) => [field, indexes[field] !== undefined]),
  ) as SheetColumns;
  const tasks: Task[] = [];
  const issues: DataIssue[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((cell) => cellText(cell) === '')) return;
    const cell = (field: Field | OptionalField) => {
      const index = indexes[field];
      return index === undefined ? '' : cellText(row[index]);
    };

    const id = cell('id');
    const title = cell('title');
    const rawStatus = cell('status');
    const rawDeadline = cell('deadline');
    const rawLastUpdate = cell('lastUpdate');
    const notes = cell('notes');
    const rawLinks = cell('links');
    const rawOrigin = cell('origin');
    const rawBasis = cell('basis');
    const rawDateVerification = cell('dateVerification');
    const label = id ? `Row ${rowNumber} (${id})` : `Row ${rowNumber}`;

    if (!id) issues.push({ kind: 'missing-id', rowNumber, message: `${label} has no Task ID.` });
    if (!title) issues.push({ kind: 'missing-title', rowNumber, message: `${label} has no task name.` });

    const status = parseStatus(rawStatus);
    if (!rawStatus) {
      issues.push({ kind: 'missing-status', rowNumber, message: `${label} has no status.` });
    } else if (!status) {
      issues.push({
        kind: 'unknown-status',
        rowNumber,
        message: `${label}: status “${rawStatus}” is not one of: ${STATUSES.join(', ')}.`,
      });
    }

    const deadline = rawDeadline ? parseCalendarDate(rawDeadline) : null;
    if (rawDeadline && !deadline) {
      issues.push({
        kind: 'bad-deadline',
        rowNumber,
        message: `${label}: deadline “${rawDeadline}” is not a date written as YYYY-MM-DD.`,
      });
    }

    const lastUpdate = rawLastUpdate ? parseTimestamp(rawLastUpdate) : null;
    if (rawLastUpdate && !lastUpdate) {
      issues.push({
        kind: 'bad-last-update',
        rowNumber,
        message: `${label}: last update “${rawLastUpdate}” is not a timestamp with a timezone offset (for example 2026-10-21T09:00:00+05:30).`,
      });
    }

    // A blank Origin is allowed (the task then counts as "origin missing"); a wrong one is reported.
    const origin = parseOrigin(rawOrigin);
    if (rawOrigin && !origin) {
      issues.push({
        kind: 'unknown-origin',
        rowNumber,
        message: `${label}: origin “${rawOrigin}” is not one of: ${ORIGINS.join(', ')}.`,
      });
    }

    const basis = parseDelayCostBasis(rawBasis);
    if (!basis) {
      issues.push({
        kind: 'unknown-basis',
        rowNumber,
        message: `${label}: delay-cost basis “${rawBasis}” is not one of: ${DELAY_COST_BASES.join(', ')}. It is ranked as unknown.`,
      });
    }

    const dateVerification = parseDateVerification(rawDateVerification);
    if (!dateVerification) {
      issues.push({
        kind: 'unknown-date-verification',
        rowNumber,
        message: `${label}: date verified “${rawDateVerification}” is not one of: ${DATE_VERIFICATIONS.join(', ')}. The date is treated as not verified.`,
      });
    } else if (dateVerification === 'verified' && !rawDeadline) {
      issues.push({
        kind: 'verified-without-date',
        rowNumber,
        message: `${label}: Date verified says “verified” but the Deadline cell is empty, so there is no date to rank by.`,
      });
    }

    tasks.push({
      key: '',
      rowNumber,
      id,
      title,
      status,
      rawStatus,
      deadline,
      rawDeadline,
      lastUpdate,
      rawLastUpdate,
      notes,
      links: parseLinks(rawLinks),
      rawLinks,
      ongoing: ONGOING.test(notes),
      origin,
      rawOrigin,
      moneyAtStake: cell('moneyAtStake'),
      progress: cell('progress'),
      effort: cell('effort'),
      expectedFinish: cell('expectedFinish'),
      basis,
      rawBasis,
      dateVerification,
      rawDateVerification,
    });
  });

  const rowsById = new Map<string, number[]>();
  for (const task of tasks) {
    if (task.id) rowsById.set(task.id, [...(rowsById.get(task.id) ?? []), task.rowNumber]);
  }
  for (const [id, rowNumbers] of rowsById) {
    if (rowNumbers.length > 1) {
      issues.push({
        kind: 'duplicate-id',
        rowNumber: rowNumbers[0] ?? null,
        message: `Task ID “${id}” is used on rows ${rowNumbers.join(', ')}. Each task needs its own ID.`,
      });
    }
  }
  for (const task of tasks) {
    const unique = task.id !== '' && rowsById.get(task.id)?.length === 1;
    task.key = unique ? `id:${task.id}` : `row:${task.rowNumber}`;
  }

  if (rows.length >= LAST_ROW_READ) {
    issues.push({
      kind: 'row-limit',
      rowNumber: null,
      message: `The dashboard reads rows 1–${LAST_ROW_READ} of the Tasks tab, and row ${LAST_ROW_READ} is in use, so tasks below it are not shown.`,
    });
  }

  issues.sort((a, b) => (a.rowNumber ?? Infinity) - (b.rowNumber ?? Infinity));
  return { tasks, issues, columns };
}
