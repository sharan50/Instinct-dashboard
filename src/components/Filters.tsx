import { useId } from 'react';
import type { SortOrder, StatusKey, View } from '../lib/filters.ts';
import { PROMOTION_WINDOW_DAYS } from '../lib/priority.ts';
import { OPTIONAL_COLUMNS, STATUS_LABELS, STATUSES, type SheetColumns } from '../lib/tasks.ts';

function statusLabel(key: StatusKey): string {
  return key === 'unknown' ? 'Needs a valid status' : STATUS_LABELS[key];
}

/** Status chips with counts. Active statuses start ticked; Done starts unticked. */
export function StatusFilter({
  counts,
  selected,
  onToggle,
}: {
  counts: Record<StatusKey, number>;
  selected: ReadonlySet<StatusKey>;
  onToggle: (key: StatusKey) => void;
}) {
  const keys: StatusKey[] = counts.unknown > 0 ? [...STATUSES, 'unknown'] : [...STATUSES];
  return (
    <fieldset className="status-filter">
      <legend>Show tasks that are</legend>
      <div className="chips">
        {keys.map((key) => (
          <label key={key} className={`chip chip--${key.replaceAll(' ', '-')}`}>
            <input
              type="checkbox"
              className="chip__input"
              checked={selected.has(key)}
              onChange={() => onToggle(key)}
              aria-label={`${statusLabel(key)}, ${counts[key]} ${counts[key] === 1 ? 'task' : 'tasks'}`}
            />
            <span className="chip__body" aria-hidden="true">
              <span className="chip__check" />
              <span className="chip__label">{statusLabel(key)}</span>
              <span className="chip__count">{counts[key]}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  return (
    <div className="search">
      <label htmlFor={id}>Search tasks and notes</label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="For example: refund"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
      />
    </div>
  );
}

/** Radio buttons drawn as one row of segments. The caller supplies the group around them. */
function Segments<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const name = useId();
  return (
    <>
      {options.map((option) => (
        <label key={option.value} className="view-switch__option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </>
  );
}

const VIEWS: readonly { value: View; label: string }[] = [
  { value: 'list', label: 'All tasks' },
  { value: 'deadlines', label: 'By date' },
  { value: 'you-requested', label: 'You requested' },
  { value: 'inbound', label: 'Inbound' },
];

/** All tasks, the date groups, and one view per origin. */
export function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <fieldset className="view-switch view-switch--views">
      <legend className="visually-hidden">View</legend>
      <Segments options={VIEWS} value={view} onChange={onChange} />
    </fieldset>
  );
}

const ORDERS: readonly { value: SortOrder; label: string }[] = [
  { value: 'priority', label: 'Financial priority' },
  { value: 'date', label: 'Recorded date' },
];

export function SortControl({ order, onChange }: { order: SortOrder; onChange: (order: SortOrder) => void }) {
  const labelId = useId();
  return (
    <div className="sort">
      <span id={labelId} className="sort__label">
        Sort by
      </span>
      <fieldset className="view-switch" aria-labelledby={labelId}>
        <Segments options={ORDERS} value={order} onChange={onChange} />
      </fieldset>
    </div>
  );
}

/**
 * The ordering rules in plain words, so the order can be checked against the
 * sheet, with what the order can't tell you: it is not a ranking by size.
 */
export function OrderExplainer({ columns }: { columns: SheetColumns }) {
  return (
    <details className="order-help">
      <summary>How Financial priority works</summary>
      <p>
        It uses only these cells of the sheet: <strong>{OPTIONAL_COLUMNS.basis}</strong>, <strong>Deadline</strong>{' '}
        (shown here as the recorded date), <strong>{OPTIONAL_COLUMNS.dateVerification}</strong> and whether the
        Status is done. It never reads amounts or dates out of Money at stake, Progress or other text, and an entry in
        Money at stake does not move a task up.
      </p>
      <ol>
        <li>Basis first: avoidable charge and deadline, then opportunity, then unknown or blank, then sunk or reference.</li>
        <li>
          Within each of those: verified dates first, earliest first; then planning or unknown dates, earliest first;
          then tasks with no date, in sheet order.
        </li>
        <li>
          One fixed rule: an opportunity task whose verified date is today or within the next {PROMOTION_WINDOW_DAYS}{' '}
          days goes above avoidable-charge and deadline tasks that have no verified date. A verified date that has
          passed does not move a task up: the task keeps its place among the opportunity tasks.
        </li>
        <li>Done tasks, when shown, come last.</li>
      </ol>
      <p>
        <strong>This is a fixed rule, not a judgement of how much is at stake.</strong> The dashboard cannot compare
        amounts, currencies or the real cost of an opportunity, so the order reflects only the basis label, the
        recorded date and whether that date is verified. The {PROMOTION_WINDOW_DAYS}-day window is an arbitrary fixed
        threshold.
      </p>
      <p>
        The basis and the dates are what the sheet says; the dashboard can’t check them. A recorded date may be a
        planning or check date, so only a date marked verified moves a task up, and neither a date nor a Money at
        stake entry proves a loss. When a verified date has passed, the dashboard does not know whether a consequence
        applies now.
      </p>
      {columns.basis ? null : (
        <p>
          The Tasks tab has no “{OPTIONAL_COLUMNS.basis}” column yet, so every task counts as basis unknown.
        </p>
      )}
      {columns.dateVerification ? null : (
        <p>
          The Tasks tab has no “{OPTIONAL_COLUMNS.dateVerification}” column yet, so no date counts as verified.
        </p>
      )}
      <p>
        <strong>Recorded date</strong> switches back to the earlier order: earliest recorded date first, tasks with
        no date last.
      </p>
    </details>
  );
}

/**
 * Tasks whose Origin is blank or not one of the two values are in neither
 * origin view. This keeps them visible as a count instead of dropping them.
 * The sentence after the count only appears where it is needed: in an origin
 * view (the tasks are not on screen there) or when the sheet has no Origin
 * column at all. Elsewhere the tasks carry an "Origin missing" badge.
 */
export function OriginNote({
  missing,
  hasColumn,
  inOriginView,
}: {
  missing: number;
  hasColumn: boolean;
  inOriginView: boolean;
}) {
  if (missing === 0) return null;
  let why: string | null = null;
  if (!hasColumn) why = 'The Tasks tab has no Origin column yet, so You requested and Inbound stay empty.';
  else if (inOriginView) why = 'Tasks without a valid Origin are in All tasks and By date, not in this view.';
  return (
    <p className="origin-note">
      <strong>
        Origin missing: {missing} {missing === 1 ? 'task' : 'tasks'}.
      </strong>
      {why ? ` ${why}` : null}
    </p>
  );
}
