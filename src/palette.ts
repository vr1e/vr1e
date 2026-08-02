// The card's colour domain: the nine theme roles, the five palettes, and the
// date -> palette selector. Kept out of card.ts so the renderer stays renderer.

export type PaletteName = 'autumn' | 'winter' | 'spring' | 'summer' | 'matrix';

export interface Theme {
	background: string;
	// Declared for completeness; nothing in the renderer draws an edge.
	border: string;
	text: string;
	key: string;
	value: string;
	dots: string;
	header: string;
	plus: string;
	minus: string;
}

// One Theme object shared by both modes. Matrix ignores the viewer's light/dark
// preference on purpose: a light-mode reader gets a black card. That's the joke,
// not a bug — and the shared reference is what stops the two drifting.
const matrixTheme: Theme = {
	background: '#000000',
	border: '#0d3d19',
	text: '#a5f0ae',
	key: '#7ce889',
	value: '#52c464',
	dots: '#1e5e2d',
	header: '#00ff41',
	plus: '#2f9440',
	minus: '#7ffff0'
};

// Each seasonal palette is a dark neutral ground carrying a trace of the
// season's hue, an off-white `text` (the ASCII art is never tinted — that is
// what keeps all four reading as the same card), two accent hues spread across
// key/value/header, and `dots` as a desaturated lift of the background. Light
// mode is the same hues on tinted paper, never the dark palette inverted.
export const themes: Record<PaletteName, Record<'dark' | 'light', Theme>> = {
	// Warm clay-on-plum after the classic neofetch screenshot look. Frozen.
	autumn: {
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
	},
	// Slate ground, steel-blue accents; `minus` is a cold rose so it stays
	// opposed to `plus` without going warm.
	winter: {
		dark: {
			background: '#212832',
			border: '#45505f',
			text: '#dee7f0',
			key: '#6f9ec6',
			value: '#a4c6de',
			dots: '#5d6b7c',
			header: '#8fbcdb',
			plus: '#84b0a4',
			minus: '#c4737f'
		},
		light: {
			background: '#eff4f8',
			border: '#ccd8e2',
			text: '#414d59',
			key: '#2f6b93',
			value: '#4d7c96',
			dots: '#97a8b6',
			header: '#35739d',
			plus: '#4f8a78',
			minus: '#a84c59'
		}
	},
	// Moss ground, leaf-green `key`, blossom-pink `header` — the only palette
	// where `header` breaks hue from `key`.
	spring: {
		dark: {
			background: '#222a25',
			border: '#4a574c',
			text: '#e7edda',
			key: '#a6c46a',
			value: '#c7dd8e',
			dots: '#61715f',
			header: '#e29ebf',
			plus: '#7ec089',
			minus: '#d4746f'
		},
		light: {
			background: '#f2f7e9',
			border: '#d2dcc2',
			text: '#434d3f',
			key: '#5e8434',
			value: '#7f6f1a',
			dots: '#9aa98b',
			header: '#b3567c',
			plus: '#4f8f5c',
			minus: '#bd5147'
		}
	},
	// Deep-sea ground, sun-gold `key`, turquoise `header`. Highest-chroma of the four.
	summer: {
		dark: {
			background: '#1a272c',
			border: '#3e5559',
			text: '#e5efe9',
			key: '#eeb84f',
			value: '#f3d38c',
			dots: '#526b6d',
			header: '#4fc2b0',
			plus: '#7ecf9a',
			minus: '#ee7a5a'
		},
		light: {
			background: '#fcf6e7',
			border: '#e2d9c0',
			text: '#3f4b46',
			key: '#a06f12',
			value: '#94702c',
			dots: '#aaa48d',
			header: '#14867a',
			plus: '#4f8f6a',
			minus: '#cc5a33'
		}
	},
	// Phosphor luminance ladder with exactly one hue break (`minus` goes
	// cyan-white). Alone among the five it puts `key` brighter than `value`,
	// which is what makes sparkline()'s ramp monotonic.
	matrix: { dark: matrixTheme, light: matrixTheme }
};

// Unix epoch (1970-01-01) was a Thursday; +3 days shifts week boundaries to
// Monday — the same instant the weekly cron fires, so a mid-week re-run of the
// workflow lands on the same week and renders the identical palette.
const weekIndex = (now: Date) => Math.floor((Math.floor(now.getTime() / 86_400_000) + 3) / 7);

// A monotonic epoch week index, not an ISO week number: ISO weeks reset each
// year, which would repeat the schedule annually and can double up at the
// 52/53 -> 1 rollover. Plain % 10, no hash mixer — so the schedule is a regular
// metronome and Matrix can never land two weeks running.
const isMatrixWeek = (w: number) => w % 10 === 0;

// Meteorological seasons, northern hemisphere: Mar/Jun/Sep/Dec 1. Read in UTC
// like formatUptime, so the palette never depends on the runner's timezone.
function seasonFor(now: Date): PaletteName {
	const month = now.getUTCMonth();
	if (month < 2 || month === 11) return 'winter';
	if (month < 5) return 'spring';
	if (month < 8) return 'summer';
	return 'autumn';
}

// Returns a palette *name*, not a Theme: resolving identity away here would
// force a re-plumb the moment anything downstream needs to know which palette
// is live. Matrix is checked before the season and replaces it, so a Matrix week
// straddling a boundary hides that changeover for the week.
export function paletteFor(now: Date): PaletteName {
	if (isMatrixWeek(weekIndex(now))) return 'matrix';
	return seasonFor(now);
}
