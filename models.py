"""Climate feature engineering and transparent risk summaries."""
from datetime import date
from pathlib import Path
import csv
import io
import json
import math
import netrc
import os
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestRegressor
from sklearn.neighbors import KernelDensity
from sklearn.preprocessing import StandardScaler

from optimizer import recommend_rotations

ROOT = Path(__file__).resolve().parent
DEMO_FILE = ROOT / "data" / "demo_field.json"
POWER_PARAMS = "T2M,T2M_MAX,T2M_MIN,PRECTOTCORR,RH2M,WS2M,ALLSKY_SFC_SW_DWN"
DATASETS = [
    {"name": "NASA POWER", "product": "Daily point meteorology (MERRA-2) · live source", "id": "POWER / temporal/daily/point", "role": "Temperature, precipitation, humidity, wind and solar radiation", "state": "live"},
    {"name": "SMAP L4", "product": "Global 3-hourly, 9 km EASE-Grid", "id": "SPL4SMGP · DOI 10.5067/EVKPQZ4AFC4D", "role": "Root-zone moisture context; not field-scale measurement", "state": "context"},
    {"name": "GPM IMERG", "product": "Final precipitation, half-hourly 0.1°", "id": "GPM_3IMERGHH V07 · DOI 10.5067/GPM/IMERG/3B-HH/07", "role": "Rainfall intensity and dry-spell context", "state": "context"},
    {"name": "ECOSTRESS", "product": "dis-ALEXI daily L3 CONUS, 70 m", "id": "ECO3ETALEXI V001", "role": "Evapotranspiration and crop water-use context", "state": "context"},
    {"name": "MODIS Terra VI", "product": "16-day vegetation indices, 250 m", "id": "MOD13Q1 V061 · DOI 10.5067/MODIS/MOD13Q1.061", "role": "Phenology and vegetation stress history", "state": "context"},
    {"name": "Landsat C2 L2", "product": "Level-2 surface reflectance", "id": "USGS Landsat Collection 2 STAC", "role": "Higher-resolution vegetation and land-use history", "state": "context"},
    {"name": "SRTM", "product": "Global 1 arc-second elevation", "id": "SRTMGL1 · DOI 10.5067/MEaSUREs/SRTM/SRTMGL1N.003", "role": "Slope and erosion-risk proxy", "state": "context"},
    {"name": "GRACE-FO", "product": "Groundwater and soil-moisture assimilation L4", "id": "GRACEDADM_CLSM0125US_7D V4.0", "role": "Multi-year water availability context", "state": "context"},
]


def load_demo():
    return json.loads(DEMO_FILE.read_text())


def centroid(polygon):
    coords = polygon.get("coordinates", [])
    if polygon.get("type") == "Feature":
        polygon = polygon.get("geometry", {})
        coords = polygon.get("coordinates", [])
    elif polygon.get("type") == "Polygon":
        coords = polygon.get("coordinates", [])
    elif isinstance(polygon, list):
        coords = polygon
    if not coords:
        raise ValueError("The field boundary is empty.")
    ring = coords[0] if isinstance(coords[0][0], (list, tuple)) else coords
    points = [(float(p[0]), float(p[1])) for p in ring if len(p) >= 2]
    if len(points) < 4:
        raise ValueError("Draw a closed field boundary with at least three corners.")
    lon = sum(p[0] for p in points[:-1] or points) / len(points[:-1] or points)
    lat = sum(p[1] for p in points[:-1] or points) / len(points[:-1] or points)
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError("Field coordinates are outside the valid range.")
    return lat, lon


def _earthdata_opener():
    """Configure optional Earthdata Basic Auth; POWER itself requires no login."""
    try:
        auth = netrc.netrc().authenticators("urs.earthdata.nasa.gov")
    except (FileNotFoundError, netrc.NetrcParseError):
        auth = None
    if not auth:
        return urllib.request.build_opener()
    manager = urllib.request.HTTPPasswordMgrWithDefaultRealm()
    manager.add_password(None, "https://urs.earthdata.nasa.gov", auth[0], auth[2])
    return urllib.request.build_opener(urllib.request.HTTPBasicAuthHandler(manager))


