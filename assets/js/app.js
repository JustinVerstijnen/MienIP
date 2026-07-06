(() => {
  'use strict';

  const ENDPOINTS = {
    geo: [
      { url: 'https://ipapi.co/json/', normalize: normalizeIpApiGeo },
      { url: 'https://ipwho.is/', normalize: normalizeIpWhoIsGeo }
    ],
    geoForIp: (ip) => [
      { url: `https://ipapi.co/${encodeURIComponent(ip)}/json/`, normalize: normalizeIpApiGeo },
      { url: `https://ipwho.is/${encodeURIComponent(ip)}`, normalize: normalizeIpWhoIsGeo }
    ],
    ipv4: [
      { url: 'https://api.ipify.org?format=json', normalize: normalizeIpJson },
      { url: 'https://api.seeip.org/jsonip?', normalize: normalizeIpJson },
      { url: 'https://ipv4.icanhazip.com/', responseType: 'text', normalize: normalizePlainIp }
    ],
    ipv6: [
      { url: 'https://api6.ipify.org?format=json', normalize: normalizeIpJson },
      { url: 'https://ipv6.icanhazip.com/', responseType: 'text', normalize: normalizePlainIp }
    ],
    universal: [
      { url: 'https://api64.ipify.org?format=json', normalize: normalizeIpJson },
      { url: 'https://api.seeip.org/jsonip?', normalize: normalizeIpJson },
      { url: 'https://icanhazip.com/', responseType: 'text', normalize: normalizePlainIp }
    ]
  };

  // Belangrijk voor snelheid:
  // - Het zichtbare IP-adres krijgt een korte timeout en wordt direct gerenderd.
  // - Langzamere onderdelen zoals IPv6, geo-details en de kaart mogen later binnenkomen.
  const TIMEOUTS = {
    firstIp: 2500,
    geo: 5500,
    ipv4: 3500,
    ipv6: 3500,
    universal: 2500,
    preferredGeo: 4500
  };

  const GOOGLE_MAPS_EMBED_API_KEY = '';

  const fields = {};
  const copyButtonsByField = {};

  const pageTitle = document.querySelector('#page-title');
  const mainIpValue = document.querySelector('#mainIpValue');
  const copyMainIpButton = document.querySelector('#copyMainIpButton');
  const refreshButton = document.querySelector('#refreshButton');
  const statusPill = document.querySelector('#statusPill');
  const lastUpdated = document.querySelector('#lastUpdated');
  const mapFrame = document.querySelector('#mapFrame');
  const mapPlaceholder = document.querySelector('#mapPlaceholder');
  const openMapLink = document.querySelector('#openMapLink');

  let activeLoadId = 0;

  enhanceTableCopyButtons();
  syncCopyButton(copyMainIpButton, '');

  document.addEventListener('DOMContentLoaded', () => {
    refreshButton.addEventListener('click', loadIpData);
    copyMainIpButton.addEventListener('click', () => copyFromButton(copyMainIpButton));
    loadIpData();
  });

  async function loadIpData() {
    const loadId = ++activeLoadId;
    const state = {
      preferredIp: null,
      geo: null,
      ipv4: null,
      ipv6: null,
      universal: null,
      hasMainIp: false,
      pending: 4
    };

    setLoading(true);
    setStatus('IP-adres zoeken…', 'loading');
    resetValuesForNewLoad();
    resetMap('Coördinaoten worden later elaoden…');

    const geoPromise = fetchAny(ENDPOINTS.geo, TIMEOUTS.geo);
    const ipv4Promise = fetchAny(ENDPOINTS.ipv4, TIMEOUTS.ipv4);
    const ipv6Promise = fetchAny(ENDPOINTS.ipv6, TIMEOUTS.ipv6);
    const universalPromise = fetchAny(ENDPOINTS.universal, TIMEOUTS.universal);

    showFirstAvailableIp(loadId, state, [
      universalPromise,
      ipv4Promise,
      geoPromise,
      ipv6Promise
    ]);

    handleResult(loadId, state, 'universal', universalPromise);
    handleResult(loadId, state, 'ipv4', ipv4Promise);
    handleResult(loadId, state, 'ipv6', ipv6Promise);
    handleResult(loadId, state, 'geo', geoPromise);
  }

  async function showFirstAvailableIp(loadId, state, promises) {
    const wrappedPromises = promises.map((promise) => promise.then(
      (data) => data?.ip || null,
      () => null
    ));

    const firstIp = await firstNonEmpty(wrappedPromises, TIMEOUTS.firstIp);

    if (!isCurrentLoad(loadId) || !firstIp) {
      return;
    }

    state.hasMainIp = true;
    state.preferredIp = firstIp;
    renderMainIp(firstIp);
    setText(fields.ip, firstIp);
    setText(fields.version, getIpVersion(firstIp));

    if (state.pending > 0) {
      setStatus('Ie Pee adres evonden, nou de rest noh…', 'loading');
    }
  }

  async function firstNonEmpty(promises, timeoutMs) {
    return new Promise((resolve) => {
      let settledCount = 0;
      let resolved = false;
      const timer = window.setTimeout(() => finish(null), timeoutMs);

      promises.forEach((promise) => {
        promise.then((value) => {
          settledCount += 1;

          if (value) {
            finish(value);
            return;
          }

          if (settledCount === promises.length) {
            finish(null);
          }
        });
      });

      function finish(value) {
        if (resolved) {
          return;
        }

        resolved = true;
        window.clearTimeout(timer);
        resolve(value);
      }
    });
  }

  async function handleResult(loadId, state, key, promise) {
    try {
      const data = await promise;

      if (!isCurrentLoad(loadId)) {
        return;
      }

      state[key] = data;
      renderPartialResult(state, key, data);
    } catch (error) {
      console.warn(`${key} kon niet elaoden worden.`, error);

      if (!isCurrentLoad(loadId)) {
        return;
      }

      renderFailedPartialResult(key);
    } finally {
      if (!isCurrentLoad(loadId)) {
        return;
      }

      state.pending -= 1;
      await finalizeWhenReady(loadId, state);
    }
  }

  function renderPartialResult(state, key, data) {
    if (key === 'ipv4') {
      setText(fields.ipv4, isIPv4(data?.ip) ? data.ip : 'Niet beschikbaor');
    }

    if (key === 'ipv6') {
      setText(fields.ipv6, isIPv6(data?.ip) ? data.ip : 'Niet beschikbaor');
    }

    if (key === 'universal') {
      setText(fields.universalIp, data?.ip ? `${data.ip} (${getIpVersion(data.ip)})` : 'Niet beschikbaor');
    }

    const preferredIp = getPreferredIp({
      ipv4: state.ipv4?.ip,
      universal: state.universal?.ip,
      geo: state.geo?.ip,
      ipv6: state.ipv6?.ip
    });

    if (preferredIp && preferredIp !== state.preferredIp) {
      state.preferredIp = preferredIp;
      state.hasMainIp = true;
      renderMainIp(preferredIp);
      setText(fields.ip, preferredIp);
      setText(fields.version, getIpVersion(preferredIp));
    }

    if (key === 'geo') {
      renderGeoDetails(data, state.preferredIp || data?.ip);
      renderMapFromGeo(data);
      lastUpdated.textContent = `Lest biewerkt: ${new Date().toLocaleString('nl-NL')}`;
    }
  }

  function renderFailedPartialResult(key) {
    if (key === 'ipv4') {
      setText(fields.ipv4, 'Niet beschikbaor');
    }

    if (key === 'ipv6') {
      setText(fields.ipv6, 'Niet beschikbaor');
    }

    if (key === 'universal') {
      setText(fields.universalIp, 'Niet beschikbaor');
    }
  }

  async function finalizeWhenReady(loadId, state) {
    const isDone = state.pending <= 0;

    if (!isDone) {
      return;
    }

    if (!state.hasMainIp) {
      renderMainIp(null);
      setStatus('Fout bie \'t laoden', 'error');
      setLoading(false);
      resetMap('De IP-gegevens kunden niet laoden worden. Prebeer het opnij.');
      return;
    }

    const preferredIp = state.preferredIp;
    let geo = state.geo;

    // Alleen een extra geo-lookup doen als het getoonde voorkeurs-IP anders is dan de
    // geo-call. Dit voorkomt onnodige vertraging tijdens de eerste weergave.
    if (preferredIp && geo?.ip && preferredIp !== geo.ip) {
      try {
        const preferredGeo = await fetchAny(ENDPOINTS.geoForIp(preferredIp), TIMEOUTS.preferredGeo);

        if (isCurrentLoad(loadId) && preferredGeo && !preferredGeo.error) {
          geo = preferredGeo;
        }
      } catch (error) {
        console.warn('Geo-details veur het veurkeurs-IP konden niet elaoden worden.', error);
      }
    }

    if (!isCurrentLoad(loadId)) {
      return;
    }

    if (geo) {
      renderGeoDetails(geo, preferredIp);
      renderMapFromGeo(geo);
    }

    lastUpdated.textContent = `Lest biewerkt: ${new Date().toLocaleString('nl-NL')}`;
    setStatus('Laoden', 'success');
    setLoading(false);
  }

  async function fetchAny(endpoints, timeoutMs) {
    const candidates = Array.isArray(endpoints) ? endpoints : [endpoints];

    return new Promise((resolve, reject) => {
      let rejectedCount = 0;
      let lastError = null;
      let resolved = false;
      const timer = window.setTimeout(() => {
        finish(null, new Error('Alle endpoints duurden te lang.'));
      }, timeoutMs + 250);

      candidates.forEach((endpoint) => {
        fetchEndpoint(endpoint, timeoutMs).then(
          (data) => finish(data),
          (error) => {
            rejectedCount += 1;
            lastError = error;

            if (rejectedCount === candidates.length) {
              finish(null, lastError || new Error('Gien endpoint gaf geldige data terug.'));
            }
          }
        );
      });

      function finish(data, error) {
        if (resolved) {
          return;
        }

        resolved = true;
        window.clearTimeout(timer);

        if (error) {
          reject(error);
          return;
        }

        resolve(data);
      }
    });
  }

  async function fetchEndpoint(endpoint, timeoutMs) {
    const config = typeof endpoint === 'string' ? { url: endpoint } : endpoint;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(config.url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: config.responseType === 'text' ? 'text/plain, */*' : 'application/json, text/plain, */*'
        }
      });

      if (!response.ok) {
        throw new Error(`Request mislukt met status ${response.status}`);
      }

      const data = config.responseType === 'text' ? await response.text() : await response.json();
      return config.normalize ? config.normalize(data) : data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function getPreferredIp(addresses) {
    const candidates = [
      addresses?.ipv4,
      addresses?.universal,
      addresses?.geo,
      addresses?.ipv6
    ];

    const ipv4 = candidates.find((ip) => isIPv4(ip));

    if (ipv4) {
      return ipv4;
    }

    const ipv6 = candidates.find((ip) => isIPv6(ip));
    return ipv6 || null;
  }

  function renderGeoDetails(data, preferredIp) {
    const ip = preferredIp || data?.ip || '-';

    setText(fields.ip, ip);
    setText(fields.version, getIpVersion(ip));
    setText(fields.country, data?.country_name || data?.country || '-');
    setText(fields.region, data?.region || '-');
    setText(fields.city, data?.city || '-');
    setText(fields.latitude, formatValue(data?.latitude));
    setText(fields.longitude, formatValue(data?.longitude));
    setText(fields.org, data?.org || data?.asn || '-');
    setText(fields.timezone, data?.timezone || '-');
  }

  function renderMainIp(ip) {
    if (ip) {
      const title = `Oe IP-adres: ${ip}`;
      document.title = title;
      mainIpValue.textContent = ip;
      pageTitle.setAttribute('aria-label', title);
      syncCopyButton(copyMainIpButton, ip);
      return;
    }

    document.title = 'Oe IP-adres';
    mainIpValue.textContent = '-';
    pageTitle.setAttribute('aria-label', 'Oe IP-adres: -');
    syncCopyButton(copyMainIpButton, '');
  }

  function renderMapFromGeo(geo) {
    const latitude = parseCoordinate(geo?.latitude);
    const longitude = parseCoordinate(geo?.longitude);

    if (latitude !== null && longitude !== null) {
      renderMap(latitude, longitude);
      return;
    }

    resetMap('Gien geldige coördinaoten evonden veur dit IP-adres.');
  }

  function renderMap(latitude, longitude) {
    const mapUrl = buildMapEmbedUrl(latitude, longitude);
    const externalMapUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

    mapFrame.src = mapUrl;
    mapFrame.hidden = false;
    mapPlaceholder.hidden = true;

    openMapLink.href = externalMapUrl;
    openMapLink.setAttribute('aria-disabled', 'false');
  }

  function buildMapEmbedUrl(latitude, longitude) {
    const center = `${latitude},${longitude}`;

    if (GOOGLE_MAPS_EMBED_API_KEY.trim()) {
      const params = new URLSearchParams({
        key: GOOGLE_MAPS_EMBED_API_KEY.trim(),
        center,
        zoom: '12',
        maptype: 'roadmap'
      });

      return `https://www.google.com/maps/embed/v1/view?${params.toString()}`;
    }

    const params = new URLSearchParams({
      q: center,
      z: '12',
      output: 'embed'
    });

    return `https://maps.google.com/maps?${params.toString()}`;
  }

  function resetValuesForNewLoad() {
    renderMainIp(null);
    lastUpdated.textContent = 'Nog niet elaoden';

    setText(fields.ip, 'Wordt elaoden…');
    setText(fields.version, '-');
    setText(fields.country, 'Volgt…');
    setText(fields.region, 'Volgt…');
    setText(fields.city, 'Volgt…');
    setText(fields.latitude, 'Volgt…');
    setText(fields.longitude, 'Volgt…');
    setText(fields.org, 'Volgt…');
    setText(fields.timezone, 'Volgt…');
    setText(fields.ipv4, 'Wordt elaoden…');
    setText(fields.ipv6, 'Wordt elaoden…');
    setText(fields.universalIp, 'Wordt elaoden…');
  }

  function resetMap(message) {
    mapFrame.removeAttribute('src');
    mapFrame.hidden = true;
    mapPlaceholder.hidden = false;
    mapPlaceholder.textContent = message;
    openMapLink.href = '#';
    openMapLink.setAttribute('aria-disabled', 'true');
  }

  function parseCoordinate(value) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function formatValue(value) {
    if (value === undefined || value === null || value === '') {
      return '-';
    }

    return String(value);
  }

  function setText(element, value) {
    if (!element) {
      return;
    }

    const formattedValue = formatValue(value);
    element.textContent = formattedValue;
    syncCopyButton(copyButtonsByField[element.dataset.fieldName], formattedValue);
  }

  function enhanceTableCopyButtons() {
    document.querySelectorAll('td[data-field]').forEach((cell) => {
      const fieldName = cell.dataset.field;
      const value = cell.textContent;
      const valueElement = document.createElement('span');
      const copyButton = document.createElement('button');

      valueElement.className = 'field-value';
      valueElement.dataset.fieldName = fieldName;
      valueElement.textContent = value;

      copyButton.className = 'copy-button copy-button-table';
      copyButton.type = 'button';
      copyButton.textContent = 'Kopieer';
      copyButton.addEventListener('click', () => copyFromButton(copyButton));

      cell.textContent = '';
      cell.append(valueElement, copyButton);

      fields[fieldName] = valueElement;
      copyButtonsByField[fieldName] = copyButton;
      syncCopyButton(copyButton, value);
    });
  }

  async function copyFromButton(button) {
    const value = button?.dataset.copyValue || '';

    if (!value) {
      return;
    }

    const originalText = button.textContent;

    try {
      await copyToClipboard(value);
      flashCopyButton(button, 'Gekopieerd', originalText);
    } catch (error) {
      console.warn('Kopiëren is mislukt.', error);
      flashCopyButton(button, 'Mislukt', originalText);
    }
  }

  async function copyToClipboard(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const didCopy = document.execCommand('copy');
    textarea.remove();

    if (!didCopy) {
      throw new Error('Fallback kopiëren werd geweigerd.');
    }
  }

  function flashCopyButton(button, text, originalText) {
    button.textContent = text;
    window.clearTimeout(button.copyResetTimer);
    button.copyResetTimer = window.setTimeout(() => {
      button.textContent = originalText;
    }, 1400);
  }

  function syncCopyButton(button, value) {
    if (!button) {
      return;
    }

    const copyValue = getCopyableValue(value);
    button.dataset.copyValue = copyValue;
    button.disabled = !copyValue;
    button.setAttribute('aria-label', copyValue ? `Kopieer ${copyValue}` : 'Niks te kopiëren');
  }

  function getCopyableValue(value) {
    const text = formatValue(value).trim();
    const blockedValues = ['-', 'Volgt…', 'Wordt elaoden…', 'Niet beschikbaor'];

    if (!text || blockedValues.includes(text)) {
      return '';
    }

    return text;
  }

  function normalizeIpJson(data) {
    const ip = data?.ip || data?.query;

    if (!isIPv4(ip) && !isIPv6(ip)) {
      throw new Error('Gien geldig IP-adres ontvangen.');
    }

    return { ip };
  }

  function normalizePlainIp(data) {
    const ip = String(data || '').trim();

    if (!isIPv4(ip) && !isIPv6(ip)) {
      throw new Error('Gien geldig IP-adres ontvangen.');
    }

    return { ip };
  }

  function normalizeIpApiGeo(data) {
    if (!data || data.error) {
      throw new Error(data?.reason || 'Geo endpoint gaf gien geldige data terug.');
    }

    return data;
  }

  function normalizeIpWhoIsGeo(data) {
    if (!data || data.success === false) {
      throw new Error(data?.message || 'Geo endpoint gaf gien geldige data terug.');
    }

    return {
      ip: data.ip,
      country_name: data.country,
      country: data.country_code,
      region: data.region,
      city: data.city,
      latitude: data.latitude,
      longitude: data.longitude,
      org: data.connection?.org || data.connection?.isp,
      timezone: data.timezone?.id
    };
  }

  function getIpVersion(ip) {
    if (isIPv4(ip)) {
      return 'IPv4';
    }

    if (isIPv6(ip)) {
      return 'IPv6';
    }

    return '-';
  }

  function isIPv4(ip) {
    if (typeof ip !== 'string') {
      return false;
    }

    const parts = ip.trim().split('.');

    if (parts.length !== 4) {
      return false;
    }

    return parts.every((part) => {
      if (!/^\d{1,3}$/.test(part)) {
        return false;
      }

      const numberPart = Number(part);
      return numberPart >= 0 && numberPart <= 255;
    });
  }

  function isIPv6(ip) {
    if (typeof ip !== 'string') {
      return false;
    }

    const trimmedIp = ip.trim();
    return trimmedIp.includes(':') && /^[0-9a-fA-F:.]+$/.test(trimmedIp);
  }

  function isCurrentLoad(loadId) {
    return loadId === activeLoadId;
  }

  function setLoading(isLoading) {
    refreshButton.disabled = isLoading;
    refreshButton.textContent = isLoading ? 'Laoden…' : 'Opnij laden';
  }

  function setStatus(text, type) {
    statusPill.textContent = text;
    statusPill.classList.remove('is-loading', 'is-error');

    if (type === 'loading') {
      statusPill.classList.add('is-loading');
    }

    if (type === 'error') {
      statusPill.classList.add('is-error');
    }
  }
})();
