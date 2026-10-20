import { useId } from 'react';
import type { StatusKey } from '../lib/filters.ts';
import { STATUS_LABELS, STATUSES } from '../lib/tasks.ts';

export type View = 'list' | 'deadlines';

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

export function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const name = useId();
  const options: { value: View; label: string }[] = [
    { value: 'list', label: 'All tasks' },
    { value: 'deadlines', label: 'Deadlines' },
  ];
  return (
    <fieldset className="view-switch">
      <legend className="visually-hidden">View</legend>
      {options.map((option) => (
        <label key={option.value} className="view-switch__option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={view === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
