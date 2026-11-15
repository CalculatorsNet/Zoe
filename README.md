# ZOE

A NASA Space Apps 2026 decision-support prototype for exploring crop rotations under climate variability. Draw a field, set water / soil / forage priorities, then compare four-season sequences against compound stress in that location's historical climate record.

## Run it

Requires Python 3.10+ and the packages in `requirements.txt`.

```sh
python -m pip install -r requirements.txt
python server.py
```

Open <http://127.0.0.1:8000>. Click at least three corners on the map, tune the three priorities, and run the analysis. **Use saved field** loads the Story County, Iowa sample boundary. `?demo=true` loads that boundary on page open. The bundled climate series is a deterministic synthetic fallback for a dependable offline interaction; it is clearly identified in the analysis as a saved climate record and is not represented as observed NASA data.

The interface uses Red Hat Display and Red Hat Text from Google Fonts, with Red Hat Mono for numeric values. An internet connection is needed to load those typefaces.

NASA POWER is fetched live from the daily point API (`T2M`, `T2M_MAX`, `T2M_MIN`, `PRECTOTCORR`, `RH2M`, `WS2M`, and solar radiation). It does not require an API key. `/api/health` reports server readiness. Earthdata Login is free at <https://urs.earthdata.nasa.gov>; put credentials in `~/.netrc` only if you extend the server to request restricted Earthdata granules. The current prototype does not download those granules.

## NASA data ledger

POWER is the live data source. The other listed products are mapped to roles in the model and shown in the ledger as context / future integrations; this build does not ingest their granules. Do not treat their presence in the ledger as evidence of data fusion.

| Dataset | Product / identifier | Intended role |
|---|---|---|
| SMAP L4 | SPL4SMGP · DOI [10.5067/EVKPQZ4AFC4D](https://doi.org/10.5067/EVKPQZ4AFC4D) | Root-zone moisture context; 9 km resolution |
| ECOSTRESS | ECO3ETALEXI V001 | Evapotranspiration / heat context |
| GPM IMERG Final | GPM_3IMERGHH V07 · DOI [10.5067/GPM/IMERG/3B-HH/07](https://doi.org/10.5067/GPM/IMERG/3B-HH/07) | Rainfall intensity and dry spells |
| MODIS Terra VI | MOD13Q1 V061 · DOI [10.5067/MODIS/MOD13Q1.061](https://doi.org/10.5067/MODIS/MOD13Q1.061) | Vegetation condition and phenology |
| Landsat C2 L2 | USGS Landsat Collection 2 STAC | Higher-resolution land-use history |
| NASA POWER | Daily point API, MERRA-2 | Live meteorological backbone |
| SRTM | SRTMGL1 · DOI [10.5067/MEaSUREs/SRTM/SRTMGL1N.003](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1N.003) | Slope / erosion proxy |
| GRACE / GRACE-FO | GRACEDADM_CLSM0125US_7D V4.0 | Long-term water availability context |

## How the analysis works

- Compound-risk baseline combines an Isolation Forest multivariate anomaly detector with a transparent joint heat / low-30-day-rainfall threshold.
- A seasonal envelope and Kernel Density Estimate summarize the observed climate-condition distribution. The novelty fraction is a statistical proxy, not a crop-specific forecast.
- A Random Forest path is fitted to illustrative crop-trait proxies, not measured yield data.
- A custom categorical particle swarm searches four-season crop sequences. Crop coefficients are fixed illustrative assumptions; the ranking is a scenario exploration, not locally calibrated agronomy.

## Limitations

NASA POWER describes gridded / reanalysis conditions, not field-gauge observations. SMAP is roughly 9 km and cannot resolve within-field moisture variation. The offline record is synthetic. Crop traits and season timing require local validation. Soil test values, drainage, disease pressure, crop prices, markets, insurance, policy and farm equipment are not modeled. Review any option with local extension staff, a soil test, and the farmer's own experience. This tool supports farmer judgment; it does not replace it.
