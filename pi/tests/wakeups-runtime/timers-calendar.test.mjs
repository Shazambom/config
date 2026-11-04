import assert from 'node:assert/strict';
import test from 'node:test';
import { createCron } from '../../agent/wakeups/cron.mjs';

const cases = [
  ['UTC minute boundary', '* * * * *', 'UTC', '2026-01-01T00:00:00.000Z', ['2026-01-01T00:01:00.000Z', '2026-01-01T00:02:00.000Z']],
  ['month boundary', '0 0 1 * *', 'UTC', '2026-01-31T23:59:59.000Z', ['2026-02-01T00:00:00.000Z']],
  ['leap day', '0 0 29 2 *', 'UTC', '2027-03-01T00:00:00.000Z', ['2028-02-29T00:00:00.000Z']],
  ['restricted days OR', '0 0 13 * 1', 'UTC', '2026-02-08T00:00:00.000Z', ['2026-02-09T00:00:00.000Z', '2026-02-13T00:00:00.000Z']],
  ['NY spring gap shifts landing hour', '30 2 * * *', 'America/New_York', '2026-03-08T00:00:00.000Z', ['2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z']],
  ['NY fall overlap retained iterator skips repeat', '30 1 * * *', 'America/New_York', '2026-11-01T00:00:00.000Z', ['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']],
  ['NY fresh reference inside overlap uses future repeat', '30 1 * * *', 'America/New_York', '2026-11-01T06:00:00.000Z', ['2026-11-01T06:30:00.000Z']],
  ['Lord Howe half-hour gap skips missing local time', '15 2 * * *', 'Australia/Lord_Howe', '2026-10-03T00:00:00.000Z', ['2026-10-04T15:15:00.000Z']],
  ['Lord Howe overlap', '45 1 * * *', 'Australia/Lord_Howe', '2026-04-04T00:00:00.000Z', ['2026-04-04T14:45:00.000Z', '2026-04-05T15:15:00.000Z']],
  ['steps lists ranges and Sunday zero', '*/15 1-2 * * 0,1', 'UTC', '2026-02-08T01:00:00.000Z', ['2026-02-08T01:15:00.000Z']],
  ['Sunday seven matches Sunday zero', '*/15 1-2 * * 7', 'UTC', '2026-02-08T01:00:00.000Z', ['2026-02-08T01:15:00.000Z']],
];
for (const [label, expression, zone, start, expected] of cases) {
  test(label, () => {
    let reference = Date.parse(start);
    const schedule = createCron(expression, zone, reference);
    for (const instant of expected) {
      const next = schedule.next(reference);
      assert.equal(new Date(next).toISOString(), instant);
      assert.ok(next > reference);
      reference = next;
    }
  });
}

test('missed cron dates coalesce without enumeration and choose a strictly future reference', () => {
  const schedule = createCron('* * * * *', 'UTC', Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(schedule.next(Date.parse('2026-01-01T00:00:00Z')), Date.parse('2026-01-01T00:01:00Z'));
  assert.equal(schedule.next(Date.parse('2036-01-01T00:00:00Z')), Date.parse('2036-01-01T00:01:00Z'));
});

test('only numeric five-field syntax and explicit IANA zones are accepted', () => {
  for (const expression of ['@daily', '0 0 0 * * *', '0 0 * JAN *', '0 0 * * MON', '0 0 L * *', 'H * * * *', '60 * * * *', '0 0 31 2 *', '*/0 * * * *', '*/15 1-2 * * 0,7', '0,0 * * * *']) {
    assert.throws(() => createCron(expression, 'UTC', Date.now()).next(Date.now()), /WAKEUPS_INVALID_CRON/);
  }
  for (const zone of ['', 'local', 'UTC+5', '+05:00', 'Mars/Olympus']) {
    assert.throws(() => createCron('* * * * *', zone, Date.now()), /WAKEUPS_INVALID_TIMEZONE/);
  }
});
