# ZOE

ZOE helps farmers compare crop-rotation ideas against difficult years in a location’s climate record. It shows model-generated options and trade-offs for local discussion. It does not predict yields or choose crops for a farm.

For the full project explanation, including the model, product attribution, and judge notes, see [JUDGE-GUIDE.md](JUDGE-GUIDE.md).

## Run ZOE locally

Use Python 3.10 or newer. From the project folder, run these commands in fish:

```fish
python3 -m venv .venv
source .venv/bin/activate.fish
python -m pip install -r requirements.txt
python server.py
```

Open <http://127.0.0.1:8000>. Search for a U.S. city or ZIP code, then mark at least three field corners. Choose **Use sample field** to load the Story County example. Stop the server with Ctrl+C. Leave the virtual environment with `deactivate`.

For a live analysis, the server requests daily NASA POWER data from 2004 through a date expected to be complete. POWER supplies a gridded estimate for the field outline’s center point. It does not measure conditions across the whole field, and no Earthdata account is needed for this request.

## Try the GitHub Pages sample

The project’s root `index.html` is the entry page. The workflow in `.github/workflows/pages.yml` publishes it with the static files and saved Story County sample. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source. After the workflow succeeds, GitHub shows the site address in its deployment summary.

Pages cannot run the Python model or keep Earthdata credentials private. Its walkthrough opens the saved Story County result with `?demo=true`. That result uses a synthetic weather series, which the page labels clearly. Live NASA POWER analysis, place search, custom field boundaries, and adjustable priorities are available when you run the Python server locally.

## Data sources and attribution

NASA POWER is the only product used in the live analysis. The other products below are listed with their providers and intended roles. They do not affect scores until the app downloads, checks, and uses their data. The results page marks which sources fed each run.

| Product | Producer or provider | Intended role | Product record |
|---|---|---|---|
| NASA POWER daily point API (MERRA-2) | NASA Langley Research Center | Temperature, precipitation, humidity, wind, and solar radiation; used live | [API documentation](https://power.larc.nasa.gov/docs/services/api/temporal/daily/) |
| SMAP L4 `SPL4SMGP`, Version 8 | NASA; NSIDC DAAC | Root-zone soil-moisture context at about 9 km | [Version 8 record](https://nsidc.org/data/spl4smgp/versions/8), [DOI](https://doi.org/10.5067/T5RUATAQREF8) |
| GPM IMERG Final `GPM_3IMERGHH`, V07 | NASA and JAXA mission; NASA GES DISC distributes the data | Rainfall intensity and dry-spell context | [DOI](https://doi.org/10.5067/GPM/IMERG/3B-HH/07) |
| ECOSTRESS tiled ET dis-ALEXI `ECO_L3T_ET_ALEXI.002` | NASA JPL / LP DAAC; instrument aboard the International Space Station | Evapotranspiration and plant-water stress | [DOI](https://doi.org/10.5067/ECOSTRESS/ECO_L3T_ET_ALEXI.002) |
| MODIS Terra vegetation indices `MOD13Q1.061` | NASA; LP DAAC | Vegetation condition and phenology | [DOI](https://doi.org/10.5067/MODIS/MOD13Q1.061) |
| Landsat Collection 2 Level-2 surface reflectance | Joint NASA-USGS program; USGS hosts and distributes the STAC collection | Finer-scale vegetation and land-cover history | [USGS STAC collection](https://landsatlook.usgs.gov/stac-server/collections/landsat-c2l2-sr) |
| SRTM `SRTMGL1` | NASA, U.S. NGA, and German and Italian space agencies | Elevation-derived slope and erosion proxy | [DOI](https://doi.org/10.5067/MEaSUREs/SRTM/SRTMGL1N.003) |
| GRACE / GRACE-FO assimilation `GRACEDADM_CLSM0125US_7D` | NASA assimilation product; GRACE-FO is a NASA-GFZ partnership mission | Regional, multi-year water-storage context | [DOI](https://doi.org/10.5067/UH653SEZR9VQ) |


## How the comparison works

- The weather screen flags days that are unusually hot with low recent rain, unusually hot with dry air and high wind, or very wet with freezing temperatures. These are screening rules, not proof of crop damage.
- ZOE calls the year with the most flagged days the hardest year in that record. Its historical-rarity measure compares that year with the same record; it is not a forecast or a future probability.
- Crop scores use hand-set traits for water needs, heat and weather sensitivity, soil contribution, cover, nitrogen fixation, and forage. They are not measured yield or soil-improvement estimates.
- A custom particle-swarm search compares four-crop sequences using the hardest-year score, soil traits, and the priorities set by the farmer.

Soil tests, drainage, planting dates, disease, markets, policy, livestock needs, and farm equipment are not included. Even coarse satellite products cannot show every difference within a field. Review any option with local extension staff or an agronomist.
