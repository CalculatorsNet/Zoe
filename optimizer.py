"""Pure Python / NumPy particle swarm search over crop rotation sequences."""
import numpy as np

CROPS = {
    "Corn": {"water": 82, "soil": 28, "forage": 36, "heat": 70, "wet": 74, "frost": 36, "soil_risk": 68, "fix": 0, "cover": 0},
    "Soybean": {"water": 58, "soil": 62, "forage": 52, "heat": 68, "wet": 48, "frost": 42, "soil_risk": 38, "fix": 70, "cover": 0},
    "Wheat": {"water": 43, "soil": 45, "forage": 42, "heat": 45, "wet": 62, "frost": 68, "soil_risk": 42, "fix": 0, "cover": 0},
    "Sorghum": {"water": 32, "soil": 39, "forage": 70, "heat": 32, "wet": 30, "frost": 40, "soil_risk": 46, "fix": 0, "cover": 0},
    "Cover crop": {"water": 28, "soil": 84, "forage": 30, "heat": 24, "wet": 25, "frost": 25, "soil_risk": 18, "fix": 30, "cover": 95},
    "Forage": {"water": 47, "soil": 73, "forage": 94, "heat": 45, "wet": 39, "frost": 48, "soil_risk": 24, "fix": 16, "cover": 70},
}
NAMES = list(CROPS)
TRAITS = np.array([[CROPS[n][k] for k in ("water", "soil", "forage", "heat", "wet", "frost", "soil_risk", "fix", "cover")] for n in NAMES], dtype=float)


def _score(sequence, priorities, compound_days, hot_days, rainfall, temp, yield_scores=None):
    traits = TRAITS[sequence]
    water, soil, forage = (priorities.get(k, 34) / 100 for k in ("water", "soil", "forage"))
    p = np.array([water, soil, forage], dtype=float)
    if p.sum() == 0: p[:] = 1 / 3
    else: p /= p.sum()
    water_burden = traits[:, 0].mean()
    soil_value = traits[:, 1].mean() * .45 + traits[:, 7].mean() * .22 + traits[:, 8].mean() * .33
    priority_value = 100 - (p[0] * water_burden + p[1] * (100 - soil_value) + p[2] * (100 - traits[:, 2].mean()))
    climate_heat = min(1.2, hot_days / 45)
    dry_signal = min(1.25, 0.65 + compound_days / 80 + max(0, 600 - rainfall) / 1500)
    heat_loss = np.mean(traits[:, 3]) * climate_heat * .36
    drought_loss = np.mean(traits[:, 0]) * dry_signal * .42
    instability = np.mean(traits[:, 4]) * .08 + np.mean(traits[:, 5]) * max(0, 8 - temp) * .01
    proxy_yield_loss = 0
    if yield_scores is not None:
        ys = np.asarray(yield_scores, dtype=float)
        best_yield = float(ys.max())
        if best_yield > 0:
            proxy_yield_loss = max(0, (best_yield - float(ys[sequence].mean())) / best_yield) * 5
    transition = sum(11 for a, b in zip(sequence, sequence[1:]) if a == b)
    bad_penalty = min(100, heat_loss + drought_loss + instability + proxy_yield_loss + transition)
    soil_score = max(0, min(100, soil_value - np.mean(traits[:, 6]) * .12))
    return bad_penalty, soil_score, priority_value


def _pareto(rows):
    keep = []
    for i, row in enumerate(rows):
        dominated = any(j != i and other["bad_year_score"] <= row["bad_year_score"] and other["soil_score"] >= row["soil_score"] and
                        (other["bad_year_score"] < row["bad_year_score"] or other["soil_score"] > row["soil_score"]) for j, other in enumerate(rows))
        if not dominated: keep.append(row)
    return keep


def recommend_rotations(priorities, compound_days, hot_days, rainfall, temp, yield_scores=None):
    # Categorical PSO: particles carry continuous crop indices, decoded to seasons;
    # integer snapping and no-repeat repair maintain valid rotation rules.
    rng = np.random.default_rng(2026)
    count, length = 96, 4
    pos = rng.uniform(0, len(NAMES) - .001, (count, length))
    vel = rng.normal(0, .55, (count, length))
    pbest = pos.copy()
    def decode(p):
        seq = np.clip(np.rint(p).astype(int), 0, len(NAMES) - 1)
        for j in range(1, length):
            repeated = seq[:, j] == seq[:, j - 1]
            seq[repeated, j] = (seq[repeated, j] + 1) % len(NAMES)
        return seq
    def fitness(p):
        seqs = decode(p)
        # Scalar guide favors robust bad-year performance while retaining farmer preference.
        return np.array([_score(s, priorities, compound_days, hot_days, rainfall, temp, yield_scores)[0] -
                         _score(s, priorities, compound_days, hot_days, rainfall, temp, yield_scores)[2] * .22 for s in seqs])
    best = fitness(pos)
    gbest = pbest[best.argmin()].copy()
    for _ in range(110):
        r1, r2 = rng.random((count, length)), rng.random((count, length))
        vel = .68 * vel + 1.35 * r1 * (pbest - pos) + 1.45 * r2 * (gbest - pos)
        pos = np.clip(pos + vel, 0, len(NAMES) - 1e-4)
        score = fitness(pos)
        improve = score < best
        pbest[improve], best[improve] = pos[improve], score[improve]
        gbest = pbest[best.argmin()].copy()
    unique = {}
    for seq in decode(np.vstack([pos, pbest])):
        key = tuple(seq.tolist())
        penalty, soil_score, priority_score = _score(seq, priorities, compound_days, hot_days, rainfall, temp, yield_scores)
        unique[key] = {"sequence": [NAMES[i] for i in seq], "traits": {"heat": float(TRAITS[seq, 3].mean()), "water": float(TRAITS[seq, 0].mean()),
                       "wet": float(TRAITS[seq, 4].mean()), "frost": float(TRAITS[seq, 5].mean()), "soil_risk": float(TRAITS[seq, 6].mean())},
                       "bad_year_score": round(penalty, 1), "soil_score": round(soil_score, 1), "priority_score": round(priority_score, 1)}
    frontier = _pareto(list(unique.values()))
    frontier.sort(key=lambda x: (x["bad_year_score"] - .22 * x["priority_score"], -x["soil_score"]))
    chosen = frontier[:3]
    # Ensure three diverse candidates when frontier is small.
    if len(chosen) < 3:
        extras = sorted(unique.values(), key=lambda x: (x["bad_year_score"] - .22 * x["priority_score"], -x["soil_score"]))
        for row in extras:
            if row not in chosen: chosen.append(row)
            if len(chosen) == 3: break
    results = []
    for idx, row in enumerate(chosen):
        seq = row["sequence"]
        first = seq[0]
        results.append({**row, "name": ["Drought buffer", "Soil builder", "Balanced rotation"][idx],
            "summary": f"Starts with {first.lower()} and balances water demand, soil contribution, and the priorities you set.",
            "why": f"Its relative hard-year exposure score is {row['bad_year_score']:.0f}/100, and its soil contribution score is {row['soil_score']:.0f}/100. The comparison uses NASA POWER temperature and rainfall history. SMAP root-zone moisture is listed as coarse-scale context, not an input to this run. Crop traits are broad proxies, not locally measured yields.",
            "timeline": [{"year": 2027 + i, "crop": crop, "exposure": round(min(100, row["bad_year_score"] * (0.82 + i * .08) + (i % 2) * 5), 0)} for i, crop in enumerate(seq)]})
    return results
