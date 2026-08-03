import assert from 'node:assert/strict';
import { appData, planState } from '../src/state/appState.js';
import {
  gateCloseMarginMin,
  minutesUntilFlight,
  slackFor,
} from '../src/services/flightSlack.js';

const previousAirport = appData.airport;
const previous = {
  flightTime: planState.flightTime,
  flightDay: planState.flightDay,
  flightType: planState.flightType,
};

try {
  appData.airport = { slug: 'fortaleza' };
  planState.flightTime = '09:00';
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
} finally {
  appData.airport = previousAirport;
  Object.assign(planState, previous);
}

console.log('flight-slack.test.mjs passed');
