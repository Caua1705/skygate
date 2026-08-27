import assert from 'node:assert/strict';
import { appData, planState } from '../src/state/appState.js';
import {
  boardingTimeISO,
  effectiveFlightDay,
  flightDateForDay,
  gateCloseMarginMin,
  minutesUntilFlight,
  slackFor,
} from '../src/services/flightSlack.js';
import { normalizeRoute } from '../src/services/normalize.js';

const previousAirport = appData.airport;
const previous = {
  flightTime: planState.flightTime,
  flightDate: planState.flightDate,
  flightDay: planState.flightDay,
  flightType: planState.flightType,
};

try {
  appData.airport = { slug: 'fortaleza' };
  planState.flightTime = '09:00';
  planState.flightDate = '';
  planState.flightType = 'domestic';
  const now = new Date(2026, 7, 2, 10, 0, 0);

  planState.flightDay = 'today';
  assert.equal(minutesUntilFlight(now), -60, 'a past time today stays in the past');

  planState.flightDay = 'tomorrow';
  assert.equal(minutesUntilFlight(now), 23 * 60, 'tomorrow is only used when explicitly chosen');

  planState.flightTime = '12:00';
  planState.flightDay = 'today';
  planState.flightType = 'domestic';
  const domesticSlack = slackFor(10, now).slackMin;
  assert.equal(gateCloseMarginMin(), 20);

  planState.flightType = 'international';
  assert.equal(gateCloseMarginMin(), 40);
  assert.equal(slackFor(10, now).slackMin, domesticSlack - 20);

  const beforeMidnight = new Date(2026, 7, 8, 23, 50, 0);
  const afterMidnight = new Date(2026, 7, 9, 0, 10, 0);
  planState.flightTime = '00:30';
  planState.flightDay = 'tomorrow';
  planState.flightDate = flightDateForDay('tomorrow', beforeMidnight);
  assert.equal(minutesUntilFlight(beforeMidnight), 40);
  assert.equal(minutesUntilFlight(afterMidnight), 20, 'the flight keeps its real date across midnight');
  assert.equal(effectiveFlightDay(afterMidnight), 'today');

  // ── boarding_time: the field the backend actually reads ────────────────
  planState.flightDate = '';
  planState.flightDay = 'today';
  planState.flightTime = '14:30';
  // 12:00 UTC is 09:00 in Fortaleza, so a 14:30 flight is still ahead today.
  assert.equal(
    boardingTimeISO('14:30', new Date(Date.UTC(2026, 7, 27, 12, 0, 0))),
    '2026-08-27T14:30:00-03:00',
    'the typed clock is stamped with the airport offset, not the device offset',
  );
  assert.equal(
    boardingTimeISO('06:00', new Date(Date.UTC(2026, 7, 28, 2, 0, 0))),
    '2026-08-28T06:00:00-03:00',
    'a time still ahead at the airport stays on the airport date, not the UTC date',
  );
  assert.equal(
    boardingTimeISO('06:00', new Date(Date.UTC(2026, 7, 28, 2, 0, 0) + 20 * 3600e3)),
    '2026-08-29T06:00:00-03:00',
    'a time that already passed at the airport rolls to tomorrow',
  );
  assert.equal(boardingTimeISO('', new Date()), '', 'no flight time, no boarding_time');
  assert.equal(boardingTimeISO('25:00', new Date()), '', 'an impossible clock is not sent');

  planState.flightDate = '2026-09-04';
  assert.equal(
    boardingTimeISO('06:00', new Date(Date.UTC(2026, 7, 27, 12, 0, 0))),
    '2026-09-04T06:00:00-03:00',
    'an explicitly chosen flight date outranks the today/tomorrow guess',
  );
  planState.flightDate = '';

  // ── free_time_minutes: the server's answer beats the local estimate ────
  assert.equal(normalizeRoute({ free_time_minutes: 47 }).freeTimeMinutes, 47);
  assert.equal(
    normalizeRoute({ total_estimated_time_minutes: 9 }).freeTimeMinutes,
    null,
    'an absent free_time_minutes stays null and never collapses to zero',
  );
  assert.equal(normalizeRoute({ free_time_minutes: null }).freeTimeMinutes, null);

  planState.flightTime = '12:00';
  planState.flightType = 'domestic';
  const local = slackFor(10, now);
  assert.equal(local.fromServer, false);
  const fromServer = slackFor(10, now, { serverSlackMin: 47 });
  assert.equal(fromServer.slackMin, 47, 'the server value is used verbatim');
  assert.equal(fromServer.fromServer, true);
  assert.equal(fromServer.status, 'tranquila');
  assert.notEqual(fromServer.slackMin, local.slackMin);
  assert.equal(
    slackFor(10, now, { serverSlackMin: null }).slackMin,
    local.slackMin,
    'without a server value the local estimate remains the fallback',
  );
  assert.equal(
    slackFor(10, now, { serverSlackMin: -5 }).status,
    'inviavel',
    'a negative server slack is a real state, not a missing value',
  );
} finally {
  appData.airport = previousAirport;
  Object.assign(planState, previous);
}

console.log('flight-slack.test.mjs passed');
