(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const points = [];
  let polygon = null;
  let hasDrawn = false;
  let priorMessages = new Map();

  class ZOEMessage extends HTMLElement {
    set message(value) {
      const paragraph = this.querySelector('p');
      if (paragraph) paragraph.textContent = value;
    }
  }
  if (!customElements.get('zoe-message')) customElements.define('zoe-message', ZOEMessage);

  function say(text, id = 'ZOE-field') {
    const panel = $(id);
    if (!panel) return;
    if (priorMessages.get(id) === text) text += ' Take your time.';
    priorMessages.set(id, text);
    panel.message = text;
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
    points.forEach(point => {
      point.marker = L.circleMarker(point.latlng, {
        radius: 6, color: '#FBF7EF', weight: 2, fillColor: '#7A9C5A', fillOpacity: 1
      }).addTo(map);
    });
    const valid = points.length >= 3;
    if (valid) {
      polygon = L.polygon(points.map(point => point.latlng), {
        color: '#7A9C5A', weight: 3, dashArray: '7 5', fillColor: '#A78942', fillOpacity: .18
      }).addTo(map);
    }
    $('analyze').disabled = !valid;
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
  map.on('click', event => { points.push({ latlng: event.latlng }); updateField(); });
  $('map').addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      points.push({ latlng: map.getCenter() });
      updateField();
    }
  });
  $('undo').addEventListener('click', () => { points.pop(); updateField(); });
  $('clear').addEventListener('click', () => { points.length = 0; updateField(); });

  $('saved').addEventListener('click', async () => {
    try {
      const response = await fetch('/api/demo');
      if (!response.ok) throw new Error('The sample field did not load. Try again.');
      const data = await response.json();
      points.length = 0;
      data.geometry.coordinates[0].slice(0, -1).forEach(([lng, lat]) => points.push({ latlng: L.latLng(lat, lng) }));
      updateField();
      map.fitBounds(L.latLngBounds(points.map(point => point.latlng)).pad(.2));
      say('The sample field is marked. Set your priorities, then run the comparison.', 'ZOE-field');
    } catch (error) { notify(error.message, true); }
  });

  const explanations = {
    water: value => value >= 67 ? 'More water-conscious. I’ll favor rotations with lower water demand.' : value <= 33 ? 'Water has less weight. Soil and forage can lead.' : 'I’ll balance water use with your other priorities.',
    soil: value => value >= 67 ? 'Soil comes first. I’ll give soil-building rotations more weight.' : value <= 33 ? 'Soil has less weight in this comparison.' : 'I’ll balance soil gains with water and forage.',
    forage: value => value >= 67 ? 'Forage comes first. I’ll give its value more weight.' : value <= 33 ? 'Forage has less weight in this comparison.' : 'I’ll weigh forage alongside water and soil.'
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
    line.append(makeElement('span', '', isWorst ? 'Worst' : 'Average'));
    const track = makeElement('div', 'risk-track');
    const fill = makeElement('div', 'risk-fill');
    fill.style.width = `${Math.max(0, Math.min(100, Number(value) || 0))}%`;
    fill.setAttribute('aria-hidden', 'true');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${label}: ${isWorst ? 'worst year' : 'average year'} risk ${Math.round(value)} out of 100`);
    track.append(fill);
    line.append(track, makeElement('b', '', `${Math.round(value)}`));
    return line;
  }

  function makeRiskBars(strategy) {
    const box = makeElement('section', 'risk-bars');
    box.setAttribute('aria-label', 'Average and worst-year risk comparison');
    box.append(makeElement('h5', '', 'Pressure by season'));
    box.append(makeElement('p', 'risk-legend', 'Lower bars mean less modeled exposure.'));
    [['Heat', 'heat'], ['Water', 'water'], ['Soil pressure', 'soil']].forEach(([label, key]) => {
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
    score.append(makeElement('span', 'score-label', 'Risk in the worst year'));
    const summary = makeElement('p', 'strategy-summary', (strategy.summary || '').split(/[.!?]/)[0] + '.');
    const calendar = makeElement('div', 'planting-strip');
    calendar.setAttribute('aria-label', 'Suggested crop sequence');
    (strategy.sequence || []).forEach((crop, cropIndex) => {
      const chip = makeElement('span', `planting-chip ${cropSlug(crop)}`);
      chip.append(makeElement('b', '', String(2027 + cropIndex)), document.createTextNode(crop));
      calendar.append(chip);
    });
    const reasons = makeElement('div', 'reason-chips');
    [
      [`Water ${Math.round(strategy.bad_year_risk.water)}/100`, 'water'],
      [`Heat ${Math.round(strategy.bad_year_risk.heat)}/100`, 'heat'],
      [`Soil gain ${Math.round(strategy.soil_score)}/100`, 'soil']
    ].forEach(([label, kind]) => {
      const chip = makeElement('span', `reason-chip ${kind}`, label);
      chip.prepend(makeElement('i', 'reason-dot'));
      reasons.append(chip);
    });
    main.append(title, score, summary, calendar, reasons, makeElement('p', 'strategy-data', 'NASA POWER daily weather · Broad crop proxies'));

    const quote = makeElement('zoe-message', 'zoe-quote');
    const mark = document.createElement('img');
    mark.src = 'static/zoe-mark.svg'; mark.alt = ''; mark.width = 40; mark.height = 40;
    const quoteText = makeElement('p', '', strategy.name ? `${strategy.name} is one option from the search. Check it against your soil, equipment, and market.` : 'Use this as a starting point for a local conversation.');
    quote.append(mark, quoteText);
    card.append(main, makeRiskBars(strategy), quote);
    return card;
  }

  function render(data) {
    $('worst-year').textContent = data.record.worst_year;
    $('source').textContent = data.source;
    $('record-span').textContent = `${data.record.years} years · ${data.record.start.slice(0, 4)} to ${data.record.end.slice(0, 4)}`;
    $('stress-days').textContent = `${data.record.worst_compound_days} days`;
    $('novelty').textContent = `${Math.round(data.record.novelty_rate * 100)}% of days`;
    $('results-intro').textContent = data.offline ? 'This saved climate series is synthetic. Use the comparison to explore the tool.' : 'Based on daily climate estimates for this field center.';
    say(`${data.record.worst_year} was the hardest year in this record. Each rotation is scored against it.`, 'ZOE-results');
    const list = $('strategies');
    list.replaceChildren(...data.strategies.map(makeStrategy));
    const caveats = data.offline
      ? ['Saved Story County weather is synthetic, not a NASA observation.', 'SMAP is 9 km and unavailable in this run; field-level soil variation is unknown.', 'Markets, disease, soil tests, and management history need local review.']
      : ['NASA POWER uses a grid estimate; it does not measure weather inside this field.', 'SMAP is 9 km; other satellites are listed here, but are not live inputs.', 'Markets, disease, soil tests, and management history need local review.'];
    $('caveats').replaceChildren(...caveats.map(text => makeElement('li', '', text)));
    $('datasets').replaceChildren(...data.datasets.map(dataset => {
      const entry = makeElement('div', `dataset ${dataset.state}`);
      const title = makeElement('div', 'dataset-title');
      title.append(makeElement('i'), makeElement('strong', '', dataset.name));
      entry.append(title, makeElement('p', '', dataset.product.replaceAll(' · ', ', ')), makeElement('code', '', dataset.id));
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
    button.innerHTML = '<img class="button-seed" src="static/zoe-mark.svg" alt="" width="20" height="20"> Looking at 20 years of rain and heat…';
    $('ZOE-results').classList.add('thinking');
    $('findings').hidden = false;
    $('findings-title').textContent = 'Checking the field notes';
    $('strategies').replaceChildren();
    say('I’m checking the climate record for this field center. It can take a little while.', 'ZOE-results');
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          polygon: { type: 'Polygon', coordinates: [boundary] },
          priorities: { water: Number($('water').value), soil: Number($('soil').value), forage: Number($('forage').value) }
        })
      });
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
      button.textContent = 'Test this field';
      button.disabled = points.length < 3;
    }
  });

  document.querySelectorAll('.steps a').forEach(link => link.addEventListener('click', () => {
    document.querySelectorAll('.steps a').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
  }));
  if (new URLSearchParams(location.search).get('demo') === 'true') $('saved').click();
})();
