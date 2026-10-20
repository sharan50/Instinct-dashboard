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