def fetch_power(lat, lon):
    params = {"parameters": POWER_PARAMS, "community": "AG", "longitude": f"{lon:.4f}", "latitude": f"{lat:.4f}",
              "start": "20040101", "end": "20241231", "format": "JSON"}
    url = "https://power.larc.nasa.gov/api/temporal/daily/point?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "BadYearTest/1.0"})
    with _earthdata_opener().open(req, timeout=12) as response:
        payload = json.loads(response.read().decode())
    properties = payload.get("properties", {}).get("parameter", {})
    if not properties or "T2M" not in properties:
        raise ValueError("NASA POWER returned no daily climate records for this point.")
    frame = pd.DataFrame({key: pd.Series(values) for key, values in properties.items()})
    frame.index = pd.to_datetime(frame.index, format="%Y%m%d", errors="coerce")
    frame = frame.apply(pd.to_numeric, errors="coerce").replace(-999, np.nan).dropna(subset=["T2M", "PRECTOTCORR"])
    frame.index.name = "date"
    return frame


def _synthetic_frame():
    """Predictable, clearly disclosed fallback for unreliable demo-day Wi-Fi."""
    saved = load_demo()
    return pd.DataFrame(saved["daily"], index=pd.to_datetime(saved["dates"]))


def _events(frame):
    f = frame.copy()
    f["year"] = f.index.year
    f["month"] = f.index.month
    f["moisture_proxy"] = f["PRECTOTCORR"].rolling(30, min_periods=7).sum().fillna(0)
    heat_cut = float(f["T2M_MAX"].quantile(.9))
    moisture_cut = float(f["moisture_proxy"].quantile(.1))
    f["heat_drought"] = (f["T2M_MAX"] >= heat_cut) & (f["moisture_proxy"] <= moisture_cut)
    cols = ["T2M_MAX", "PRECTOTCORR", "RH2M", "WS2M", "moisture_proxy"]
    x = f[cols].replace([np.inf, -np.inf], np.nan).fillna(0)
    scaled = StandardScaler().fit_transform(x)
    model = IsolationForest(contamination=.05, random_state=19, n_estimators=100)
    f["anomaly"] = model.fit_predict(scaled) == -1
    f["compound"] = f["heat_drought"] | (f["anomaly"] & (f["T2M_MAX"] >= f["T2M_MAX"].quantile(.75)))
    return f


def _seasonal_envelope(frame):
    seasons = {"Spring": [3, 4, 5], "Summer": [6, 7, 8], "Fall": [9, 10, 11], "Winter": [12, 1, 2]}
    output = {}
    for name, months in seasons.items():
        block = frame[frame.index.month.isin(months)]
        output[name] = {"temperature": round(float(block["T2M"].mean()), 1),
                        "rainfall": round(float(block["PRECTOTCORR"].mean() * len(block) / max(block.index.year.nunique(), 1)), 1),
                        "high_max": round(float(block["T2M_MAX"].quantile(.95)), 1)}
    return output


def _radar(rotation, worst_factor=1.0):
    traits = rotation["traits"]
    return {"heat": round(min(100, traits["heat"] * worst_factor), 1), "water": round(min(100, traits["water"] * worst_factor), 1),
            "wet": round(min(100, traits["wet"] * worst_factor), 1), "frost": round(min(100, traits["frost"] * worst_factor), 1),
            "soil": round(min(100, traits["soil_risk"] * worst_factor), 1)}


