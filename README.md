# n8n-nodes-nuasense

NuaSense for [n8n](https://n8n.io): what your weather station means for house, garden and farm, a way to send any station you already have to NuaSense, and East African farm and market data.

- **Station**: frost tonight, how much to water today (mm, after the rain of the last 24 h and the rain forecast for the next 24 h), the next calm and dry spray window, and a plausibility check of the station's temperature. Send readings from any station n8n can read (MQTT, Home Assistant, a webhook, a CSV).
- **Dataset**: rows from 38 farm and market datasets: your own stations and soil probes, county crop and input prices, satellite demand, food security, rainfall against normal, for Kenya, Tanzania, Uganda and Rwanda.
- **Analysis**: 26 ready-made answers, such as where fertilizer is cheapest in a county or how a county's season compares with normal.

The node can be used as a tool by n8n's AI Agent. On a self-hosted n8n, community nodes become agent tools only with `N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true`.

## Installation

In n8n: **Settings → Community Nodes → Install**, package name `n8n-nodes-nuasense`. See the [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

1. Create an account at [platform.nuasense.com](https://platform.nuasense.com) and confirm your email.
2. Under **API Keys**, verify your phone (a code by SMS or WhatsApp), then create a key. It is shown once.
3. In n8n, create a **NuaSense API** credential and paste the key. n8n checks it against the catalog.

Market data needs no station. Station first looks and lists read the stations on the key's own account. **Send Reading** needs no key at all, only the station token.

## Operations

| Resource | Operation | What it does |
|---|---|---|
| Station | Get First Look | Frost tonight, watering today in mm for lawn, vegetables and beds, the next spray window, plausibility of the latest reading |
| Station | Get Many | The external stations on your account, with when each last sent |
| Station | Send Reading | One reading to NuaSense: temperature (°C), humidity (%), pressure (hPa), wind (m/s or km/h), gusts, direction, rain total (mm, a counter that only grows), solar radiation or light |
| Dataset | Get Rows | Rows from one dataset, with time range, filters, downsampling; one item per row |
| Analysis | Ask | One of the ready-made analyses, with its parameters |
| Catalog | Get | The datasets, fields and filters your key reaches |

## Example workflows

**Water only when it is needed.** Schedule Trigger at 06:00 → NuaSense *Station → Get First Look* → IF `{{ $json.garden.watering.need_mm.lawn }}` is above 0 → open the valve (Home Assistant, MQTT or a smart plug) for the minutes your sprinkler needs. On a day with rain coming the need is 0 and nothing opens.

**Frost warning.** Schedule Trigger at 18:00 → *Get First Look* → IF `{{ $json.tonight.frost }}` is not `none` → message on Telegram, Slack or email with `{{ $json.tonight.low_c }}` °C.

**Bring a station you already have.** MQTT Trigger (or Home Assistant, or a webhook from your console) → NuaSense *Station → Send Reading* with the station token from the console. In the console: **External stations → Add a station**, pick *Home Assistant / weewx / Meteobridge / Node-RED*, and copy the part after `/station/` on the last screen. The first three stations on an account are free.

**Price watch.** Schedule Trigger weekly → *Dataset → Get Rows*, dataset *Market: Commodity prices*, filters `county = nakuru`, `commodity = maize`, start `-14d` → compare with last week → message.

**AI Agent tool.** Add NuaSense as a tool to an AI Agent node; the agent can then answer "should I water today?" or "where is DAP cheapest near Eldoret?" from live data.

## Your data

When you connect a station, NuaSense stores its readings and computes your forecast, spray windows and risks from them. The readings are used aggregated and anonymised to improve forecasts and models for everyone; they are never passed on individually without your opt-in. You can disconnect the station in the console at any time and have all its data deleted.

## Links

- Docs for developers and agents: https://api.nuasense.com/index.md
- OpenAPI: https://api.nuasense.com/openapi.json
- Console: https://platform.nuasense.com
- Issues: https://github.com/nuasense/n8n-nodes-nuasense/issues · info@nuasense.com

## Development

The dataset and analysis lists are generated from the NuaSense API catalog (`npm run catalog`, inside the NuaSense monorepo). `npm run build`, `npm run lint`, `npm test`.

## License

MIT
