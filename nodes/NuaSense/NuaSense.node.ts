import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { ANALYSES, DATASETS } from './catalog';
import { encodeForm, hasValues, toEcowittFields, uploadUrl } from './ecowitt';
import type { MetricReading } from './ecowitt';

const API = 'https://api.nuasense.com';
const DATA = `${API}/api/nuasense/v1`;
const ANALYSIS = `${API}/api/partner/v1/market`;
// Tells NuaSense the call came from this node. Changes nothing in price or limits.
const CLIENT = 'n8n/0.1.0';

const GROUP_LABEL: Record<string, string> = { farm: 'Farm', market: 'Market' };

interface NameValue {
	name: string;
	value: string;
}

function pairs(collection: IDataObject, key: string): NameValue[] {
	const list = (collection?.[key] as NameValue[] | undefined) ?? [];
	return list.filter((p) => p && p.name);
}

export class NuaSense implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'NuaSense',
		name: 'nuaSense',
		icon: { light: 'file:nuasense.svg', dark: 'file:nuasense.dark.svg' },
		group: ['input'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'East African farm and market data: your weather stations with frost, watering and spray advice, and prices, satellite demand and food security for Kenya, Tanzania, Uganda and Rwanda',
		defaults: {
			name: 'NuaSense',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'nuaSenseApi',
				required: true,
				displayOptions: {
					hide: {
						operation: ['sendReading'],
					},
				},
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Analysis', value: 'analysis', description: 'Ready-made answers to market questions' },
					{ name: 'Catalog', value: 'catalog', description: 'What your key can reach' },
					{ name: 'Dataset', value: 'dataset', description: 'Rows from a farm or market dataset' },
					{ name: 'Station', value: 'station', description: 'Your own weather stations' },
				],
				default: 'station',
			},

			// ---- operations --------------------------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['station'] } },
				options: [
					{
						name: 'Get First Look',
						value: 'getFirstLook',
						description: 'Frost tonight, watering today, the next spray window and a plausibility check for one station',
						action: 'Get the first look for a station',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'List the external stations on your account',
						action: 'List stations',
					},
					{
						name: 'Send Reading',
						value: 'sendReading',
						description: 'Send one reading of a station to NuaSense, with the station token from the console',
						action: 'Send a station reading',
					},
				],
				default: 'getFirstLook',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['dataset'] } },
				options: [
					{
						name: 'Get Rows',
						value: 'getRows',
						description: 'Read rows from one dataset',
						action: 'Get rows from a dataset',
					},
				],
				default: 'getRows',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['analysis'] } },
				options: [
					{
						name: 'Ask',
						value: 'ask',
						description: 'Ask one of the ready-made analyses',
						action: 'Ask an analysis',
					},
				],
				default: 'ask',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['catalog'] } },
				options: [
					{
						name: 'Get',
						value: 'get',
						description: 'List the datasets, fields and filters this key reaches',
						action: 'Get the catalog',
					},
				],
				default: 'get',
			},

			// ---- station -----------------------------------------------------
			{
				displayName: 'Station ID',
				name: 'stationId',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'garden-west',
				description: 'The station ID as listed by Station → Get Many, or in the console under External stations',
				displayOptions: { show: { resource: ['station'], operation: ['getFirstLook'] } },
			},
			{
				displayName: 'Station Token',
				name: 'token',
				type: 'string',
				typeOptions: { password: true },
				required: true,
				default: '',
				placeholder: 'kw7n-4hpd-x2vt',
				description:
					'The part after /station/ on the last screen of "Add a station" in the console. Pick "Home Assistant / weewx / Meteobridge / Node-RED" as the brand.',
				displayOptions: { show: { resource: ['station'], operation: ['sendReading'] } },
			},
			{
				displayName: 'Device ID',
				name: 'deviceId',
				type: 'string',
				default: 'n8n',
				description:
					'Names the device that sends. The station is bound to the first device ID that uses its token, so keep it stable.',
				displayOptions: { show: { resource: ['station'], operation: ['sendReading'] } },
			},
			{
				displayName: 'Reading',
				name: 'reading',
				type: 'collection',
				placeholder: 'Add Value',
				default: {},
				description: 'Metric values. Values you leave out are not sent.',
				displayOptions: { show: { resource: ['station'], operation: ['sendReading'] } },
				options: [
					{ displayName: 'Humidity (%)', name: 'humidity', type: 'number', default: 0 },
					{ displayName: 'Light (Lux)', name: 'lux', type: 'number', default: 0, description: 'Used only when solar radiation is not given' },
					{ displayName: 'Pressure (hPa, Station Level)', name: 'pressure', type: 'number', default: 0 },
					{
						displayName: 'Rain Total (Mm)',
						name: 'rainTotal',
						type: 'number',
						default: 0,
						description: 'A counter that only grows, as most stations report it; NuaSense turns it into amounts per interval',
					},
					{ displayName: 'Solar Radiation (W/m²)', name: 'solar', type: 'number', default: 0 },
					{ displayName: 'Temperature (°C)', name: 'temperature', type: 'number', default: 0 },
					{
						displayName: 'Time',
						name: 'time',
						type: 'dateTime',
						default: '',
						description: 'When the reading was taken. Now when left out.',
					},
					{ displayName: 'Wind Direction (°)', name: 'windDirection', type: 'number', default: 0 },
					{ displayName: 'Wind Gusts', name: 'windGusts', type: 'number', default: 0 },
					{ displayName: 'Wind Speed', name: 'windSpeed', type: 'number', default: 0 },
					{
						displayName: 'Wind Unit',
						name: 'windUnit',
						type: 'options',
						options: [
							{ name: 'Km/h', value: 'kmh' },
							{ name: 'M/s', value: 'ms' },
						],
						default: 'ms',
					},
				],
			},

			// ---- dataset -----------------------------------------------------
			{
				displayName: 'Dataset',
				name: 'dataset',
				type: 'options',
				required: true,
				default: '/market/prices',
				description: 'Farm datasets read your own stations and probes; market datasets cover Kenya, Tanzania, Uganda and Rwanda',
				options: DATASETS.map((d) => ({
					name: `${GROUP_LABEL[d.group] ?? d.group}: ${d.title}`,
					value: d.path,
					description: d.description.length > 240 ? `${d.description.slice(0, 237)}...` : d.description,
				})).sort((a, b) => a.name.localeCompare(b.name)),
				displayOptions: { show: { resource: ['dataset'] } },
			},
			{
				displayName: 'Start',
				name: 'start',
				type: 'string',
				default: '-24h',
				description: 'RFC3339 time, or relative to now such as -7d or -24h',
				displayOptions: { show: { resource: ['dataset'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 5000 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { resource: ['dataset'] } },
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Filter',
				default: {},
				description: 'Only the filters the chosen dataset declares are accepted. Several values comma-separated.',
				displayOptions: { show: { resource: ['dataset'] } },
				options: [
					{
						name: 'filter',
						displayName: 'Filter',
						values: [
							{
								displayName: 'Name or ID',
								name: 'name',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getDatasetFilters', loadOptionsDependsOn: ['dataset'] },
								default: '',
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: ['dataset'] } },
				options: [
					{
						displayName: 'Aggregation',
						name: 'agg',
						type: 'options',
						options: ['count', 'first', 'last', 'max', 'mean', 'min', 'sum'].map((a) => ({ name: a, value: a })),
						default: 'mean',
						description: 'How to combine rows within each Every window',
					},
					{ displayName: 'End', name: 'end', type: 'string', default: '', description: 'RFC3339 time or relative duration. Now when left out.' },
					{ displayName: 'Every', name: 'every', type: 'string', default: '', placeholder: '1h', description: 'Downsample window, for example 1h or 1d' },
					{ displayName: 'Fields', name: 'fields', type: 'string', default: '', description: 'Comma-separated subset of the dataset\'s fields' },
					{
						displayName: 'Oldest First',
						name: 'oldestFirst',
						type: 'boolean',
						default: false,
						description: 'Whether to return the oldest rows first instead of the newest',
					},
					{
						displayName: 'One Item per Row',
						name: 'splitRows',
						type: 'boolean',
						default: true,
						description: 'Whether to output one item per row instead of the whole response as one item',
					},
				],
			},

			// ---- analysis ----------------------------------------------------
			{
				displayName: 'Question',
				name: 'analysis',
				type: 'options',
				required: true,
				default: '/fertilizer/price',
				options: ANALYSES.map((a) => ({ name: a.question, value: a.path })).sort((a, b) => a.name.localeCompare(b.name)),
				displayOptions: { show: { resource: ['analysis'] } },
			},
			{
				displayName: 'Parameters',
				name: 'parameters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				placeholder: 'Add Parameter',
				default: {},
				displayOptions: { show: { resource: ['analysis'] } },
				options: [
					{
						name: 'parameter',
						displayName: 'Parameter',
						values: [
							{
								displayName: 'Name or ID',
								name: 'name',
								type: 'options',
								typeOptions: { loadOptionsMethod: 'getAnalysisParams', loadOptionsDependsOn: ['analysis'] },
								default: '',
								description:
									'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
							},
							{ displayName: 'Value', name: 'value', type: 'string', default: '' },
						],
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getDatasetFilters(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const path = this.getCurrentNodeParameter('dataset') as string;
				const d = DATASETS.find((x) => x.path === path);
				return (d?.filters ?? []).map((f) => ({ name: f, value: f }));
			},
			async getAnalysisParams(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const path = this.getCurrentNodeParameter('analysis') as string;
				const a = ANALYSES.find((x) => x.path === path);
				return (a?.params ?? []).map((p) => ({ name: p, value: p }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;

				if (resource === 'station' && operation === 'sendReading') {
					const token = this.getNodeParameter('token', i) as string;
					const deviceId = this.getNodeParameter('deviceId', i, 'n8n') as string;
					const reading = this.getNodeParameter('reading', i, {}) as MetricReading;
					const fields = toEcowittFields(reading, deviceId, CLIENT.replace('/', '_'));
					if (!hasValues(fields)) {
						throw new NodeOperationError(this.getNode(), 'Add at least one value to the reading', { itemIndex: i });
					}
					let url: string;
					try {
						url = uploadUrl(token);
					} catch (e) {
						throw new NodeOperationError(this.getNode(), (e as Error).message, { itemIndex: i });
					}
					const answer = await this.helpers.httpRequest({
						method: 'POST',
						url,
						body: encodeForm(fields),
						headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-NuaSense-Client': CLIENT },
						json: false,
						returnFullResponse: true,
						ignoreHttpStatusErrors: true,
					});
					const status = Number(answer.statusCode);
					if (status === 404) {
						throw new NodeOperationError(this.getNode(), 'NuaSense does not know this station token', {
							itemIndex: i,
							description: 'Copy the token again from the console, or add the station first.',
						});
					}
					if (status >= 400) {
						throw new NodeOperationError(this.getNode(), `NuaSense refused the reading (${status}): ${String(answer.body).slice(0, 200)}`, {
							itemIndex: i,
						});
					}
					out.push({ json: { sent: true, status, answer: String(answer.body).trim(), fields }, pairedItem: i });
					continue;
				}

				const request: IHttpRequestOptions = {
					method: 'GET',
					url: '',
					qs: {},
					headers: { 'X-NuaSense-Client': CLIENT },
					json: true,
				};
				const qs = request.qs as IDataObject;

				if (resource === 'catalog') {
					request.url = `${DATA}/catalog`;
				} else if (resource === 'station' && operation === 'getAll') {
					request.url = `${DATA}/ingest/stations`;
				} else if (resource === 'station' && operation === 'getFirstLook') {
					request.url = `${DATA}/ingest/first-look`;
					qs.station_id = this.getNodeParameter('stationId', i) as string;
				} else if (resource === 'dataset') {
					request.url = `${DATA}${this.getNodeParameter('dataset', i) as string}`;
					qs.start = this.getNodeParameter('start', i, '-24h') as string;
					qs.limit = this.getNodeParameter('limit', i, 50) as number;
					for (const f of pairs(this.getNodeParameter('filters', i, {}) as IDataObject, 'filter')) qs[f.name] = f.value;
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					for (const key of ['end', 'every', 'agg', 'fields']) {
						if (options[key]) qs[key] = options[key];
					}
					if (options.every && !options.agg) qs.agg = 'mean';
					if (options.oldestFirst) qs.order = 'asc';
				} else if (resource === 'analysis') {
					request.url = `${ANALYSIS}${this.getNodeParameter('analysis', i) as string}`;
					for (const p of pairs(this.getNodeParameter('parameters', i, {}) as IDataObject, 'parameter')) qs[p.name] = p.value;
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation ${resource}/${operation}`, { itemIndex: i });
				}

				const body = (await this.helpers.httpRequestWithAuthentication.call(this, 'nuaSenseApi', request)) as IDataObject;

				if (resource === 'dataset') {
					const options = this.getNodeParameter('options', i, {}) as IDataObject;
					const split = options.splitRows === undefined ? true : Boolean(options.splitRows);
					const rows = Array.isArray(body.rows) ? (body.rows as IDataObject[]) : [];
					if (split) {
						for (const row of rows) out.push({ json: { dataset: body.dataset, ...row }, pairedItem: i });
						continue;
					}
				}
				out.push({ json: body, pairedItem: i });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: i });
					continue;
				}
				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex: i, description: error.description ?? undefined });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex: i });
			}
		}
		return [out];
	}
}
