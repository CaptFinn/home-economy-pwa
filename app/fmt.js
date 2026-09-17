// Money and dates, formatted the way the Apps Script app formats them, so the
// two front ends do not look like two different apps during the parallel run.
const peso_ = new Intl.NumberFormat('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun',
                'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** ₱1,500.00 — a real minus sign for negatives, never a hyphen. */
export function peso(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '') + '₱' + peso_.format(Math.abs(v));
}

/** +₱1,500.00 / −₱1,500.00 — the sign IS the direction (sibling spec §3). */
export function signed(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '−' : '+') + '₱' + peso_.format(Math.abs(v));
}

/** 'sep 16' from 'YYYY-MM-DD', split by hand rather than parsed as a Date:
    new Date('2026-09-16') is UTC midnight, which is the day before in Manila. */
export function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? month + ' ' + Number(m[3]) : '';
}

/** Today as 'YYYY-MM-DD' in the phone's own calendar, for the date field. */
export function today(d = new Date()) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}
