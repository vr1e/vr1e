// Renders the neofetch-style SVG card in dark and light variants.
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { asciiArt } from './ascii.js';
import type { LanguageShare, Stats } from './github.js';
import { artFontSize, artLineHeight, charWidthEm } from './metrics.js';

// The "Kernel" joke line self-updates with this repo's TypeScript version.
const tsVersion: string = createRequire(import.meta.url)('typescript/package.json').version;

interface Theme {
	background: string;
	border: string;
	text: string;
	key: string;
	value: string;
	dots: string;
	header: string;
	plus: string;
	minus: string;
}

// Warm clay-on-plum palette after the classic neofetch screenshot look;
// light mode is the same hues on cream paper.
const themes: Record<'dark' | 'light', Theme> = {
	dark: {
		background: '#2b2430',
		border: '#544a5e',
		text: '#e8dccb',
		key: '#cd7e5d',
		value: '#e0b48c',
		dots: '#71657d',
		header: '#d98a74',
		plus: '#9cb380',
		minus: '#c75f4e'
	},
	light: {
		background: '#f6efe4',
		border: '#dccdb8',
		text: '#52453e',
		key: '#ad5136',
		value: '#8c5e34',
		dots: '#b3a493',
		header: '#c05b40',
		plus: '#728a52',
		minus: '#b23e2e'
	}
};

type Segment = { text: string; color: keyof Theme };
type Line = Segment[];

const LINE_WIDTH = 54;
// Fixed characters kv() spends around the dot leader: '. ', ': ', the trailing
// space, and one column of slack so the leader never reaches the right edge.
const KV_OVERHEAD = 6;
const artColumns = Math.max(...asciiArt.map(line => line.length));
// Non-breaking space: SVG collapses runs of regular spaces, which would break
// the leading indent on wrapped continuation lines.
const NBSP = ' ';

function escapeXml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatNumber(n: number): string {
	return n.toLocaleString('en-US');
}

export function formatUptime(from: Date, to: Date): string {
	let years = to.getUTCFullYear() - from.getUTCFullYear();
	let months = to.getUTCMonth() - from.getUTCMonth();
	let days = to.getUTCDate() - from.getUTCDate();
	if (days < 0) {
		months--;
		days += new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 0)).getUTCDate();
	}
	if (months < 0) {
		years--;
		months += 12;
	}
	return `${years} years, ${months} months, ${days} days`;
}

// ". key: ..... value" with dot leaders padding the line to LINE_WIDTH.
function kv(key: string, value: string, extra: Segment[] = []): Line {
	const extraLength = extra.reduce((sum, s) => sum + s.text.length, 0);
	const dotCount = Math.max(2, LINE_WIDTH - key.length - value.length - extraLength - KV_OVERHEAD);
	return [
		{ text: '. ', color: 'dots' },
		{ text: key, color: 'key' },
		{ text: ': ', color: 'text' },
		{ text: `${'.'.repeat(dotCount)} `, color: 'dots' },
		{ text: value, color: 'value' },
		...extra
	];
}

function header(title: string): Line {
	const dashes = '─'.repeat(Math.max(2, LINE_WIDTH - title.length - 3));
	return [
		{ text: `${title} `, color: 'header' },
		{ text: dashes, color: 'dots' }
	];
}

// Weekly contribution counts as a one-line block-character sparkline,
// heat-colored from quiet to busy along the theme's warm ramp.
function sparkline(weeks: number[]): Line {
	const blocks = '▁▂▃▄▅▆▇█';
	const heat: (keyof Theme)[] = ['dots', 'plus', 'value', 'key', 'minus'];
	const max = Math.max(...weeks, 1);
	const line: Line = [];
	for (const w of weeks) {
		// sqrt scale: one outlier week would otherwise flatten the rest.
		const level = Math.sqrt(w / max);
		const block = blocks[Math.min(blocks.length - 1, Math.round(level * (blocks.length - 1)))];
		// heat[0] is the "quiet" color; the rest form the active ramp.
		const bands = heat.length - 1;
		const color = w === 0 ? heat[0] : heat[1 + Math.min(bands - 1, Math.floor(level * bands))];
		const last = line[line.length - 1];
		if (last?.color === color) last.text += block;
		else line.push({ text: block, color });
	}
	return line;
}