def analyze_field(polygon, priorities, frame=None, offline=False):
    lat, lon = centroid(polygon)
    if frame is None:
        try:
            frame = fetch_power(lat, lon)
            source = "NASA POWER · live"
        except Exception as power_error:
            demo = load_demo()
            demo_lat = sum(p[1] for p in demo["geometry"]["coordinates"][0][:-1]) / 4
            demo_lon = sum(p[0] for p in demo["geometry"]["coordinates"][0][:-1]) / 4
            if abs(lat - demo_lat) > .04 or abs(lon - demo_lon) > .05:
                raise ValueError("NASA POWER is unavailable. The saved offline record covers the Story County sample field; load that field or retry when connected.") from power_error
            frame = _synthetic_frame()
            offline = True
            source = "Saved field climate record"
    else:
        source = "NASA POWER · live" if not offline else "Saved field climate record"
    frame = frame.copy()
    frame.index = pd.to_datetime(frame.index)
    frame = frame.sort_index()
    if "T2M_MAX" not in frame: frame["T2M_MAX"] = frame["T2M"]
    if "T2M_MIN" not in frame: frame["T2M_MIN"] = frame["T2M"]
    for col in ["RH2M", "WS2M"]:
        if col not in frame: frame[col] = 50 if col == "RH2M" else 3
    events = _events(frame)
    yearly = events.groupby("year").agg(compound_days=("compound", "sum"), hot_days=("T2M_MAX", lambda x: int((x >= events["T2M_MAX"].quantile(.9)).sum())),
                                       rainfall=("PRECTOTCORR", "sum"), average_temp=("T2M", "mean"))
    worst_year = int(yearly["compound_days"].idxmax())
    worst = yearly.loc[worst_year]
    # KDE compares the observed worst year against the full field-record envelope.
    joint_cols = ["T2M", "PRECTOTCORR", "RH2M"]
    fingerprint_scaler = StandardScaler().fit(frame[joint_cols].fillna(0))
    joint = fingerprint_scaler.transform(frame[joint_cols].fillna(0))
    kde = KernelDensity(kernel="gaussian", bandwidth=.35).fit(joint)
    all_density = kde.score_samples(joint)
    worst_conditions = fingerprint_scaler.transform(frame.loc[frame.index.year == worst_year, joint_cols].fillna(0))
    novelty = float(np.mean(kde.score_samples(worst_conditions) < np.quantile(all_density, .02)))
    # Proxy suitability regression is explicitly an agronomic proxy, not observed yield.
    crops = np.array([[.35, .82, .75], [.72, .58, .45], [.8, .5, .35], [.92, .3, .22], [.25, .9, .8], [.38, .66, .78]])
    yields = crops[:, 0] * 55 + crops[:, 1] * 35 + crops[:, 2] * 20
    model = RandomForestRegressor(n_estimators=50, random_state=11).fit(crops, yields)
    # Fit and use model in optimizer to maintain a traceable proxy model path.
    predictions = model.predict(crops).tolist()
    priorities = {k: max(0, min(100, float(v))) for k, v in priorities.items() if k in ("water", "soil", "forage")}
    recs = recommend_rotations(priorities, int(worst["compound_days"]), int(worst["hot_days"]), float(worst["rainfall"]), float(worst["average_temp"]), predictions)
    max_events = max(1, int(yearly["compound_days"].max()))
    bad_factor = min(1.25, 0.9 + float(worst["compound_days"]) / (max_events * 4))
    strategies = []
    for index, rec in enumerate(recs):
        avg = _radar(rec, .75)
        bad = _radar(rec, bad_factor)
        strategies.append({"rank": index + 1, "name": rec["name"], "sequence": rec["sequence"], "summary": rec["summary"],
                           "average_risk": avg, "bad_year_risk": bad, "bad_year_score": rec["bad_year_score"],
                           "soil_score": rec["soil_score"], "priority_score": rec["priority_score"],
                           "why": rec["why"], "timeline": rec["timeline"]})
    years = [{"year": int(y), "compound_days": int(row["compound_days"]), "rainfall": round(float(row["rainfall"]), 0), "avg_temp": round(float(row["average_temp"]), 1)} for y, row in yearly.iterrows()]
    caveats = ["POWER meteorology is a grid-cell/reanalysis estimate, not a sensor inside the field.", "SMAP soil moisture is about 9 km: it cannot resolve variation inside a field.", "This prototype has not yet ingested ECOSTRESS, GPM, MODIS, Landsat, SRTM or GRACE-FO granules; they are identified as next-step context sources, not live inputs.", "Prices, markets, policies, disease pressure, field-specific soil tests and management history are unknown. Review options with a local agronomist."]
    if offline:
        caveats.insert(0, "Offline fallback uses a synthetic Story County climate series; it is not an observed NASA record.")
    return {"source": source, "offline": offline, "location": {"lat": round(lat, 4), "lon": round(lon, 4)},
            "record": {"start": str(frame.index.min().date()), "end": str(frame.index.max().date()), "years": int(frame.index.year.nunique()), "seasonal": _seasonal_envelope(frame),
                       "worst_year": worst_year, "worst_compound_days": int(worst["compound_days"]), "novelty_rate": round(novelty, 3)},
            "years": years, "strategies": strategies, "datasets": DATASETS,
            "method": {"compound": "IsolationForest multivariate anomaly + joint heat / low-30-day-rainfall threshold", "fingerprint": "Seasonal climate envelope + KernelDensity joint-condition novelty proxy", "yield": "RandomForest agronomic trait proxy; not measured yield"},
            "caveats": caveats}
