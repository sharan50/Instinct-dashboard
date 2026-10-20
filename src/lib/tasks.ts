import { parseCalendarDate, parseTimestamp, type CalendarDate } from './dates.ts';

/**
 * The data contract with the "Tasks" tab of the tracker sheet.
 *
 * Header row: Task ID | Task | Status | Deadline | Last update | Notes.
 * Columns are found by header name, so their order in the sheet does not matter.
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

export const COLUMNS = {
  id: 'Task ID',
  title: 'Task',
  status: 'Status',
  deadline: 'Deadline',
  lastUpdate: 'Last update',
  notes: 'Notes',
} as const;

type Field = keyof typeof COLUMNS;
const FIELDS = Object.keys(COLUMNS) as Field[];

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
  deadline: CalendarDate | null;
  rawDeadline: string;
  lastUpdate: Date | null;
  rawLastUpdate: string;
  notes: string;
  /** Notes that start with "Ongoing" mark continuing work without a fixed date. */
  ongoing: boolean;
}

export type IssueKind =
  | 'missing-id'
  | 'duplicate-id'
  | 'missing-title'
  | 'missing-status'
  | 'unknown-status'
  | 'bad-deadline'
  | 'bad-last-update'
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

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
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

export function parseStatus(raw: string): Status | null {
  const normalized = normalizeLabel(raw);
  return STATUSES.find((status) => status === normalized) ?? null;
}

function mapHeaders(headerRow: unknown[]): Record<Field, number> {
  const labels = headerRow.map((cell) => normalizeLabel(cellText(cell)));
  const problems: string[] = [];
  const indexes: Partial<Record<Field, number>> = {};

  for (const field of FIELDS) {
    const wanted = normalizeLabel(COLUMNS[field]);
    const found = labels.flatMap((label, index) => (label === wanted ? [index] : []));
    if (found.length === 0) {
      problems.push(`Missing column: “${COLUMNS[field]}”.`);
    } else if (found.length > 1) {
      const where = found.map((index) => columnLetter(index)).join(' and ');
      problems.push(`“${COLUMNS[field]}” appears more than once (columns ${where}).`);
    } else {
      indexes[field] = found[0];
    }
  }

  if (problems.length > 0) {
    const present = headerRow.map(cellText).filter(Boolean);
    problems.push(`Expected these headers in row 1: ${Object.values(COLUMNS).join(', ')}.`);
    problems.push(
      present.length > 0 ? `Row 1 currently has: ${present.join(', ')}.` : 'Row 1 is currently empty.',
    );
    throw new SheetFormatError('The header row of the Tasks tab does not match what the dashboard expects.', problems);
  }
  return indexes as Record<Field, number>;
}

/**
 * Turns the Sheets API `values` array into tasks.
 *
 * The API leaves out trailing empty cells (a row with no notes is one cell
 * shorter), so missing cells count as blank. Completely blank rows are
 * skipped. Rows with a bad status, deadline or timestamp are kept and reported
 * as issues rather than hidden.
 */
export function parseTaskSheet(values: unknown): ParsedSheet {
  if (!Array.isArray(values) || values.length === 0) {
    throw new SheetFormatError('The Tasks tab is empty.', [
      `Row 1 should hold these headers: ${Object.values(COLUMNS).join(', ')}.`,
    ]);
  }
  const rows = values.map((row) => (Array.isArray(row) ? (row as unknown[]) : []));
  const columns = mapHeaders(rows[0] ?? []);
  const tasks: Task[] = [];
  const issues: DataIssue[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.every((cell) => cellText(cell) === '')) return;
    const cell = (field: Field) => cellText(row[columns[field]]);

    const id = cell('id');
    const title = cell('title');
    const rawStatus = cell('status');
    const rawDeadline = cell('deadline');
    const rawLastUpdate = cell('lastUpdate');
    const notes = cell('notes');
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
      ongoing: ONGOING.test(notes),
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
  return { tasks, issues };
}
