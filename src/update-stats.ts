// Fetches GitHub stats and regenerates dark_mode.svg / light_mode.svg.
import { writeCards } from './card.js';
import { fetchContributions, fetchProfile, type Stats } from './github.js';

const USERNAME = 'vr1e';

async function main() {
	console.log(`Fetching profile for ${USERNAME}...`);
	const profile = await fetchProfile(USERNAME);

	console.log('Counting contributions...');
	const contributions = await fetchContributions(USERNAME, profile.createdAt);

	const stats: Stats = { ...profile, ...contributions };
	console.log(stats);

	for (const file of await writeCards(stats)) {
		console.log(`Wrote ${file}`);
	}
}

main().catch(error => {
	console.error(error);
	process.exit(1);
});
