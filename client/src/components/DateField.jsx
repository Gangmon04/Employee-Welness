import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useClickOutside } from './useClickOutside.js';
import { usePortalPop } from './usePortalPop.js';
import './DateField.css';

/*
 * DateField — exact DatePicker component from My Desk Controls:
 * 292px calendar popup with three zoom levels (days → 12-month grid → 12-year grid).
 * The title button zooms out; prev/next adapt per level (month / year / 12 years);
 * "Today" resets.
 *
 * value: Date | null · onChange(Date)
 */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const DOWS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const sameDay = (a, b) =>
  a && b &&
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const cx = (...parts) => parts.filter(Boolean).join(' ');

export default function DateField({
  value = null,
  onChange,
  placeholder = 'Select a date',
  disabled = false,
  locked = false,
  error = false,
  isBusy = null,
  busyHint = '● has appointments',
  formatValue = null,
  minDate = null,
  maxDate = null,
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('day'); // day | month | year
  const initial = value || new Date();
  const [month, setMonth] = useState(initial.getMonth());
  const [year, setYear] = useState(initial.getFullYear());
  const rootRef = useRef(null);
  const popRef = useRef(null);

  const popStyle = usePortalPop(rootRef, open, { matchWidth: false, popWidth: 292, estimatedHeight: 360 });
  useClickOutside([rootRef, popRef], () => { setOpen(false); setMode('day'); }, open);

  // Sync month & year when value changes from outside
  useEffect(() => {
    if (value) {
      setMonth(value.getMonth());
      setYear(value.getFullYear());
    }
  }, [value]);

  const interactive = !disabled && !locked;
  const today = new Date();

  const label = value
    ? (formatValue
      ? formatValue(value)
      : `${value.getDate()} ${MONTHS[value.getMonth()].slice(0, 3)} ${value.getFullYear()}`)
    : '';

  const openCalendar = () => {
    if (!interactive) return;
    const base = value || new Date();
    setMonth(base.getMonth());
    setYear(base.getFullYear());
    setMode('day');
    setOpen(true);
  };

  const toggle = () => {
    if (!interactive) return;
    if (open) {
      setOpen(false);
      setMode('day');
      return;
    }
    openCalendar();
  };

  const pickDay = (n) => {
    onChange?.(new Date(year, month, n));
    setOpen(false);
    setMode('day');
  };

  const prev = () => {
    if (mode === 'day') {
      if (month === 0) {
        setMonth(11);
        setYear((y) => y - 1);
      } else {
        setMonth((m) => m - 1);
      }
    } else if (mode === 'month') {
      setYear((y) => y - 1);
    } else {
      setYear((y) => y - 12);
    }
  };

  const next = () => {
    if (mode === 'day') {
      if (month === 11) {
        setMonth(0);
        setYear((y) => y + 1);
      } else {
        setMonth((m) => m + 1);
      }
    } else if (mode === 'month') {
      setYear((y) => y + 1);
    } else {
      setYear((y) => y + 12);
    }
  };

  const zoomOut = () => setMode(mode === 'day' ? 'month' : mode === 'month' ? 'year' : 'day');

  // Mon-first 6x7 grid
  const firstDow = new Date(year, month, 1).getDay();
  const lead = (firstDow + 6) % 7;
  const len = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, i) => {
    const n = i - lead + 1;
    return n >= 1 && n <= len ? n : null;
  });

  const minD = minDate ? new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()) : null;
  const maxD = maxDate ? new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate()) : null;

  const outOfRange = (d) => {
    if (minD && d < minD) return true;
    if (maxD && d > maxD) return true;
    return false;
  };

  const canPrev = () => {
    if (!minD) return true;
    if (mode === 'day') {
      return new Date(year, month, 0) >= minD;
    }
    if (mode === 'month') {
      return new Date(year - 1, 11, 31) >= minD;
    }
    if (mode === 'year') {
      return new Date(yearStart - 1, 11, 31) >= minD;
    }
    return true;
  };

  const canNext = () => {
    if (!maxD) return true;
    if (mode === 'day') {
      return new Date(year, month + 1, 1) <= maxD;
    }
    if (mode === 'month') {
      return new Date(year + 1, 0, 1) <= maxD;
    }
    if (mode === 'year') {
      return new Date(yearStart + 12, 0, 1) <= maxD;
    }
    return true;
  };

  const yearStart = year - (year % 12);
  const heading = mode === 'day'
    ? `${MONTHS[month]} ${year}`
    : mode === 'month' ? String(year) : `${yearStart} – ${yearStart + 11}`;

  const goToday = () => {
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    if (outOfRange(todayMidnight)) return;
    setMonth(today.getMonth());
    setYear(today.getFullYear());
    setMode('day');
    onChange?.(todayMidnight);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="ctl-root-wrap" style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        className={cx(
          'ctl-shell',
          error && 'ctl-shell--error',
          disabled && 'ctl-shell--disabled',
          locked && 'ctl-shell--locked',
        )}
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className={cx('ctl-shell-value', !value && 'ctl-shell-value--placeholder')}>
          {value ? label : placeholder}
        </span>
        <i className={`ti ${locked ? 'ti-lock' : 'ti-calendar'} ctl-caret`} aria-hidden="true" />
      </button>

      {open && createPortal(
        <div className="ctl-pop ctl-dp-pop" style={popStyle} role="dialog" aria-label="Choose a date" ref={popRef}>
          <div className="ctl-dp-head">
            <button
              type="button"
              className="ctl-dp-nav"
              onClick={prev}
              disabled={!canPrev()}
              title={mode === 'day' ? 'Previous month' : mode === 'month' ? 'Previous year' : 'Earlier years'}
            >
              <i className="ti ti-chevron-left" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={cx('ctl-dp-title', mode !== 'day' && 'ctl-dp-title--zoomed')}
              onClick={zoomOut}
              title={mode === 'day' ? 'Pick a month' : mode === 'month' ? 'Pick a year' : 'Back to days'}
            >
              {heading}
              <i className={`ti ${mode === 'year' ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="ctl-dp-nav"
              onClick={next}
              disabled={!canNext()}
              title={mode === 'day' ? 'Next month' : mode === 'month' ? 'Next year' : 'Later years'}
            >
              <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          </div>

          {mode === 'day' && (
            <div className="ctl-dp-daygrid">
              {DOWS.map((d) => (
                <span className="ctl-dp-dow" key={d}>{d}</span>
              ))}
              {cells.map((n, i) => {
                if (n == null) {
                  return <button type="button" key={i} className="ctl-dp-day ctl-dp-day--blank" tabIndex={-1} />;
                }
                const date = new Date(year, month, n);
                const isSel = sameDay(date, value);
                const isToday = sameDay(date, today);
                const disabledDay = outOfRange(date);
                const busy = !isSel && typeof isBusy === 'function' && isBusy(date);
                return (
                  <button
                    type="button"
                    key={i}
                    disabled={disabledDay}
                    className={cx('ctl-dp-day', isSel && 'ctl-dp-day--selected', !isSel && isToday && 'ctl-dp-day--today', disabledDay && 'ctl-dp-day--disabled')}
                    onClick={() => pickDay(n)}
                  >
                    {n}
                    {busy && <span className="ctl-dp-day-dot" />}
                  </button>
                );
              })}
            </div>
          )}

          {mode === 'month' && (
            <div className="ctl-dp-grid3">
              {MONTHS.map((m, i) => {
                const endOfMonth = new Date(year, i + 1, 0);
                const startOfMonth = new Date(year, i, 1);
                const disabledMonth = (minD && endOfMonth < minD) || (maxD && startOfMonth > maxD);
                return (
                  <button
                    type="button"
                    key={m}
                    disabled={disabledMonth}
                    className={cx('ctl-dp-cell', i === month && 'ctl-dp-cell--selected', disabledMonth && 'ctl-dp-cell--disabled')}
                    onClick={() => { setMonth(i); setMode('day'); }}
                  >
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          )}

          {mode === 'year' && (
            <div className="ctl-dp-grid3">
              {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => {
                const endOfYear = new Date(y, 11, 31);
                const startOfYear = new Date(y, 0, 1);
                const disabledYear = (minD && endOfYear < minD) || (maxD && startOfYear > maxD);
                return (
                  <button
                    type="button"
                    key={y}
                    disabled={disabledYear}
                    className={cx('ctl-dp-cell', y === year && 'ctl-dp-cell--selected', disabledYear && 'ctl-dp-cell--disabled')}
                    onClick={() => { setYear(y); setMode('month'); }}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          )}

          <div className="ctl-dp-foot">
            <button
              type="button"
              className="ctl-dp-today-link"
              disabled={outOfRange(new Date(today.getFullYear(), today.getMonth(), today.getDate()))}
              onClick={goToday}
            >
              Today
            </button>
            <span className="ctl-dp-foot-hint">
              {mode === 'day' ? (isBusy ? busyHint : '') : 'Tap the title to zoom out'}
            </span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
