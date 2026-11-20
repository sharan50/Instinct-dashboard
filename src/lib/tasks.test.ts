import { describe, expect, it } from 'vitest';
import { FULL_HEADER, HEADER, planningValues, sampleValues } from '../test/fixtures.ts';
import {
  columnLetter,
  hasDetailColumns,
  OPTIONAL_COLUMNS,
  parseDateVerification,
  parseDelayCostBasis,
  parseOrigin,
  parseStatus,
  parseTaskSheet,
  SheetFormatError,
} from './tasks.ts';

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

  it('reads the optional Links column, and works without it', () => {
    const { tasks } = parseTaskSheet([
      [...HEADER, 'Links'],
      ['T1', 'With links', 'done', '', '', '', 'Comparison: https://example.org/c ; Old: https://example.org/o'],
      ['T2', 'Without links', 'open'],
    ]);
    expect(tasks[0]?.links).toEqual([
      { label: 'Comparison', href: 'https://example.org/c' },
      { label: 'Old', href: 'https://example.org/o' },
    ]);
    expect(tasks[1]?.links).toEqual([]);
    expect(parseTaskSheet(sampleValues()).tasks[0]?.links).toEqual([]);
  });

  it('explains a duplicated Links column', () => {
    expect(formatError([[...HEADER, 'Links', 'links']]).details).toContain('“Links” appears more than once (columns G and H).');
  });
});

