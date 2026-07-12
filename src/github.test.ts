import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fetchContributions, fetchProfile } from './github.js';

// Queue of responses handed out one-per-fetch-call, so a test can script a
// multi-page or multi-year sequence.
let responses: unknown[] = [];
let calls: { query: string; variables: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;

function queueData(data: unknown) {
	responses.push({ ok: true, json: async () => ({ data }) });
}

beforeEach(() => {
	process.env.ACCESS_TOKEN = 'test-token';
	responses = [];
	calls = [];
	globalThis.fetch = (async (_url: string, init: { body: string }) => {
		calls.push(JSON.parse(init.body));
		const next = responses.shift();
		if (!next) throw new Error('fetch called more times than queued');
		return next;
	}) as unknown as typeof fetch;
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

const repo = (over: Partial<{
	isFork: boolean;
	isArchived: boolean;
	stargazerCount: number;
	languages: { edges: { size: number; node: { name: string } }[] };
}> = {}) => ({
	isFork: false,
	isArchived: false,
	stargazerCount: 0,
	languages: { edges: [] },
	...over
});

function profilePage(
	nodes: ReturnType<typeof repo>[],
	{ hasNextPage = false, endCursor = null as string | null, totalCount = nodes.length } = {}
) {
	return {
		user: {
			login: 'vr1e',
			createdAt: '2016-03-03T15:40:46Z',
			followers: { totalCount: 3 },
			repositoriesContributedTo: { totalCount: 17 },
			repositories: {
				totalCount,
				pageInfo: { hasNextPage, endCursor },
				nodes
			}
		}
	};
}

describe('fetchProfile', () => {
	it('aggregates languages, excluding forks and archived repos', async () => {
		queueData(
			profilePage([
				repo({
					stargazerCount: 5,
					languages: {
						edges: [
							{ size: 100, node: { name: 'TypeScript' } },
							{ size: 50, node: { name: 'JavaScript' } }
						]
					}
				}),
				// Fork: stars still count, but its languages must not.
				repo({
					isFork: true,
					stargazerCount: 10,
					languages: { edges: [{ size: 9999, node: { name: 'PHP' } }] }
				}),
				// Archived: excluded from languages too.
				repo({
					isArchived: true,
					stargazerCount: 2,
					languages: { edges: [{ size: 9999, node: { name: 'PHP' } }] }
				}),
				repo({ languages: { edges: [{ size: 50, node: { name: 'TypeScript' } }] } })
			])
		);

		const profile = await fetchProfile('vr1e');

		assert.equal(profile.login, 'vr1e');
		assert.equal(profile.followers, 3);
		assert.equal(profile.contributedRepos, 17);
		assert.equal(profile.stars, 17); // 5 + 10 + 2 + 0
		assert.deepEqual(profile.languages, [
			{ name: 'TypeScript', percent: 75 }, // 150 / 200
			{ name: 'JavaScript', percent: 25 } //  50 / 200
		]);
		assert.equal(profile.createdAt.toISOString(), '2016-03-03T15:40:46.000Z');
	});

	it('follows pagination and sums stars across pages', async () => {
		queueData(
			profilePage([repo({ stargazerCount: 4 })], {
				hasNextPage: true,
				endCursor: 'CURSOR_1',
				totalCount: 2
			})
		);
		queueData(profilePage([repo({ stargazerCount: 6 })], { totalCount: 2 }));

		const profile = await fetchProfile('vr1e');

		assert.equal(calls.length, 2);
		assert.equal(calls[0].variables.cursor, null);
		assert.equal(calls[1].variables.cursor, 'CURSOR_1');
		assert.equal(profile.stars, 10);
		assert.equal(profile.ownedRepos, 2);
	});

	it('keeps only the top 5 languages and drops sub-1% ones', async () => {
		queueData(
			profilePage([
				repo({
					languages: {
						edges: [
							{ size: 400, node: { name: 'A' } },
							{ size: 250, node: { name: 'B' } },
							{ size: 150, node: { name: 'C' } },
							{ size: 120, node: { name: 'D' } },
							{ size: 70, node: { name: 'E' } },
							{ size: 9, node: { name: 'F' } }, // 6th -> beyond top 5
							{ size: 1, node: { name: 'G' } } // < 1% -> dropped
						]
					}
				})
			])
		);

		const profile = await fetchProfile('vr1e');
		assert.deepEqual(
			profile.languages.map(l => l.name),
			['A', 'B', 'C', 'D', 'E']
		);
	});

	it('throws on a GraphQL error payload', async () => {
		responses.push({ ok: true, json: async () => ({ errors: [{ message: 'boom' }] }) });
		await assert.rejects(fetchProfile('vr1e'), /GraphQL errors: boom/);
	});

	it('throws on a non-OK HTTP response', async () => {
		responses.push({ ok: false, status: 401, text: async () => 'Unauthorized' });
		await assert.rejects(fetchProfile('vr1e'), /GraphQL request failed: 401 Unauthorized/);
	});

	it('throws when no token is configured', async () => {
		delete process.env.ACCESS_TOKEN;
		await assert.rejects(fetchProfile('vr1e'), /Set ACCESS_TOKEN/);
	});
});

// yyyy-mm-dd for `n` days before today (UTC).
function isoDaysAgo(n: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - n);
	return d.toISOString().slice(0, 10);
}

function contributionsData(
	days: { date: string; count: number }[],
	totals: Partial<{
		totalCommitContributions: number;
		restrictedContributionsCount: number;
		totalPullRequestContributions: number;
		totalIssueContributions: number;
		totalPullRequestReviewContributions: number;
	}> = {}
) {
	return {
		user: {
			contributionsCollection: {
				totalCommitContributions: 0,
				restrictedContributionsCount: 0,
				totalPullRequestContributions: 0,
				totalIssueContributions: 0,
				totalPullRequestReviewContributions: 0,
				...totals,
				contributionCalendar: {
					weeks: [{ contributionDays: days.map(d => ({ date: d.date, contributionCount: d.count })) }]
				}
			}
		}
	};
}

describe('fetchContributions', () => {
	it('sums contribution totals and reports restricted work separately', async () => {
		queueData(
			contributionsData([], {
				totalCommitContributions: 10,
				restrictedContributionsCount: 5,
				totalPullRequestContributions: 3,
				totalIssueContributions: 2,
				totalPullRequestReviewContributions: 4
			})
		);

		const createdAt = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
		const c = await fetchContributions('vr1e', createdAt);

		assert.equal(c.commits, 10); // restricted no longer folded in
		assert.equal(c.privateContributions, 5);
		assert.equal(c.prs, 3);
		assert.equal(c.issues, 2);
		assert.equal(c.reviews, 4);
	});

	it('sums restricted contributions across every year window', async () => {
		const thisYear = new Date().getUTCFullYear();
		const createdAt = new Date(Date.UTC(thisYear - 1, 0, 1)); // two year windows
		queueData(contributionsData([], { restrictedContributionsCount: 100 }));
		queueData(contributionsData([], { restrictedContributionsCount: 50 }));

		const c = await fetchContributions('vr1e', createdAt);
		assert.equal(c.privateContributions, 150);
	});

	it('computes current and longest streaks and ignores future days', async () => {
		const days = [
			{ date: isoDaysAgo(5), count: 1 },
			{ date: isoDaysAgo(4), count: 1 },
			{ date: isoDaysAgo(3), count: 0 }, // breaks the streak
			{ date: isoDaysAgo(2), count: 3 },
			{ date: isoDaysAgo(1), count: 4 },
			{ date: isoDaysAgo(0), count: 2 }, // today
			{ date: isoDaysAgo(-3), count: 99 } // future: must be dropped
		];
		queueData(contributionsData(days));

		const createdAt = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
		const c = await fetchContributions('vr1e', createdAt);

		assert.equal(c.currentStreak, 3); // today + 2 prior active days
		assert.equal(c.longestStreak, 3); // the run ending today
		assert.equal(c.contributionsPastYear, 11); // future 99 excluded
	});

	it('holds the current streak when today has no contributions yet', async () => {
		const days = [
			{ date: isoDaysAgo(3), count: 2 },
			{ date: isoDaysAgo(2), count: 2 },
			{ date: isoDaysAgo(1), count: 2 },
			{ date: isoDaysAgo(0), count: 0 } // today idle -> look back from yesterday
		];
		queueData(contributionsData(days));

		const createdAt = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
		const c = await fetchContributions('vr1e', createdAt);

		assert.equal(c.currentStreak, 3);
	});

	it('queries one window per calendar year since account creation', async () => {
		const thisYear = new Date().getUTCFullYear();
		const createdAt = new Date(Date.UTC(thisYear - 2, 5, 1)); // spans 3 years
		queueData(contributionsData([]));
		queueData(contributionsData([]));
		queueData(contributionsData([]));

		await fetchContributions('vr1e', createdAt);

		assert.equal(calls.length, 3);
	});
});
