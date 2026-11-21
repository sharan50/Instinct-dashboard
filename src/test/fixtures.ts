import type { Task } from '../lib/tasks.ts';

/**
 * Generic sample rows for tests. Deliberately invented: never copy real
 * tracker rows into tests or fixtures.
 */
export const HEADER = ['Task ID', 'Task', 'Status', 'Deadline', 'Last update', 'Notes'];

export function sampleValues(): string[][] {
  return [
    HEADER,
    ['T001', 'Renew library card', 'open', '2026-10-29', '2026-10-21T09:15:00+05:30', 'Bring proof of address. Hours: https://example.org/library/hours.'],
    ['T002', 'Book dentist check-up', 'waiting on you', '', '2026-10-20T18:00:00+01:00', 'Choose a morning slot.'],
    ['T003', 'Plumber quote for kitchen tap', 'waiting on someone else', '2026-10-18', '2026-10-19T12:00:00Z', 'Asked for a quote on Monday.'],
    ['T004', 'Return borrowed camera', 'done', '2026-10-15', '2026-10-16T08:00:00+05:30', 'Returned in person.'],
    ['T005', 'Water the balcony plants', 'open', '', '2026-10-21T07:00:00+05:30', 'Ongoing: every Sunday morning.'],
    // No notes: the Sheets API leaves out trailing empty cells.
    ['T006', 'Order new passport photos', 'waiting on you', '2026-11-30', '2026-10-21T09:00:00+05:30'],
  ];
}

/** Every column the dashboard knows: the required ones, Links, and the optional planning columns. */
export const FULL_HEADER = [
  ...HEADER,
  'Links',
  'Origin',
  'Money at stake',
  'Progress',
  'Hands-on effort',
  'Delay-cost basis',
  'Expected finish incl. waits',
  'Date verified',
];

/** Long enough to be folded behind "Show full text". The word "pencil" and the link are in the folded part. */
export const LONG_PROGRESS =
  'Form downloaded and filled in. Waiting for the committee secretary to countersign it before it can be posted, ' +
  'which only happens at the monthly meeting. Checklist: https://example.org/club/checklist and bring a pencil.';

/**
 * Invented rows that use the optional columns. Dates assume "today" is
 * 2026-10-21. In Financial priority order the active rows read
 * P07, P03, P01, P02, P04, P05, P06; by recorded date they read
 * P05, P04, P03, P01, P07, P02, P06.
 */
export function planningValues(): string[][] {
  const stamp = '2026-10-21T09:00:00+05:30';
  return [
    FULL_HEADER,
    // Top tier, date not verified: the "recorded date in 3 days (not verified)" case.
    ['P01', 'Return the rented ladder', 'open', '2026-10-24', stamp, 'Take the receipt.', '', 'you requested', 'Late-return fee for each extra day', 'Return slot booked.', '20 minutes', 'avoidable charge', 'This Saturday', ''],
    // Top tier, no date at all.
    ['P02', 'Cancel the unused gym trial', 'waiting on you', '', stamp, '', '', 'Inbound', 'Monthly fee if it renews', '', '5 minutes', 'Avoidable charge', '', ''],
    // Next tier, but its verified date is 2 days away: moved above top-tier tasks without a verified date.
    ['P03', 'Send the club membership form', 'waiting on someone else', '2026-10-23', stamp, '', 'Form: https://example.org/club/form', 'you requested', '', LONG_PROGRESS, '', 'opportunity', 'End of next week', 'verified'],
    // Next tier, date tomorrow but only a planning date: not moved up. Origin left blank.
    ['P04', 'Compare bike insurance quotes', 'open', '2026-10-22', stamp, '', '', '', 'Possible saving at renewal', 'Two quotes in.', 'About 1 hour', 'opportunity', 'Early November', 'planning'],
    // No basis, a past date that nobody verified, and an Origin that is not one of the two values.
    ['P05', 'File the appliance warranty card', 'open', '2026-10-19', stamp, '', '', 'vendor', '', '', '', '', '', ''],
    ['P06', 'Archive last year’s receipts', 'open', '', stamp, '', '', 'inbound', 'Already paid', 'Half of them scanned.', '2 hours', 'sunk or reference', '', ''],
    // Top tier with a verified date a month away.
    ['P07', 'Renew the parking permit', 'open', '2026-11-20', stamp, '', '', 'inbound', 'Permit lapses after the date', '', '10 minutes', 'deadline', '', 'verified'],
    ['P08', 'Return the borrowed drill', 'done', '2026-10-15', stamp, '', '', 'you requested', '', 'Returned.', '', 'avoidable charge', '', 'verified'],
  ];
}

/** A task with every field blank or at its default, for tests that build tasks by hand. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    key: `id:${overrides.id ?? 'X'}`,
    rowNumber: 2,
    id: 'X',
    title: 'Task',
    status: 'open',
    rawStatus: 'open',
    deadline: null,
    rawDeadline: '',
    lastUpdate: null,
    rawLastUpdate: '',
    notes: '',
    links: [],
    rawLinks: '',
    ongoing: false,
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
    ...overrides,
  };
}
