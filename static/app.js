(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const pagesMode = location.hostname.endsWith('.github.io');
  const points = [];
  let polygon = null;
  let hasDrawn = false;
  let savedSampleSelected = false;
  let priorMessages = new Map();
  const localUrl = path => new URL(path, document.baseURI).toString();
  if (pagesMode) {
    $('hosting-note').hidden = false;
    $('location-search').hidden = true;
    ['water', 'soil', 'forage'].forEach(key => { $(key).disabled = true; });
    $('priority-title').textContent = 'The sample’s priorities';
    $('ZOE-priority').querySelector('p').textContent = 'These fixed values match the saved example. Run locally to change them.';
    $('analyze').textContent = 'Open sample notes';
  }

  function say(text, id = 'ZOE-field') {
    const panel = $(id);
    if (!panel) return;
    if (priorMessages.get(id) === text) text += ' Take your time.';
    priorMessages.set(id, text);
    const paragraph = panel.querySelector('p');
    if (paragraph) paragraph.textContent = text;
  }

  function notify(text, isError = false) {
    const toast = $('toast');
    toast.textContent = text;
    toast.setAttribute('role', isError ? 'alert' : 'status');
    toast.classList.add('show');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => toast.classList.remove('show'), 4200);
  }

  const map = L.map('map', { zoomControl: false, scrollWheelZoom: false }).setView([42.05, -93.65], 9);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  const stateCodes = {
    '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE', '11': 'DC',
    '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
    '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT',
    '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
    '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT',
    '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV', '55': 'WI', '56': 'WY', '72': 'PR'
  };
  const stateFips = Object.fromEntries(Object.entries(stateCodes).map(([fips, code]) => [code, fips]));
  const censusPlaces = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/18/query';
  const censusCommunities = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/19/query';
  const censusZips = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/7/query';

  async function censusSearch(endpoint, where, fields) {
    const params = new URLSearchParams({
      where,
      outFields: fields,
      returnGeometry: 'false',
      resultRecordCount: '8',
      f: 'json'
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(`${endpoint}?${params}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error('Place search is unavailable. Pan the map to your area instead.');
    const data = await response.json();
    if (data.error) throw new Error('Place search is unavailable. Pan the map to your area instead.');
    return data.features || [];
  }

  function showPlaceResults(features, type) {
    const results = $('location-results');
    results.replaceChildren();
    if (!features.length) {
      $('location-status').textContent = 'No match yet. Try a city with its state, or a five-digit ZIP code.';
      results.hidden = true;
      return;
    }
    features.forEach(feature => {
      const attrs = feature.attributes;
      const state = stateCodes[String(attrs.STATE || '').padStart(2, '0')];
      const zip = attrs.ZCTA5 || attrs.BASENAME;
      const place = type === 'zip' ? `${zip} ZIP area` : `${attrs.BASENAME || attrs.NAME}${state ? `, ${state}` : ''}`;
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'location-result';
      button.textContent = place;
      button.addEventListener('click', () => {
        const lat = Number(attrs.INTPTLAT);
        const lng = Number(attrs.INTPTLON);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          $('location-status').textContent = 'That place has no map center. Try another result.';
          return;
        }
        points.length = 0;
        updateField();
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
        map.setView([lat, lng], type === 'zip' ? 12 : 11, { animate: !reduced });
        $('location-query').value = place;
        results.hidden = true;
        $('location-status').textContent = `Map centered near ${place}. Draw your field on the map.`;
        const message = $('ZOE-field');
        message.classList.remove('is-hidden');
        say(`I’ve moved the map near ${place}. Mark your field corners here.`, 'ZOE-field');
      });
      item.append(button);
      results.append(item);
    });
    results.hidden = false;
    $('location-status').textContent = `${features.length} place${features.length === 1 ? '' : 's'} found. Choose one to move the map.`;
  }

  $('location-search').addEventListener('submit', async event => {
    event.preventDefault();
    const query = $('location-query').value.trim();
    const button = $('location-submit');
    const results = $('location-results');
    results.replaceChildren();
    results.hidden = true;
    if (!query || (!/^\d{5}$/.test(query) && !query.split(',')[0].trim())) {
      $('location-status').textContent = 'Enter a U.S. city and state, or a five-digit ZIP code.';
      $('location-query').focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Searching…';
    $('location-status').textContent = 'Looking up the place center…';
    try {
      if (/^\d{5}$/.test(query)) {
        const zip = query.replace(/'/g, "''");
        const features = await censusSearch(censusZips, `ZCTA5 = '${zip}'`, 'NAME,ZCTA5,INTPTLAT,INTPTLON');
        showPlaceResults(features, 'zip');
      } else {
        const [namePart, statePart = ''] = query.split(',', 2).map(part => part.trim());
        const name = namePart.replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/'/g, "''").slice(0, 80);
        if (!name) throw new Error('Enter a city name, then try again.');
        const state = stateFips[statePart.toUpperCase()];
        const stateFilter = state ? ` AND STATE = '${state}'` : '';
        const where = `UPPER(BASENAME) LIKE UPPER('${name}%')${stateFilter}`;
        let features = await censusSearch(censusPlaces, where, 'BASENAME,NAME,STATE,INTPTLAT,INTPTLON');
        if (!features.length) features = await censusSearch(censusCommunities, where, 'BASENAME,NAME,STATE,INTPTLAT,INTPTLON');
        showPlaceResults(features, 'city');
      }
    } catch (error) {
      $('location-status').textContent = error.name === 'AbortError'
        ? 'That search took too long. Pan the map or try again.'
        : ['Enter a city name, then try again.', 'Place search is unavailable. Pan the map to your area instead.'].includes(error.message)
          ? error.message
          : 'I couldn’t reach place search. Pan the map or try again.';
    } finally {
      button.disabled = false;
      button.textContent = 'Find place';
    }
  });

  function centerOfField() {
    return {
      lat: points.reduce((sum, point) => sum + point.latlng.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.latlng.lng, 0) / points.length
    };
  }

  function updateField() {
    $('findings').hidden = true;
    if (polygon) map.removeLayer(polygon);
    points.forEach(point => { if (point.marker) map.removeLayer(point.marker); });
    const style = getComputedStyle(document.documentElement);
    const color = name => style.getPropertyValue(name).trim();
    points.forEach(point => {
      point.marker = L.circleMarker(point.latlng, {
        radius: 7, color: color('--paper-card'), weight: 2, fillColor: color('--field-boundary'), fillOpacity: 1
      }).addTo(map);
    });
    const valid = points.length >= 3;
    if (valid) {
      polygon = L.polygon(points.map(point => point.latlng), {
        color: color('--field-boundary'), weight: 3, dashArray: '8 6', fillColor: color('--field-sun'), fillOpacity: .2
      }).addTo(map);
    }
    $('analyze').disabled = !valid || (pagesMode && !savedSampleSelected);
    $('undo').disabled = points.length === 0;
    $('clear').disabled = points.length === 0;
    $('field-count').textContent = valid ? `${points.length} corners marked` : points.length ? `${points.length} of 3 corners` : 'Waiting for your field';
    const message = $('ZOE-field');
    message.classList.toggle('is-hidden', points.length === 0);
    if (valid) {
      const center = centerOfField();
      $('coords').textContent = `${center.lat.toFixed(4)}° ${center.lat < 0 ? 'S' : 'N'}, ${Math.abs(center.lng).toFixed(4)}° ${center.lng < 0 ? 'W' : 'E'}`;
      say(hasDrawn ? 'Field outline changed. I cleared the old notes; let’s check this boundary.' : 'I have the outline. Set your priorities, and I’ll compare rotations for this field.', 'ZOE-field');
      hasDrawn = true;
      message.classList.add('confirmed');
      document.querySelector('.map-frame').classList.add('has-field');
    } else {
      $('coords').textContent = 'Waiting for your boundary';
      document.querySelector('.map-frame').classList.remove('has-field');
      if (points.length) say(`That’s ${points.length} corner${points.length === 1 ? '' : 's'}. Add ${3 - points.length} more to close the field.`, 'ZOE-field');
      else if (hasDrawn) say('The outline is cleared. Mark your field again when you’re ready.', 'ZOE-field');
      else say('I’m ready. Mark three corners, and I’ll find the climate record for this field.', 'ZOE-field');
    }
  }

  $('map').tabIndex = 0;
  map.on('click', event => { savedSampleSelected = false; points.push({ latlng: event.latlng }); updateField(); });
  $('map').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      savedSampleSelected = false;
      points.push({ latlng: map.getCenter() });
      updateField();
    }
  });
  $('undo').addEventListener('click', () => { savedSampleSelected = false; points.pop(); updateField(); });
  $('clear').addEventListener('click', () => { savedSampleSelected = false; points.length = 0; updateField(); });

  $('saved').addEventListener('click', async () => {
    try {
      const response = await fetch(localUrl(pagesMode ? 'data/demo_field.json' : 'api/demo'));
      if (!response.ok) throw new Error('The sample field did not load. Try again.');
      const data = await response.json();
      points.length = 0;
      data.geometry.coordinates[0].slice(0, -1).forEach(([lng, lat]) => points.push({ latlng: L.latLng(lat, lng) }));
      savedSampleSelected = true;
      updateField();
      map.fitBounds(L.latLngBounds(points.map(point => point.latlng)).pad(.2));
      say(pagesMode ? 'The sample field is marked. Its saved notes are ready to open.' : 'The sample field is marked. Set your priorities, then run the comparison.', 'ZOE-field');
    } catch (error) { notify(error.message, true); }
  });

  const explanations = {
    water: value => value >= 67 ? 'Water matters more. I’ll favor rotations with lower water needs.' : value <= 33 ? 'Water gets less weight. Soil and livestock feed can lead.' : 'I’ll balance water needs with your other priorities.',
    soil: value => value >= 67 ? 'Soil-building traits matter more. I’ll give them extra weight.' : value <= 33 ? 'Soil-building traits get less weight here.' : 'I’ll balance soil-building traits with water and livestock feed.',
    forage: value => value >= 67 ? 'Forage means plants for grazing, hay, or silage. I’ll give feed value more weight.' : value <= 33 ? 'Forage means plants for grazing, hay, or silage. It gets less weight here.' : 'Forage means plants for grazing, hay, or silage. I’ll balance it with water and soil.'
  };
  ['water', 'soil', 'forage'].forEach(key => {
    $(`${key}-value`).value = $(key).value;
    $(key).addEventListener('input', () => {
      $('findings').hidden = true;
      $(`${key}-value`).value = $(key).value;
      $(`${key}-help`).textContent = explanations[key](Number($(key).value));
      say(explanations[key](Number($(key).value)), 'ZOE-priority');
    });
  });

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function riskLine(label, value, isWorst) {
    const line = makeElement('div', `risk-line${isWorst ? ' worst' : ''}`);
    line.append(makeElement('span', '', isWorst ? 'Hard year' : 'Reference'));
    const track = makeElement('div', 'risk-track');
    const fill = makeElement('div', 'risk-fill');
    fill.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
    fill.setAttribute('aria-hidden', 'true');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${label}: ${isWorst ? 'hard-year adjusted' : 'reference'} model score ${Math.round(value)} out of 100`);
    track.append(fill);
    line.append(track, makeElement('b', '', `${Math.round(value)}`));
    return line;
  }

  function makeRiskBars(strategy) {
    const box = makeElement('section', 'risk-bars');
    box.setAttribute('aria-label', 'Crop trait scores, reference and hard-year adjusted');
    box.append(makeElement('h5', '', 'Crop pressure scores'));
    box.append(makeElement('p', 'risk-legend', '0–100 model scale, not a percent. Longer bars mean more modeled demand or sensitivity.'));
    [['Water need', 'water'], ['Heat sensitivity', 'heat'], ['Soil risk', 'soil']].forEach(([label, key]) => {
      const row = makeElement('div', 'risk-row');
      row.append(makeElement('strong', '', label));
      row.append(riskLine(label, strategy.average_risk[key], false));
      row.append(riskLine(label, strategy.bad_year_risk[key], true));
      box.append(row);
    });
    return box;
  }

  function cropSlug(crop) { return `crop-${String(crop).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`; }
  function makeStrategy(strategy, index) {
    const card = makeElement('article', 'strategy');
    card.setAttribute('aria-labelledby', `strategy-title-${index}`);
    const main = makeElement('div', 'strategy-main');
    const title = makeElement('h4', '', strategy.name || `Field note ${index + 1}`);
    title.id = `strategy-title-${index}`;
    const score = makeElement('div', 'score-block');
    score.append(makeElement('span', 'score-num', `${Math.round(strategy.bad_year_score)}`), makeElement('span', 'score-denom', '/ 100'));
    score.append(makeElement('span', 'score-label', 'Combined score in the hardest year'));
    const scoreHelp = makeElement('p', 'score-help', 'A 0–100 model score. Lower means less pressure in this comparison, not higher yield or lower crop-loss odds.');
    const summary = makeElement('p', 'strategy-summary', (strategy.summary || '').split(/[.!?]/)[0] + '.');
    const calendar = makeElement('div', 'planting-strip');
    calendar.setAttribute('aria-label', 'Example crop order, not a planting calendar');
    const sequenceLabel = makeElement('p', 'sequence-label', 'Example crop order · four slots');
    (strategy.sequence || []).forEach((crop, cropIndex) => {
      const chip = makeElement('span', `planting-chip ${cropSlug(crop)}`);
      const cropText = crop === 'Forage' ? 'Forage · livestock feed' : crop;
      chip.append(makeElement('b', '', `Slot ${cropIndex + 1}`), document.createTextNode(cropText));
      calendar.append(chip);
    });
    const reasons = makeElement('div', 'reason-chips');
    [
      [`Water need ${Math.round(strategy.bad_year_risk.water)}`, 'water'],
      [`Heat sensitivity ${Math.round(strategy.bad_year_risk.heat)}`, 'heat'],
      [`Soil-building proxy ${Math.round(strategy.soil_score)}`, 'soil']
    ].forEach(([label, kind]) => {
      const chip = makeElement('span', `reason-chip ${kind}`, label);
      chip.prepend(makeElement('i', 'reason-dot'));
      reasons.append(chip);
    });
    main.append(title, score, scoreHelp, summary, sequenceLabel, calendar, reasons, makeElement('p', 'strategy-data', 'Weather estimate: NASA POWER · Crop traits: broad assumptions'));

    const quote = makeElement('blockquote', 'zoe-quote');
    const mark = document.createElement('img');
    mark.src = 'static/zoe-mark.svg'; mark.alt = ''; mark.width = 40; mark.height = 40;
    const quoteText = makeElement('p', '', strategy.name ? `${strategy.name} is one option from the search. Check the crop order against your soil, livestock needs, equipment, and market.` : 'Use this as a starting point for a local conversation.');
    quote.append(mark, quoteText);
    card.append(main, makeRiskBars(strategy), quote);
    return card;
  }

  function render(data) {
    $('worst-year').textContent = data.record.worst_year;
    $('source').textContent = data.source;
    $('record-span').textContent = `${data.record.start.slice(0, 4)}–${data.record.end.slice(0, 4)} (${data.record.years} years)`;
    $('stress-days').textContent = `${data.record.worst_compound_days} days`;
    $('novelty').textContent = `${Math.round(data.record.novelty_rate * 100)}%`;
    $('results-intro').textContent = data.offline ? 'This sample uses synthetic weather for practice. It is not a NASA observation.' : 'NASA POWER estimates daily weather at the center of your field outline.';
    $('source-key').textContent = data.offline
      ? 'Saved Story County sample. The weather series is synthetic; no NASA observation feeds this result.'
      : 'This run used the sources marked “Used here.” Other products are not counted until their data are fetched and checked.';
    say(`${data.record.worst_year} was the hardest year in this record. Each rotation is scored against it.`, 'ZOE-results');
    const list = $('strategies');
    list.replaceChildren(...data.strategies.map(makeStrategy));
    const caveats = data.offline
      ? ['The sample weather record is synthetic, not a NASA observation.', 'Soil, drainage, and field-level moisture are unknown; SMAP’s roughly 9 km data are not used in this run.', 'Planting dates, livestock feed needs, markets, disease, and equipment need local review.']
      : ['NASA POWER estimates weather for a grid near the field center; it is not a field weather station.', 'Soil and drainage are unknown. SMAP’s roughly 9 km moisture data are listed for context, not used in this run.', 'Planting dates, livestock feed needs, markets, disease, soil tests, and equipment need local review.'];
    $('caveats').replaceChildren(...caveats.map(text => makeElement('li', '', text)));
    $('datasets').replaceChildren(...data.datasets.map(dataset => {
      const entry = makeElement('div', `dataset ${dataset.state}`);
      const title = makeElement('div', 'dataset-title');
      const stateLabels = { used: 'Used here', 'not-used': 'Not connected', live: 'Used here', context: 'Not connected' };
      title.append(makeElement('i'), makeElement('strong', '', dataset.name), makeElement('span', 'dataset-state', stateLabels[dataset.state] || 'Check source'));
      entry.append(title, makeElement('p', 'dataset-owner', dataset.agency || 'Data source'), makeElement('p', 'dataset-role', dataset.role), makeElement('p', 'dataset-product', dataset.product.replaceAll(' · ', ', ')), makeElement('code', '', dataset.id), makeElement('p', 'dataset-provider', dataset.provider || ''), makeElement('p', 'dataset-status-note', dataset.status_note || ''));
      if (dataset.url) {
        const link = makeElement('a', 'dataset-link', 'Open product record');
        link.href = dataset.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        entry.append(link);
      }
      return entry;
    }));
    $('findings').hidden = false;
    $('findings').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  $('analyze').addEventListener('click', async () => {
    if (points.length < 3) return;
    const button = $('analyze');
    const boundary = points.map(point => [point.latlng.lng, point.latlng.lat]);
    boundary.push(boundary[0]);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.innerHTML = pagesMode
      ? '<img class="button-seed" src="static/zoe-mark.svg" alt="" width="20" height="20"> Opening saved notes…'
      : '<img class="button-seed" src="static/zoe-mark.svg" alt="" width="20" height="20"> Checking rain and heat history…';
    $('ZOE-results').classList.add('thinking');
    $('findings').hidden = false;
    $('findings-title').textContent = pagesMode ? 'Opening the sample notes' : 'Checking the field notes';
    $('strategies').replaceChildren();
    say(pagesMode ? 'These saved notes use the Story County sample field and synthetic weather.' : 'I’m checking the climate record for this field center. It can take a little while.', 'ZOE-results');
    try {
      let response;
      if (pagesMode) {
        if (!savedSampleSelected) throw new Error('Choose the Story County sample to open the saved analysis.');
        response = await fetch(localUrl('data/demo_analysis.json'));
      } else {
        response = await fetch(localUrl('api/analyze'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            polygon: { type: 'Polygon', coordinates: [boundary] },
            priorities: { water: Number($('water').value), soil: Number($('soil').value), forage: Number($('forage').value) }
          })
        });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'I couldn’t read this field’s climate record. Try again.');
      $('findings-title').textContent = 'What the seasons remember';
      render(data);
    } catch (error) {
      $('findings-title').textContent = 'The field notes are waiting';
      $('strategies').replaceChildren();
      say('I couldn’t reach the climate record. Check your connection and try again.', 'ZOE-results');
      notify(error.message || 'The climate record did not load. Try again.', true);
    } finally {
      $('ZOE-results').classList.remove('thinking');
      button.removeAttribute('aria-busy');
      button.textContent = pagesMode ? 'Open sample notes' : 'Test this field';
      button.disabled = points.length < 3 || (pagesMode && !savedSampleSelected);
    }
  });

  const stepLinks = [...document.querySelectorAll('.steps a')];
  function setActiveStep(id) {
    stepLinks.forEach(link => {
      const active = link.hash === `#${id}`;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
  }
  stepLinks.forEach(link => link.addEventListener('click', () => setActiveStep(link.hash.slice(1))));
  if ('IntersectionObserver' in window) {
    const stepObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveStep(visible.target.id);
    }, { rootMargin: '-24% 0px -58% 0px', threshold: [0, .2, .5, .8] });
    stepLinks.forEach(link => {
      const section = $(link.hash.slice(1));
      if (section) stepObserver.observe(section);
    });
  }
  if (new URLSearchParams(location.search).get('demo') === 'true') $('saved').click();
})();