// "key: value | key: value" continuation for a kv line.
function also(key: string, value: string): Segment[] {
	return [
		{ text: ' | ', color: 'text' },
		{ text: key, color: 'key' },
		{ text: ': ', color: 'text' },
		{ text: value, color: 'value' }
	];
}

// The Languages.Code line, wrapping the "name pct%" list onto continuation
// lines when it outgrows one row. Each row stays within a kv line's value
// budget; continuations are indented to sit under the first row's value.
function languageLines(languages: LanguageShare[]): Line[] {
	const key = 'Languages.Code';
	const items = languages.map(l => `${l.name} ${l.percent}%`);
	// kv can't shrink below its '. key: .. value ' minimum (two dots of leader),
	// and non-final rows carry a trailing comma; leave room for both.
	const budget = LINE_WIDTH - key.length - KV_OVERHEAD - 3;

	const rows: string[] = [];
	let row = '';
	for (const item of items) {
		const candidate = row ? `${row}, ${item}` : item;
		if (row && candidate.length > budget) {
			rows.push(row);
			row = item;
		} else {
			row = candidate;
		}
	}
	if (row) rows.push(row);
	if (!rows.length) return [kv(key, '')];

	// Column where the first row's value begins, so continuations line up under it.
	const first = rows.length > 1 ? `${rows[0]},` : rows[0];
	const dots = Math.max(2, LINE_WIDTH - key.length - first.length - KV_OVERHEAD);
	const valueColumn = '. '.length + key.length + ': '.length + dots + 1;

	return rows.map((text, i) => {
		const withComma = i < rows.length - 1 ? `${text},` : text;
		if (i === 0) return kv(key, withComma);
		return [
			{ text: NBSP.repeat(valueColumn), color: 'dots' },
			{ text: withComma, color: 'value' }
		];
	});
}

export function buildLines(stats: Stats): Line[] {
	return [
		header(`${stats.login}@github`),
		kv('OS', 'macOS, Linux'),
		kv('Kernel', `TypeScript ${tsVersion}`),
		kv('Uptime', formatUptime(stats.createdAt, new Date())),
		kv('Packages', `${formatNumber(stats.ownedRepos)} (github)`, [
			{ text: `, ${formatNumber(stats.contributedRepos)} (contributed)`, color: 'text' }
		]),
		kv('Shell', 'zsh'),
		kv('IDE', 'VSCode, Claude Code'),
		kv('Host', 'marktguru'),
		[],
		...languageLines(stats.languages),
		kv('Languages.Real', 'Serbian, English, German'),
		[],
		header('Contact'),
		kv('Website', 'return.rs'),
		kv('GitHub', 'vr1e'),
		kv('Location', 'Wien, AT'),
		[],
		header('GitHub Stats'),
		kv('Stars', formatNumber(stats.stars), also('Followers', formatNumber(stats.followers))),
		kv(
			'Commits',
			stats.privateContributions > 0
				? `${formatNumber(stats.commits + stats.privateContributions)} (${formatNumber(stats.privateContributions)} private)`
				: formatNumber(stats.commits)
		),
		kv('Issues', formatNumber(stats.issues), also('PRs', formatNumber(stats.prs))),
		kv('Contributions', `${formatNumber(stats.contributionsPastYear)} (past year)`),
		kv('Streak', `${stats.currentStreak} days (longest ${stats.longestStreak})`),
		[],
		[
			{ text: '. ', color: 'dots' },
			{ text: 'Activity', color: 'key' },
			{ text: ' (past 52 weeks)', color: 'dots' }
		],
		sparkline(stats.weeklyContributions)
	];
}

