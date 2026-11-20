import { addDays, daysBetween, type CalendarDate } from './dates.ts';
import type { Task } from './tasks.ts';

/**
 * "Add to calendar": a plain link that opens Google Calendar with an all-day
 * event for the task's recorded date already filled in. The dashboard itself
 * has no calendar permission and sends nothing: the task's name only reaches
 * Google Calendar when the link is followed, and the event is saved only if
 * the person then presses Save there.
 */

/** Offered only where a reminder is plainly useful: a verified date, today or later, on a task that is not done. */
export function offersCalendarLink(task: Task, today: CalendarDate): boolean {
  return (
    task.deadline !== null &&
    task.status !== 'done' &&
    task.dateVerification === 'verified' &&
    daysBetween(today, task.deadline) >= 0
  );
}

const compact = (date: CalendarDate) => date.iso.replaceAll('-', '');

/** The link, or null for a task with no usable date. */
export function calendarUrl(task: Task): string | null {
  if (!task.deadline) return null;
  const name = task.title || task.id || `Task on row ${task.rowNumber}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: name,
    // An all-day event: from the recorded date up to, not including, the next day.
    dates: `${compact(task.deadline)}/${compact(addDays(task.deadline, 1))}`,
    details: task.id ? `Task ${task.id} in the task tracker.` : 'From the task tracker.',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
