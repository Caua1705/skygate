import assert from 'node:assert/strict';
import { appData, planState } from '../src/state/appState.js';
import {
  effectiveFlightDay,
  flightDateForDay,
  gateCloseMarginMin,
  minutesUntilFlight,
  slackFor,
} from '../src/services/flightSlack.js';

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
} finally {
  appData.airport = previousAirport;
  Object.assign(planState, previous);
}

console.log('flight-slack.test.mjs passed');