export function renderCard(stats: Stats, mode: 'dark' | 'light'): string {
	const theme = themes[mode];
	const lines = buildLines(stats);
	const lineHeight = 21;
	const fontSize = 14;
	const artX = 30;
	const artWidth = artColumns * artFontSize * charWidthEm;
	const statsX = artX + Math.ceil(artWidth) + 40;
	const topY = 40;
	// Neofetch-style palette strip below the stats block.
	const swatch = { width: 26, height: 12, gap: 4 };
	const stripY = topY + (lines.length - 1) * lineHeight + 16;
	// Caption below the art, stamped with the render date.
	const caption: Line = [
		{ text: 'vr1e', color: 'header' },
		{ text: ' | ', color: 'dots' },
		{ text: `refreshed ${new Date().toISOString().slice(0, 10)}`, color: 'text' }
	];
	const captionBlockHeight = lineHeight;
	const artHeight = asciiArt.length * artLineHeight;
	const height =
		Math.max(topY + artHeight + captionBlockHeight + 20, stripY + swatch.height) + 30;
	// Center the art between the top edge and the caption line.
	const captionTop = height - 30 - captionBlockHeight;
	const artY = topY + Math.max(0, Math.round((captionTop - topY - artHeight) / 2));
	const width = statsX + Math.ceil(LINE_WIDTH * fontSize * charWidthEm) + 30;
	// Ordered warm-to-cool so the strip reads as a gradient, like neofetch's.
	const paletteColors: (keyof Theme)[] = [
		'minus',
		'key',
		'header',
		'value',
		'text',
		'plus',
		'dots',
		'border'
	];
	const palette = paletteColors
		.map(
			(color, i) =>
				`<rect x="${statsX + i * (swatch.width + swatch.gap)}" y="${stripY}" width="${swatch.width}" height="${swatch.height}" rx="2" fill="${theme[color]}"/>`
		)
		.join('\n\t');

	// Non-breaking spaces: regular runs of spaces get collapsed by SVG
	// whitespace handling, which would destroy the box alignment.
	const artText = asciiArt
		.map(
			(line, i) =>
				`<text x="${artX}" y="${artY + i * artLineHeight}" fill="${theme.text}">${escapeXml(line).replaceAll(' ', ' ')}</text>`
		)
		.join('\n\t');

	const textLine = (x: number, y: number, line: Line) => {
		const tspans = line
			.map(s => `<tspan fill="${theme[s.color]}">${escapeXml(s.text)}</tspan>`)
			.join('');
		return `<text x="${x}" y="${y}">${tspans}</text>`;
	};

	const statsText = lines
		.map((line, i) => (line.length ? textLine(statsX, topY + i * lineHeight, line) : ''))
		.filter(Boolean)
		.join('\n\t');

	// Center the caption under the art column.
	const captionChars = caption.reduce((sum, s) => sum + s.text.length, 0);
	const captionX = artX + Math.max(0, (artWidth - captionChars * fontSize * charWidthEm) / 2);
	const captionText = textLine(captionX, captionTop + fontSize, caption);

	return `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="'Menlo', 'Consolas', 'DejaVu Sans Mono', monospace" font-size="${fontSize}px">
	<rect width="${width}" height="${height}" fill="${theme.background}"/>
	<g font-size="${artFontSize}px">
	${artText}
	</g>
	${statsText}
	${captionText}
	${palette}
</svg>
`;
}

// Render both themes and write <mode>_mode.svg; returns the filenames written.
export async function writeCards(stats: Stats): Promise<string[]> {
	const modes = ['dark', 'light'] as const;
	await Promise.all(modes.map(mode => writeFile(`${mode}_mode.svg`, renderCard(stats, mode))));
	return modes.map(mode => `${mode}_mode.svg`);
}
