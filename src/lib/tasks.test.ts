import { describe, expect, it } from 'vitest';
import { HEADER, sampleValues } from '../test/fixtures.ts';
import { columnLetter, parseStatus, parseTaskSheet, SheetFormatError } from './tasks.ts';

function formatError(values: unknown): SheetFormatError {
  try {
    parseTaskSheet(values);
  } catch (error) {
    if (error instanceof SheetFormatError) return error;
    throw error;
  }
  throw new Error('expected a SheetFormatError');
}

describe('parseTaskSheet', () => {
  it('reads every row of the sample tracker', () => {
    const { tasks, issues } = parseTaskSheet(sampleValues());
    expect(issues).toEqual([]);
    expect(tasks.map((t) => t.id)).toEqual(['T001', 'T002', 'T003', 'T004', 'T005', 'T006']);
    expect(tasks[0]).toMatchObject({
      key: 'id:T001',
      rowNumber: 2,
      title: 'Renew library card',
      status: 'open',
      deadline: { iso: '2026-10-29' },
      ongoing: false,
    });
    expect(tasks[0]?.lastUpdate?.toISOString()).toBe('2026-10-21T03:45:00.000Z');
    expect(tasks[1]?.deadline).toBeNull();
    expect(tasks[4]?.ongoing).toBe(true);
  });

  it('pads rows whose trailing cells are missing', () => {
    const { tasks } = parseTaskSheet([HEADER, ['T1', 'Short row', 'open']]);
    expect(tasks[0]).toMatchObject({ deadline: null, rawDeadline: '', lastUpdate: null, rawLastUpdate: '', notes: '' });
    expect(parseTaskSheet(sampleValues()).tasks[5]?.notes).toBe('');
  });

  it('ignores completely blank rows', () => {
    const { tasks, issues } = parseTaskSheet([HEADER, [], ['', '  ', ''], ['T1', 'Real task', 'open'], ['']]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.rowNumber).toBe(4);
    expect(issues).toEqual([]);
  });

  it('maps columns by header name, in any order and letter case', () => {
    const { tasks } = parseTaskSheet([
      ['notes', ' STATUS ', 'Task  ID', 'Last update', 'Task', 'Deadline'],
      ['Some notes', 'Waiting on someone else', 'X9', '2026-10-21T09:00:00Z', 'Reordered', '2026-12-01'],
    ]);
    expect(tasks[0]).toMatchObject({
      id: 'X9',
      title: 'Reordered',
      status: 'waiting on someone else',
      notes: 'Some notes',
      deadline: { iso: '2026-12-01' },
    });
  });

  it('explains missing headers', () => {
    const error = formatError([['Task ID', 'Task', 'Status', 'Due', 'Last update', 'Notes'], ['T1', 'A', 'open']]);
    expect(error.message).toMatch(/header row/i);
    expect(error.details[0]).toBe('Missing column: “Deadline”.');
    expect(error.details.join(' ')).toContain('Row 1 currently has: Task ID, Task, Status, Due, Last update, Notes.');
  });

  it('explains duplicate headers', () => {
    const error = formatError([['Task ID', 'Task', 'Status', 'Deadline', 'Status', 'Notes']]);
    expect(error.details).toContain('“Status” appears more than once (columns C and E).');
    expect(error.details).toContain('Missing column: “Last update”.');
  });

  it('explains an empty tab', () => {
    expect(formatError([]).message).toMatch(/empty/i);
    expect(formatError(undefined).message).toMatch(/empty/i);
    expect(formatError([[]]).details.join(' ')).toContain('Row 1 is currently empty.');
  });

  it('accepts the four statuses in any letter case and flags anything else', () => {
    expect(parseStatus('Done')).toBe('done');
    expect(parseStatus(' waiting  on YOU ')).toBe('waiting on you');
    expect(parseStatus('blocked')).toBeNull();

    const { tasks, issues } = parseTaskSheet([HEADER, ['T1', 'A', 'Blocked'], ['T2', 'B', '']]);
    expect(tasks.map((t) => t.status)).toEqual([null, null]);
    expect(tasks[0]?.rawStatus).toBe('Blocked');
    expect(issues.map((i) => i.kind)).toEqual(['unknown-status', 'missing-status']);
    expect(issues[0]?.message).toBe(
      'Row 2 (T1): status “Blocked” is not one of: open, waiting on you, waiting on someone else, done.',
    );
  });

  it('keeps rows with an unreadable deadline or timestamp and reports them', () => {
    const { tasks, issues } = parseTaskSheet([
      HEADER,
      ['T1', 'A', 'open', '29/10/2026', '2026-10-21 09:00'],
      ['T2', 'B', 'open', '2026-02-30', '2026-10-21T09:00:00+05:30'],
    ]);
    expect(tasks[0]).toMatchObject({ deadline: null, rawDeadline: '29/10/2026', lastUpdate: null, rawLastUpdate: '2026-10-21 09:00' });
    expect(issues.map((i) => [i.kind, i.rowNumber])).toEqual([
      ['bad-deadline', 2],
      ['bad-last-update', 2],
      ['bad-deadline', 3],
    ]);
  });

  it('reports missing and duplicate Task IDs but still gives every row a unique key', () => {
    const { tasks, issues } = parseTaskSheet([
      HEADER,
      ['T1', 'First', 'open'],
      ['', 'No ID', 'open'],
      ['T1', 'Copy', 'done'],
      ['T2', '', 'open'],
    ]);
    expect(tasks.map((t) => t.key)).toEqual(['row:2', 'row:3', 'row:4', 'id:T2']);
    expect(issues.map((i) => i.kind)).toEqual(['duplicate-id', 'missing-id', 'missing-title']);
    expect(issues[0]?.message).toBe('Task ID “T1” is used on rows 2, 4. Each task needs its own ID.');
  });

  it('warns when the read range is full', () => {
    const rows = [HEADER, ...Array.from({ length: 999 }, (_, i) => [`T${i}`, 'Task', 'open'])];
    const { tasks, issues } = parseTaskSheet(rows);
    expect(tasks).toHaveLength(999);
    expect(issues.at(-1)?.kind).toBe('row-limit');
  });

  it('copes with non-text cells', () => {
    const { tasks } = parseTaskSheet([HEADER, [42, true, 'open', null, undefined, { odd: 1 }]]);
    expect(tasks[0]).toMatchObject({ id: '42', title: 'true', notes: '' });
  });

  it('treats only notes that start with "Ongoing" as ongoing work', () => {
    const { tasks } = parseTaskSheet([
      HEADER,
      ['T1', 'A', 'open', '', '', 'Ongoing: weekly check'],
      ['T2', 'B', 'open', '', '', '  ongoing - daily'],
      ['T3', 'C', 'open', '', '', 'Setup of ongoing updates is in progress'],
      ['T4', 'D', 'open', '', '', 'Ongoingness'],
    ]);
    expect(tasks.map((t) => t.ongoing)).toEqual([true, true, false, false]);
  });
});

describe('columnLetter', () => {
  it('converts indexes to sheet column letters', () => {
    expect([0, 5, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'F', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});
