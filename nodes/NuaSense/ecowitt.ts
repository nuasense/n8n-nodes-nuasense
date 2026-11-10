// Metric readings in, an Ecowitt-format upload out.
//
// NuaSense's station receiver speaks what consumer consoles speak, and the
// Ecowitt format is the richest of them. So the node sends the same form a
// GW2000 console would: imperial units, rain as a running counter, and a
// PASSKEY that names the device so the receiver can bind the station's path to
// it. Pure functions, no imports: tested without n8n.

const INHG_PER_HPA = 1 / 33.8639;
const MPH_PER_MS = 1 / 0.44704;
const IN_PER_MM = 1 / 25.4;
// Daylight: 120 lux per W/m² of global radiation, the receiver's own factor
// used the other way, so a workflow that only has lux lands on the same number.
const LUX_PER_WM2 = 120;

export interface MetricReading {
	temperature?: number;
	humidity?: number;
	pressure?: number;
	windSpeed?: number;
	windUnit?: 'ms' | 'kmh';
	windGusts?: number;
	windDirection?: number;
	rainTotal?: number;
	solar?: number;
	lux?: number;
	time?: string;
}

function num(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function fix(n: number, digits: number): string {
	return String(Number(n.toFixed(digits)));
}

/** Ecowitt's `dateutc`: "YYYY-MM-DD HH:MM:SS" in UTC. */
export function dateUtc(when?: string): string {
	const d = when ? new Date(when) : new Date();
	const t = Number.isNaN(d.getTime()) ? new Date() : d;
	return t.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * A stable 32-hex PASSKEY from the device name: four FNV-1a passes with
 * different offsets. Not a secret and not a security measure; it only has to
 * stay the same for the same device, because the receiver binds a station's
 * path to the first device that uses it.
 */
export function passkeyFor(deviceId: string): string {
	const text = String(deviceId || 'n8n');
	let out = '';
	for (const seed of [0x811c9dc5, 0x01000193, 0x6c62272e, 0x9e3779b9]) {
		let h = seed >>> 0;
		for (let i = 0; i < text.length; i++) {
			h ^= text.charCodeAt(i);
			h = Math.imul(h, 0x01000193) >>> 0;
		}
		out += h.toString(16).padStart(8, '0');
	}
	return out.toUpperCase();
}

/** The form fields, as strings, in the order a console sends them. */
export function toEcowittFields(
	r: MetricReading,
	deviceId: string,
	stationType: string,
): Record<string, string> {
	const fields: Record<string, string> = {
		PASSKEY: passkeyFor(deviceId),
		stationtype: stationType,
		dateutc: dateUtc(r.time),
	};
	const t = num(r.temperature);
	if (t !== null) fields.tempf = fix((t * 9) / 5 + 32, 2);
	const h = num(r.humidity);
	if (h !== null) fields.humidity = String(Math.round(h));
	const p = num(r.pressure);
	if (p !== null) fields.baromabsin = fix(p * INHG_PER_HPA, 3);
	const toMs = r.windUnit === 'kmh' ? 1 / 3.6 : 1;
	const ws = num(r.windSpeed);
	if (ws !== null) fields.windspeedmph = fix(ws * toMs * MPH_PER_MS, 2);
	const wg = num(r.windGusts);
	if (wg !== null) fields.windgustmph = fix(wg * toMs * MPH_PER_MS, 2);
	const wd = num(r.windDirection);
	if (wd !== null) fields.winddir = String(Math.round(((wd % 360) + 360) % 360));
	const rain = num(r.rainTotal);
	if (rain !== null) fields.yearlyrainin = fix(rain * IN_PER_MM, 3);
	const sol = num(r.solar);
	const lux = num(r.lux);
	if (sol !== null) fields.solarradiation = fix(sol, 2);
	else if (lux !== null) fields.solarradiation = fix(lux / LUX_PER_WM2, 2);
	return fields;
}

export function encodeForm(fields: Record<string, string>): string {
	return Object.entries(fields)
		.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
		.join('&');
}

/** The upload URL for a token as the console shows it, e.g. kw7n-4hpd-x2vt. */
export function uploadUrl(token: string): string {
	const tok = String(token || '')
		.trim()
		.toLowerCase();
	if (!/^[a-z0-9-]{12,29}$/.test(tok)) {
		throw new Error('The station token looks wrong. Copy it from the last screen of "Add a station" in the console.');
	}
	return `https://api.nuasense.com/station/${tok}`;
}

/** True when at least one measured value is present. */
export function hasValues(fields: Record<string, string>): boolean {
	return Object.keys(fields).some((k) => !['PASSKEY', 'stationtype', 'dateutc'].includes(k));
}
