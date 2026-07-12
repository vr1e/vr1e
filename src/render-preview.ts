// Dev helper: re-render SVGs from hardcoded stats without hitting the API.
import { writeCards } from './card.js';

const stats = {
	login: 'vr1e',
	createdAt: new Date('2016-03-03T15:40:46.000Z'),
	followers: 3,
	ownedRepos: 72,
	contributedRepos: 17,
	stars: 5,
	languages: [
		{ name: 'TypeScript', percent: 52 },
		{ name: 'JavaScript', percent: 17 },
		{ name: 'CSS', percent: 13 },
		{ name: 'HTML', percent: 9 },
		{ name: 'Shell', percent: 5 }
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

await writeCards(stats);
console.log('done');