describe('columnLetter', () => {
  it('converts indexes to sheet column letters', () => {
    expect([0, 5, 25, 26, 27, 701, 702].map(columnLetter)).toEqual(['A', 'F', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
  });
});

describe('optional columns', () => {
  const NONE = {
    links: false,
    origin: false,
    moneyAtStake: false,
    progress: false,
    effort: false,
    basis: false,
    expectedFinish: false,
    dateVerification: false,
  };

  it('works with none of them: every new field is blank or at its default', () => {
    const { tasks, issues, columns } = parseTaskSheet(sampleValues());
    expect(columns).toEqual(NONE);
    expect(hasDetailColumns(columns)).toBe(false);
    expect(issues).toEqual([]);
    for (const task of tasks) {
      expect(task).toMatchObject({
        origin: null,
        rawOrigin: '',
        moneyAtStake: '',
        progress: '',
        effort: '',
        expectedFinish: '',
        basis: 'unknown',
        rawBasis: '',
        dateVerification: 'unknown',
        rawDateVerification: '',
      });
    }
  });

  it('reads all of them when the sheet has them', () => {
    const { tasks, columns } = parseTaskSheet(planningValues());
    expect(columns).toEqual({
      links: true,
      origin: true,
      moneyAtStake: true,
      progress: true,
      effort: true,
      basis: true,
      expectedFinish: true,
      dateVerification: true,
    });
    expect(tasks[0]).toMatchObject({
      id: 'P01',
      status: 'open',
      deadline: { iso: '2026-10-24' },
      origin: 'you requested',
      moneyAtStake: 'Late-return fee for each extra day',
      progress: 'Return slot booked.',
      effort: '20 minutes',
      basis: 'avoidable charge',
      expectedFinish: 'This Saturday',
      dateVerification: 'unknown',
    });
    expect(tasks[2]).toMatchObject({ id: 'P03', basis: 'opportunity', dateVerification: 'verified' });
    // Task IDs and Links keep working next to the new columns.
    expect(tasks.map((t) => t.key)).toEqual(['id:P01', 'id:P02', 'id:P03', 'id:P04', 'id:P05', 'id:P06', 'id:P07', 'id:P08']);
    expect(tasks[2]?.links).toEqual([{ label: 'Form', href: 'https://example.org/club/form' }]);
  });

  it('finds each one by header name: any order, any subset, any letter case', () => {
    const { tasks, columns } = parseTaskSheet([
      // Only three of the optional columns, mixed in with the required ones, and no Links column.
      ['PROGRESS', 'Task ID', 'date  verified', 'Task', 'Status', 'Deadline', 'Last update', 'Notes', 'delay-cost BASIS'],
      ['Halfway there', 'A1', 'Verified', 'First', 'open', '2026-11-02', '', '', 'Deadline'],
      // The Sheets API drops trailing empty cells, so this row simply ends early.
      ['', 'A2', '', 'Second', 'open'],
    ]);
    expect(columns).toEqual({ ...NONE, progress: true, dateVerification: true, basis: true });
    expect(hasDetailColumns(columns)).toBe(true);
    expect(tasks[0]).toMatchObject({
      id: 'A1',
      title: 'First',
      progress: 'Halfway there',
      dateVerification: 'verified',
      basis: 'deadline',
      origin: null,
      moneyAtStake: '',
      effort: '',
      expectedFinish: '',
      links: [],
    });
    expect(tasks[1]).toMatchObject({ id: 'A2', progress: '', dateVerification: 'unknown', basis: 'unknown' });
  });

  it('reads a column beyond column M', () => {
    // 14 headers: the last one, Date verified, is column N.
    expect(FULL_HEADER).toHaveLength(14);
    expect(columnLetter(FULL_HEADER.indexOf(OPTIONAL_COLUMNS.dateVerification))).toBe('N');
    const { tasks } = parseTaskSheet(planningValues());
    expect(tasks.find((t) => t.id === 'P07')?.dateVerification).toBe('verified');
  });

  it('accepts a header typed with another kind of dash', () => {
    const { columns } = parseTaskSheet([[...HEADER, 'Hands\u2013on effort', 'Delay\u2011cost basis'], ['T1', 'A', 'open']]);
    expect(columns).toMatchObject({ effort: true, basis: true });
  });

  it('does not mistake a similar header for one of them', () => {
    const { tasks, columns } = parseTaskSheet([
      [...HEADER, 'Origins', 'Progress %', 'Money', 'Verified'],
      ['T1', 'A', 'open', '', '', '', 'inbound', '50', '12', 'verified'],
    ]);
    expect(columns).toEqual(NONE);
    expect(tasks[0]).toMatchObject({ origin: null, progress: '', moneyAtStake: '', dateVerification: 'unknown' });
  });

  it('explains a duplicated optional column', () => {
    expect(formatError([[...HEADER, 'Origin', 'Progress', 'origin']]).details).toContain(
      '“Origin” appears more than once (columns G and I).',
    );
  });

  it('keeps free text exactly as written and never reads a date or amount out of it', () => {
    const money = 'About 120 if not cancelled before 2026-10-01; see https://example.org/terms';
    const { tasks, issues } = parseTaskSheet([
      [...HEADER, 'Money at stake', 'Progress', 'Hands-on effort', 'Expected finish incl. waits'],
      ['T1', 'A', 'open', '', '', '', money, 'Line one\nLine two', '<b>2 hours</b>', 'By 2026-10-05, overdue otherwise'],
    ]);
    expect(tasks[0]).toMatchObject({
      moneyAtStake: money,
      progress: 'Line one\nLine two',
      effort: '<b>2 hours</b>',
      expectedFinish: 'By 2026-10-05, overdue otherwise',
      // The dates in the text are not the task's date: only the Deadline cell is.
      deadline: null,
      rawDeadline: '',
    });
    expect(issues).toEqual([]);
  });
});

describe('Origin', () => {
  it('accepts exactly the two values, in any letter case', () => {
    expect(parseOrigin('you requested')).toBe('you requested');
    expect(parseOrigin('You Requested')).toBe('you requested');
    expect(parseOrigin('  INBOUND ')).toBe('inbound');
    expect(parseOrigin('')).toBeNull();
    for (const other of ['requested', 'you', 'inbound email', 'in bound', 'outbound', 'you requested?', 'yes']) {
      expect(parseOrigin(other), other).toBeNull();
    }
  });

  it('reports a wrong value as a problem, keeps the row, and leaves a blank cell alone', () => {
    const { tasks, issues } = parseTaskSheet([
      [...HEADER, 'Origin'],
      ['T1', 'A', 'open', '', '', '', 'Inbound'],
      ['T2', 'B', 'open', '', '', '', 'vendor'],
      ['T3', 'C', 'open'],
    ]);
    expect(tasks.map((t) => [t.origin, t.rawOrigin])).toEqual([
      ['inbound', 'Inbound'],
      [null, 'vendor'],
      [null, ''],
    ]);
    expect(issues).toEqual([
      { kind: 'unknown-origin', rowNumber: 3, message: 'Row 3 (T2): origin “vendor” is not one of: you requested, inbound.' },
    ]);
  });
});

describe('Delay-cost basis', () => {
  it('accepts the five values, and a blank cell means unknown', () => {
    expect(parseDelayCostBasis('Avoidable charge')).toBe('avoidable charge');
    expect(parseDelayCostBasis('deadline')).toBe('deadline');
    expect(parseDelayCostBasis('OPPORTUNITY')).toBe('opportunity');
    expect(parseDelayCostBasis('sunk  or reference')).toBe('sunk or reference');
    expect(parseDelayCostBasis('unknown')).toBe('unknown');
    expect(parseDelayCostBasis('')).toBe('unknown');
    expect(parseDelayCostBasis('   ')).toBe('unknown');
  });

  it('reports anything else and ranks it as unknown', () => {
    for (const other of ['charge', 'sunk', 'urgent', 'deadline 2026-11-01', 'avoidable charge!']) {
      expect(parseDelayCostBasis(other), other).toBeNull();
    }
    const { tasks, issues } = parseTaskSheet([[...HEADER, 'Delay-cost basis'], ['T1', 'A', 'open', '', '', '', 'fine']]);
    expect(tasks[0]).toMatchObject({ basis: null, rawBasis: 'fine' });
    expect(issues).toEqual([
      {
        kind: 'unknown-basis',
        rowNumber: 2,
        message:
          'Row 2 (T1): delay-cost basis “fine” is not one of: avoidable charge, deadline, opportunity, sunk or reference, unknown. It is ranked as unknown.',
      },
    ]);
  });
});

describe('Date verified', () => {
  it('accepts the three values, and a blank cell means unknown', () => {
    expect(parseDateVerification('verified')).toBe('verified');
    expect(parseDateVerification(' Planning ')).toBe('planning');
    expect(parseDateVerification('UNKNOWN')).toBe('unknown');
    expect(parseDateVerification('')).toBe('unknown');
  });

  it('never treats anything else as verified', () => {
    for (const other of ['yes', 'true', 'confirmed', 'verified?', 'not verified', 'unverified', 'verified by phone', '✓']) {
      expect(parseDateVerification(other), other).toBeNull();
    }
    const { tasks, issues } = parseTaskSheet([
      [...HEADER, 'Date verified'],
      ['T1', 'A', 'open', '2026-11-01', '', '', 'yes'],
    ]);
    expect(tasks[0]).toMatchObject({ dateVerification: null, rawDateVerification: 'yes' });
    expect(issues).toEqual([
      {
        kind: 'unknown-date-verification',
        rowNumber: 2,
        message:
          'Row 2 (T1): date verified “yes” is not one of: verified, planning, unknown. The date is treated as not verified.',
      },
    ]);
  });

  it('points out a "verified" that has no date to go with it', () => {
    const { issues } = parseTaskSheet([
      [...HEADER, 'Date verified'],
      ['T1', 'A', 'open', '', '', '', 'verified'],
      ['T2', 'B', 'open', '2026-11-01', '', '', 'verified'],
      ['T3', 'C', 'open', '', '', '', 'planning'],
    ]);
    expect(issues).toEqual([
      {
        kind: 'verified-without-date',
        rowNumber: 2,
        message: 'Row 2 (T1): Date verified says “verified” but the Deadline cell is empty, so there is no date to rank by.',
      },
    ]);
  });
});
