import { CronExpressionParser } from 'cron-parser';
import { IANAZone } from 'luxon';

// Evaluate only: no library scheduler, global registry or calendar arithmetic.
// cron-parser's gap/overlap rules differ for full-hour and half-hour DST shifts.
// Retain iterator history normally; after missed ticks, evaluate from wall-now.
export function createCron(expression, timezone, reference) {
  if (typeof timezone !== 'string' || timezone.length > 100 || /^[+-]/.test(timezone) || !IANAZone.isValidZone(timezone)) {
    throw new Error('WAKEUPS_INVALID_TIMEZONE');
  }
  if (typeof expression !== 'string' || expression.length > 120 ||
      expression.trim().split(/\s+/).length !== 5 || !/^[\d*/ ,\-\t]+$/.test(expression)) {
    throw new Error('WAKEUPS_INVALID_CRON');
  }
  const parse = after => CronExpressionParser.parse(expression, { currentDate: new Date(after), tz: timezone });
  let iterator;
  try { iterator = parse(reference); } catch { throw new Error('WAKEUPS_INVALID_CRON'); }
  return {
    next(after) {
      try {
        let next = iterator.next().toDate().getTime();
        if (next <= after) {
          iterator = parse(after);
          next = iterator.next().toDate().getTime();
        }
        if (!Number.isFinite(next) || next <= after) throw new Error();
        return next;
      } catch { throw new Error('WAKEUPS_INVALID_CRON'); }
    },
  };
}
