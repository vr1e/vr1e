// GitHub API access via GraphQL: profile, languages, and contribution stats.

const API_URL = 'https://api.github.com';

export interface LanguageShare {
	name: string;
	percent: number;
}

export interface Stats {
	login: string;
	createdAt: Date;
	followers: number;
	ownedRepos: number;
	contributedRepos: number;
	stars: number;
	languages: LanguageShare[];
	commits: number;
	prs: number;
	issues: number;
	reviews: number;
	// Contributions in repos the token can't read (private/org work). GitHub
	// only exposes these as an anonymous count, never a per-type breakdown.
	privateContributions: number;
	contributionsPastYear: number;
	currentStreak: number;
	longestStreak: number;
	weeklyContributions: number[]; // last 52 weeks, oldest first
}

function token(): string {
	const t = process.env.ACCESS_TOKEN;
	if (!t) {
		throw new Error('Set ACCESS_TOKEN with a GitHub API token');
	}
	return t;
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
	const res = await fetch(`${API_URL}/graphql`, {
		method: 'POST',
		headers: {
			Authorization: `bearer ${token()}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ query, variables })
	});
	if (!res.ok) {
		throw new Error(`GraphQL request failed: ${res.status} ${await res.text()}`);
	}
	const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
	if (json.errors?.length) {
		throw new Error(`GraphQL errors: ${json.errors.map(e => e.message).join('; ')}`);
	}
	if (!json.data) {
		throw new Error('GraphQL response contained no data');
	}
	return json.data;
}

interface ProfileData {
	user: {
		login: string;
		createdAt: string;
		followers: { totalCount: number };
		repositoriesContributedTo: { totalCount: number };
		repositories: {
			totalCount: number;
			pageInfo: { hasNextPage: boolean; endCursor: string | null };
			nodes: {
				isFork: boolean;
				isArchived: boolean;
				stargazerCount: number;
				languages: { edges: { size: number; node: { name: string } }[] };
			}[];
		};
	};
}

export async function fetchProfile(
	username: string
): Promise<
	Omit<
		Stats,
		| 'commits'
		| 'prs'
		| 'issues'
		| 'reviews'
		| 'privateContributions'
		| 'contributionsPastYear'
		| 'currentStreak'
		| 'longestStreak'
		| 'weeklyContributions'
	>
> {
	const query = `
		query ($login: String!, $cursor: String) {
			user(login: $login) {
				login
				createdAt
				followers { totalCount }
				repositoriesContributedTo(
					first: 1
					contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]
				) { totalCount }
				repositories(first: 100, ownerAffiliations: OWNER, after: $cursor) {
					totalCount
					pageInfo { hasNextPage endCursor }
					nodes {
						isFork
						isArchived
						stargazerCount
						languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
							edges { size node { name } }
						}
					}
				}
			}
		}`;

	let cursor: string | null = null;
	let stars = 0;
	const bytesByLanguage = new Map<string, number>();
	let user: ProfileData['user'];

	do {
		const data: ProfileData = await graphql<ProfileData>(query, { login: username, cursor });
		user = data.user;
		for (const repo of user.repositories.nodes) {
			stars += repo.stargazerCount;
			// Forks would count upstream code as ours; archived repos (old course
			// material and the like) no longer represent what we write.
			if (repo.isFork || repo.isArchived) continue;
			for (const { size, node } of repo.languages.edges) {
				bytesByLanguage.set(node.name, (bytesByLanguage.get(node.name) ?? 0) + size);
			}
		}
		cursor = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
	} while (cursor);

	const totalBytes = [...bytesByLanguage.values()].reduce((sum, b) => sum + b, 0);
	const languages = [...bytesByLanguage.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([name, bytes]) => ({ name, percent: Math.round((bytes / totalBytes) * 100) }))
		.filter(l => l.percent >= 1)
		.slice(0, 5);

	return {
		login: user.login,
		createdAt: new Date(user.createdAt),
		followers: user.followers.totalCount,
		ownedRepos: user.repositories.totalCount,
		contributedRepos: user.repositoriesContributedTo.totalCount,
		stars,
		languages
	};
}

interface ContributionsData {
	user: {
		contributionsCollection: {
			totalCommitContributions: number;
			restrictedContributionsCount: number;
			totalPullRequestContributions: number;
			totalIssueContributions: number;
			totalPullRequestReviewContributions: number;
			contributionCalendar: {
				weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
			};
		};
	};
}

export async function fetchContributions(
	username: string,
	createdAt: Date
): Promise<
	Pick<
		Stats,
		| 'commits'
		| 'prs'
		| 'issues'
		| 'reviews'
		| 'privateContributions'
		| 'contributionsPastYear'
		| 'currentStreak'
		| 'longestStreak'
		| 'weeklyContributions'
	>
> {
	const query = `
		query ($login: String!, $from: DateTime!, $to: DateTime!) {
			user(login: $login) {
				contributionsCollection(from: $from, to: $to) {
					totalCommitContributions
					restrictedContributionsCount
					totalPullRequestContributions
					totalIssueContributions
					totalPullRequestReviewContributions
					contributionCalendar {
						weeks { contributionDays { date contributionCount } }
					}
				}
			}
		}`;

	// contributionsCollection is capped at a one-year window, so query each year.
	// The per-year queries are independent, so fire them concurrently.
	const now = new Date();
	const years: number[] = [];
	for (let year = createdAt.getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
		years.push(year);
	}
	const yearly = await Promise.all(
		years.map(year => {
			const from = new Date(Date.UTC(year, 0, 1)).toISOString();
			const to = new Date(Date.UTC(year, 11, 31, 23, 59, 59)).toISOString();
			return graphql<ContributionsData>(query, { login: username, from, to });
		})
	);

	let commits = 0;
	let prs = 0;
	let issues = 0;
	let reviews = 0;
	let privateContributions = 0;
	const days: { date: string; count: number }[] = [];
	for (const data of yearly) {
		const c = data.user.contributionsCollection;
		commits += c.totalCommitContributions;
		privateContributions += c.restrictedContributionsCount;
		prs += c.totalPullRequestContributions;
		issues += c.totalIssueContributions;
		reviews += c.totalPullRequestReviewContributions;
		for (const week of c.contributionCalendar.weeks) {
			for (const day of week.contributionDays) {
				days.push({ date: day.date, count: day.contributionCount });
			}
		}
	}
	days.sort((a, b) => a.date.localeCompare(b.date));
	// Drop calendar days beyond today (the December query range is in the future).
	const today = now.toISOString().slice(0, 10);
	const past = days.filter(d => d.date <= today);

	let longestStreak = 0;
	let run = 0;
	for (const day of past) {
		run = day.count > 0 ? run + 1 : 0;
		longestStreak = Math.max(longestStreak, run);
	}

	// Current streak: consecutive active days ending today, or yesterday if
	// today has no contributions yet.
	let i = past.length - 1;
	if (i >= 0 && past[i].count === 0) i--;
	let currentStreak = 0;
	while (i >= 0 && past[i].count > 0) {
		currentStreak++;
		i--;
	}

	const contributionsPastYear = past.slice(-365).reduce((sum, d) => sum + d.count, 0);

	const lastYear = past.slice(-364).map(d => d.count);
	const weeklyContributions = Array.from({ length: Math.floor(lastYear.length / 7) }, (_, w) =>
		lastYear.slice(w * 7, w * 7 + 7).reduce((sum, c) => sum + c, 0)
	);

	return {
		commits,
		prs,
		issues,
		reviews,
		privateContributions,
		contributionsPastYear,
		currentStreak,
		longestStreak,
		weeklyContributions
	};
}
