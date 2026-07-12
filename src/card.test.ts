import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLines, formatUptime, renderCard } from './card.js';
import type { Stats } from './github.js';

const baseStats: Stats = {
	login: 'vr1e',
	createdAt: new Date('2016-03-03T15:40:46.000Z'),
	followers: 3,
	ownedRepos: 72,
	contributedRepos: 17,
	stars: 1234,
	languages: [
		{ name: 'TypeScript', percent: 58 },
		{ name: 'JavaScript', percent: 27 },
		{ name: 'CSS', percent: 9 }
	],
	commits: 3280,
	prs: 214,
	issues: 87,
	reviews: 156,
	privateContributions: 1893,
	contributionsPastYear: 1042,
	currentStreak: 6,
	longestStreak: 41,
	weeklyContributions: Array.from({ length: 52 }, (_, i) => (i * 13) % 29)
};

describe('formatUptime', () => {
	it('is all zeros for identical dates', () => {
		const d = new Date('2020-05-15T00:00:00Z');
		assert.equal(formatUptime(d, d), '0 years, 0 months, 0 days');
	});

	it('counts whole years', () => {
		assert.equal(
			formatUptime(new Date('2020-03-03T00:00:00Z'), new Date('2023-03-03T00:00:00Z')),
			'3 years, 0 months, 0 days'
		);
	});

	it('borrows days from the previous month', () => {
		// 15 May 2020 -> 10 Aug 2023: day underflow (-5) borrows 31 days from July.
		assert.equal(
			formatUptime(new Date('2020-05-15T00:00:00Z'), new Date('2023-08-10T00:00:00Z')),
			'3 years, 2 months, 26 days'
		);
	});

	it('borrows months across a year boundary', () => {
		// 20 Nov 2019 -> 10 Jan 2021: month underflow rolls a year back.
		assert.equal(
			formatUptime(new Date('2019-11-20T00:00:00Z'), new Date('2021-01-10T00:00:00Z')),
			'1 years, 1 months, 21 days'
		);
	});
});

describe('buildLines', () => {
	it('puts the login in the header', () => {
		const [header] = buildLines(baseStats);
		assert.equal(header[0].color, 'header');
		assert.equal(header[0].text, 'vr1e@github ');
	});

	it('formats numbers with thousands separators', () => {
		const flat = buildLines(baseStats)
			.flat()
			.map(s => s.text)
			.join('');
		assert.match(flat, /1,234/); // stars
		assert.match(flat, /5,173/); // commits total (3,280 public + 1,893 private)
		assert.match(flat, /1,893 private/); // private breakdown in parens
	});

	it('does not surface a Reviews stat', () => {
		const flat = buildLines(baseStats)
			.flat()
			.map(s => s.text)
			.join('');
		assert.doesNotMatch(flat, /Reviews/);
	});

	it('wraps a full top-5 language list across continuation lines', () => {
		const stats: Stats = {
			...baseStats,
			languages: [
				{ name: 'TypeScript', percent: 40 },
				{ name: 'JavaScript', percent: 25 },
				{ name: 'CSS', percent: 15 },
				{ name: 'HTML', percent: 12 },
				{ name: 'Shell', percent: 8 }
			]
		};
		const lines = buildLines(stats);
		const codeIdx = lines.findIndex(line =>
			line.some(s => s.color === 'key' && s.text === 'Languages.Code')
		);
		const realIdx = lines.findIndex(line => line.some(s => s.text === 'Languages.Real'));
		assert.ok(codeIdx >= 0 && realIdx > codeIdx);
		assert.ok(realIdx - codeIdx > 1, 'expected at least one continuation line');

		const block = lines
			.slice(codeIdx, realIdx)
			.map(line => line.map(s => s.text).join(''))
			.join(' ');
		for (const name of ['TypeScript', 'JavaScript', 'CSS', 'HTML', 'Shell']) {
			assert.match(block, new RegExp(`${name} \\d+%`));
		}
	});

	it('keeps every rendered line within the card width', () => {
		const stats: Stats = {
			...baseStats,
			languages: [
				{ name: 'TypeScript', percent: 40 },
				{ name: 'JavaScript', percent: 25 },
				{ name: 'CSS', percent: 15 },
				{ name: 'HTML', percent: 12 },
				{ name: 'Shell', percent: 8 }
			]
		};
		for (const line of buildLines(stats)) {
			const len = line.reduce((sum, s) => sum + s.text.length, 0);
			assert.ok(len <= 54, `line too wide (${len}): ${line.map(s => s.text).join('')}`);
		}
	});

	it('produces a sparkline segment for every non-empty run', () => {
		const lines = buildLines(baseStats);
		const spark = lines[lines.length - 1];
		const blocks = spark.map(s => s.text).join('');
		// Every character is a block glyph and the run covers all 52 weeks.
		assert.equal([...blocks].length, baseStats.weeklyContributions.length);
		assert.match(blocks, /^[▁▂▃▄▅▆▇█]+$/u);
	});

	it('colors zero-activity weeks with the quiet color', () => {
		const stats: Stats = { ...baseStats, weeklyContributions: [0, 10, 0] };
		const spark = buildLines(stats).at(-1)!;
		// First and third weeks are zero -> both 'dots'; middle is active.
		assert.equal(spark[0].color, 'dots');
		assert.notEqual(spark[1].color, 'dots');
	});
});

describe('renderCard', () => {
	for (const mode of ['dark', 'light'] as const) {
		it(`renders a self-contained svg in ${mode} mode`, () => {
			const svg = renderCard(baseStats, mode);
			assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
			assert.match(svg, /<\/svg>\s*$/);
			assert.match(svg, /width="\d+" height="\d+"/);
		});
	}

	it('escapes XML-special characters in stats values', () => {
		const svg = renderCard({ ...baseStats, login: 'a<b>&c' }, 'dark');
		assert.match(svg, /a&lt;b&gt;&amp;c/);
		assert.doesNotMatch(svg, /a<b>&c/);
	});

	it('uses the requested theme background', () => {
		assert.match(renderCard(baseStats, 'dark'), /fill="#2b2430"/);
		assert.match(renderCard(baseStats, 'light'), /fill="#f6efe4"/);
	});
});
