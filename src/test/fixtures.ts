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

/** The required columns, Links, and the optional planning columns (see LIFE_HEADER for the rest). */
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

/** Every column the dashboard knows: FULL_HEADER plus Area, Start and Next step. */
export const LIFE_HEADER = [...FULL_HEADER, 'Area', 'Start', 'Next step'];

/** Long enough to be folded. The word "screwdriver" is in the folded part. */
export const LONG_NEXT_STEP =
  'Ask again on Friday, and if there is still no answer write to the managing agent with the photos of the latch, ' +
  'then borrow a screwdriver and fit a temporary catch.';

/**
 * Invented rows that use Area, Start and Next step, for the Today and Review
 * views. Dates assume "today" is 2026-10-21 (times shown in India).
 *
 * Today: Your move L02, L01. Next 7 days L04, L03, L11, L10. Chase L05, L06.
 * L07 is in none of the three; L08 has not started; L09 is done.
 * Review: L05 (two flags), L10, L04, L07.
 */
export function lifeValues(): string[][] {
  const stamp = '2026-10-20T09:00:00+05:30';
  const row = (
    id: string,
    title: string,
    status: string,
    deadline: string,
    lastUpdate: string,
    extra: { notes?: string; basis?: string; verified?: string; area?: string; start?: string; next?: string } = {},
  ) => [
    id,
    title,
    status,
    deadline,
    lastUpdate,
    extra.notes ?? '',
    '',
    '',
    '',
    '',
    '',
    extra.basis ?? '',
    '',
    extra.verified ?? '',
    extra.area ?? '',
    extra.start ?? '',
    extra.next ?? '',
  ];
  return [
    LIFE_HEADER,
    row('L01', 'Book the boiler service', 'waiting on you', '', stamp, {
      notes: 'The engineer prefers mornings.',
      area: 'Home',
      next: 'Ring the engineer for a slot',
    }),
    row('L02', 'Reply to the school trip form', 'waiting on you', '2026-10-23', stamp, {
      basis: 'deadline',
      verified: 'verified',
      area: 'Family',
      next: 'Sign it and hand it in',
    }),
    row('L03', 'Collect the dry cleaning', 'open', '2026-10-22', stamp, {
      verified: 'planning',
      area: 'Home',
      next: 'Pick it up after work',
    }),
    // A verified date, later than L03's planning date. No next step.
    row('L04', 'Renew the railcard', 'open', '2026-10-27', stamp, { verified: 'verified', area: 'Travel' }),
    // Waiting, no date, and quiet for 41 days.
    row('L05', 'Landlord to fix the gate latch', 'waiting on someone else', '', '2026-09-10T10:00:00+05:30', {
      area: 'Home',
      next: LONG_NEXT_STEP,
    }),
    // Waiting with a date well ahead. Its area is written in lower case.
    row('L06', 'Garage to send the invoice', 'waiting on someone else', '2026-11-15', '2026-10-14T10:00:00+05:30', {
      area: 'car',
      next: 'Wait for the email',
    }),
    // Not waiting on anyone, no date, no area.
    row('L07', 'Sort the photo albums', 'open', '', '2026-10-01T10:00:00+05:30', { next: 'Pick a weekend' }),
    // Cannot start yet.
    row('L08', 'Plan the spring allotment beds', 'open', '', stamp, {
      area: 'Garden',
      start: '2026-11-10',
      next: 'Order the seed catalogue',
    }),
    row('L09', 'Return the library books', 'done', '2026-10-10', stamp, { area: 'Home', next: 'Nothing left' }),
    // Started a week ago, and nobody recorded an update.
    row('L10', 'Swap the winter tyres', 'open', '2026-10-25', '', {
      area: 'Car',
      start: '2026-10-15',
      next: 'Book the garage',
    }),
    // Waiting on someone else, but with a date this week: listed under the date, not under Chase.
    row('L11', 'Chase the deposit refund', 'waiting on someone else', '2026-10-24', '2026-10-18T10:00:00+05:30', {
      area: 'Home',
      next: 'Check the bank statement',
    }),
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
    area: '',
    start: null,
    rawStart: '',
    nextStep: '',
    ...overrides,
  };
}
