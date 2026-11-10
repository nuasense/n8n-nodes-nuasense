// Behaviour of the built node (dist/), with n8n's execute context faked: what
// it sends to NuaSense for each operation, how it converts a reading, and how
// it fails. No network.
//
//   npm run build && npm test

const test = require('node:test');
const assert = require('node:assert/strict');
const { NuaSense } = require('../dist/nodes/NuaSense/NuaSense.node.js');
const { NuaSenseApi } = require('../dist/credentials/NuaSenseApi.credentials.js');
const eco = require('../dist/nodes/NuaSense/ecowitt.js');

function context(params, { reply = {}, raw = { statusCode: 200, body: 'success' } } = {}) {
	const calls = [];
	const ctx = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getNode: () => ({ name: 'NuaSense', type: 'n8n-nodes-nuasense.nuaSense', typeVersion: 1, parameters: {} }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async function (cred, req) {
				calls.push({ cred, ...req });
				return typeof reply === 'function' ? reply(req) : reply;
			},
			httpRequest: async (req) => {
				calls.push({ cred: null, ...req });
				return raw;
			},
		},
	};
	return { ctx, calls };
}

const run = (params, opts) => {
	const { ctx, calls } = context(params, opts);
	return new NuaSense().execute.call(ctx).then((out) => ({ out: out[0], calls }));
};

test('the node is usable as an AI tool and declares its credential', () => {
	const d = new NuaSense().description;
	assert.equal(d.usableAsTool, true);
	assert.equal(d.credentials[0].name, 'nuaSenseApi');
	assert.deepEqual(d.credentials[0].displayOptions.hide.operation, ['sendReading']);
});

test('the credential sends a bearer key and tests against the catalog', () => {
	const c = new NuaSenseApi();
	assert.equal(c.authenticate.properties.headers.Authorization, '=Bearer {{$credentials.apiKey}}');
	assert.equal(c.test.request.baseURL + c.test.request.url, 'https://api.nuasense.com/api/nuasense/v1/catalog');
});

test('first look asks for one station and tags the client', async () => {
	const { out, calls } = await run({ resource: 'station', operation: 'getFirstLook', stationId: 'garden-west' }, { reply: { station_id: 'garden-west', garden: {} } });
	assert.equal(calls[0].cred, 'nuaSenseApi');
	assert.equal(calls[0].url, 'https://api.nuasense.com/api/nuasense/v1/ingest/first-look');
	assert.equal(calls[0].qs.station_id, 'garden-west');
	assert.equal(calls[0].headers['X-NuaSense-Client'], 'n8n/0.1.0');
	assert.equal(out[0].json.station_id, 'garden-west');
});

test('dataset rows: filters, options, one item per row', async () => {
	const reply = { dataset: 'market.commodity_prices', rows: [{ time: 't1', price: 1 }, { time: 't2', price: 2 }] };
	const { out, calls } = await run(
		{
			resource: 'dataset', operation: 'getRows', dataset: '/market/prices', start: '-7d', limit: 20,
			filters: { filter: [{ name: 'county', value: 'nakuru,kisumu' }] },
			options: { every: '1d', fields: 'price', oldestFirst: true },
		},
		{ reply },
	);
	const q = calls[0].qs;
	assert.equal(calls[0].url, 'https://api.nuasense.com/api/nuasense/v1/market/prices');
	assert.deepEqual([q.start, q.limit, q.county, q.every, q.agg, q.fields, q.order], ['-7d', 20, 'nakuru,kisumu', '1d', 'mean', 'price', 'asc']);
	assert.equal(out.length, 2);
	assert.deepEqual(out[1].json, { dataset: 'market.commodity_prices', time: 't2', price: 2 });
});

test('dataset rows as one item when asked', async () => {
	const { out } = await run({ resource: 'dataset', operation: 'getRows', dataset: '/market/prices', options: { splitRows: false } }, { reply: { rows: [{}, {}] } });
	assert.equal(out.length, 1);
	assert.equal(out[0].json.rows.length, 2);
});

test('an analysis goes to the analysis base with its parameters', async () => {
	const { calls } = await run({ resource: 'analysis', operation: 'ask', analysis: '/fertilizer/price', parameters: { parameter: [{ name: 'county', value: 'nakuru' }] } }, { reply: {} });
	assert.equal(calls[0].url, 'https://api.nuasense.com/api/partner/v1/market/fertilizer/price');
	assert.equal(calls[0].qs.county, 'nakuru');
});

test('send reading: metric in, Ecowitt form out, no API key, HTTPS', async () => {
	const { out, calls } = await run({
		resource: 'station', operation: 'sendReading', token: 'KW7N-4HPD-X2VT', deviceId: 'shed',
		reading: { temperature: 20, humidity: 55.4, pressure: 1013.25, windSpeed: 36, windUnit: 'kmh', rainTotal: 25.4, lux: 12000 },
	});
	assert.equal(calls[0].cred, null);
	assert.equal(calls[0].method, 'POST');
	assert.equal(calls[0].url, 'https://api.nuasense.com/station/kw7n-4hpd-x2vt');
	const form = new URLSearchParams(calls[0].body);
	assert.equal(form.get('tempf'), '68');
	assert.equal(form.get('humidity'), '55');
	assert.equal(form.get('baromabsin'), '29.921');
	assert.equal(form.get('windspeedmph'), '22.37');
	assert.equal(form.get('yearlyrainin'), '1');
	assert.equal(form.get('solarradiation'), '100');
	assert.equal(form.get('PASSKEY'), eco.passkeyFor('shed'));
	assert.equal(out[0].json.sent, true);
});

test('send reading: an unknown token is explained', async () => {
	await assert.rejects(
		run({ resource: 'station', operation: 'sendReading', token: 'abcd-efgh-ijkl', reading: { temperature: 1 } }, { raw: { statusCode: 404, body: 'not found' } }),
		/does not know this station token/,
	);
});

test('send reading: nothing to send is refused before any call', async () => {
	const { ctx, calls } = context({ resource: 'station', operation: 'sendReading', token: 'abcd-efgh-ijkl', reading: {} });
	await assert.rejects(new NuaSense().execute.call(ctx), /at least one value/);
	assert.equal(calls.length, 0);
});

test('send reading: a malformed token is refused before any call', async () => {
	const { ctx, calls } = context({ resource: 'station', operation: 'sendReading', token: 'https://x', reading: { temperature: 1 } });
	await assert.rejects(new NuaSense().execute.call(ctx), /token looks wrong/);
	assert.equal(calls.length, 0);
});

test('the passkey is stable, 32 hex, and differs per device', () => {
	assert.match(eco.passkeyFor('shed'), /^[0-9A-F]{32}$/);
	assert.equal(eco.passkeyFor('shed'), eco.passkeyFor('shed'));
	assert.notEqual(eco.passkeyFor('shed'), eco.passkeyFor('roof'));
});

test('the dataset list leaves out what the public API withholds', () => {
	const { DATASETS, ANALYSES } = require('../dist/nodes/NuaSense/catalog.js');
	const paths = DATASETS.map((d) => d.path);
	assert.ok(paths.includes('/market/prices') && paths.includes('/farm/weather'));
	assert.ok(!paths.includes('/market/trade') && !paths.includes('/market/field-structure'));
	assert.ok(!ANALYSES.some((a) => a.path.startsWith('/trade/') || a.path.startsWith('/alerts')));
});
