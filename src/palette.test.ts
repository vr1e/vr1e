import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PaletteName } from './palette.js';
import { paletteFor } from './palette.js';

// Every date below is a fixed UTC instant, so the suite reads the same in July
// as in November. 2027 was picked because none of its season boundaries fall in
// a Matrix week — Matrix takes precedence and would mask the changeover.
const cases: [string, PaletteName][] = [
	// The four meteorological boundaries, each side of the flip.
	['2027-02-28T12:00:00Z', 'winter'],
	['2027-03-01T00:00:00Z', 'spring'],
	['2027-05-31T12:00:00Z', 'spring'],
	['2027-06-01T00:00:00Z', 'summer'],
	['2027-08-31T12:00:00Z', 'summer'],
	['2027-09-01T00:00:00Z', 'autumn'],
	['2027-11-30T12:00:00Z', 'autumn'],
	['2027-12-01T00:00:00Z', 'winter'],
	// Mid-season sanity, one per palette.
	['2027-01-15T12:00:00Z', 'winter'],
	['2027-04-05T12:00:00Z', 'spring'],
	['2027-07-12T12:00:00Z', 'summer'],
	['2027-10-11T12:00:00Z', 'autumn'],
	// A known Matrix week: the Monday-aligned epoch week starting 2027-04-19.
	['2027-04-19T00:00:00Z', 'matrix'],
	['2027-04-22T09:00:00Z', 'matrix'],
	// Matrix beats the season it lands in.
	['2027-02-08T00:00:00Z', 'matrix'],
	['2027-09-06T00:00:00Z', 'matrix']
];

describe('paletteFor', () => {
	for (const [iso, expected] of cases) {
		it(`${iso} -> ${expected}`, () => {
			assert.equal(paletteFor(new Date(iso)), expected);
		});
	}

	it('holds the palette steady across a week, then flips on Monday', () => {
		// A mid-week re-run of the workflow must reproduce the same card.
		assert.equal(paletteFor(new Date('2027-06-21T05:17:00Z')), 'summer');
		assert.equal(paletteFor(new Date('2027-06-27T23:59:59Z')), 'summer');
		// The next Monday-aligned week is the 3000th, which is a Matrix week.
		assert.equal(paletteFor(new Date('2027-06-28T00:00:00Z')), 'matrix');
	});

	it('carries the week counter across a year boundary', () => {
		// Sunday 2029-12-30 closes a Matrix week; Monday 2029-12-31 opens the
		// next one, which runs into January. An ISO week number would reset to 1
		// at that Monday and hand the new year a second Matrix week back to back
		// — the epoch counter has no year concept, so it just carries on.
		assert.equal(paletteFor(new Date('2029-12-30T12:00:00Z')), 'matrix');
		assert.equal(paletteFor(new Date('2029-12-31T12:00:00Z')), 'winter');
		assert.equal(paletteFor(new Date('2030-01-01T12:00:00Z')), 'winter');
	});

	it('reads season boundaries in UTC, not local time', () => {
		// 23:00 UTC on Feb 28 is already Mar 1 in UTC+2; the palette must not
		// depend on which timezone the CI runner thinks it is in.
		assert.equal(paletteFor(new Date('2027-02-28T23:00:00Z')), 'winter');
		assert.equal(paletteFor(new Date('2027-03-01T00:30:00Z')), 'spring');
	});
});
