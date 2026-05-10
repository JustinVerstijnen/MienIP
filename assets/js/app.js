(() => {
  'use strict';

  const ENDPOINTS = {
    geo: 'https://ipapi.co/json/',
    geoForIp: (ip) => `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
    ipv4: 'https://api.ipify.org?format=json',
    ipv6: 'https://api6.ipify.org?format=json',
    universal: 'https://api64.ipify.org?format=json'
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

  const fields = {
    ip: document.querySelector('[data-field="ip"]'),
    version: document.querySelector('[data-field="version"]'),
    country: document.querySelector('[data-field="country"]'),
    region: document.querySelector('[data-field="region"]'),
    city: document.querySelector('[data-field="city"]'),
    latitude: document.querySelector('[data-field="latitude"]'),
    longitude: document.querySelector('[data-field="longitude"]'),
    org: document.querySelector('[data-field="org"]'),
    timezone: document.querySelector('[data-field="timezone"]'),
    ipv4: document.querySelector('[data-field="ipv4"]'),
    ipv6: document.querySelector('[data-field="ipv6"]'),
    universalIp: document.querySelector('[data-field="universalIp"]')
  };

  const pageTitle = document.querySelector('#page-title');
  const refreshButton = document.querySelector('#refreshButton');
  const statusPill = document.querySelector('#statusPill');
  const lastUpdated = document.querySelector('#lastUpdated');
  const mapFrame = document.querySelector('#mapFrame');
  const mapPlaceholder = document.querySelector('#mapPlaceholder');
  const openMapLink = document.querySelector('#openMapLink');

  let activeLoadId = 0;

  document.addEventListener('DOMContentLoaded', () => {
    refreshButton.addEventListener('click', loadIpData);
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

    const geoPromise = fetchJson(ENDPOINTS.geo, TIMEOUTS.geo);
    const ipv4Promise = fetchJson(ENDPOINTS.ipv4, TIMEOUTS.ipv4);
    const ipv6Promise = fetchJson(ENDPOINTS.ipv6, TIMEOUTS.ipv6);
    const universalPromise = fetchJson(ENDPOINTS.universal, TIMEOUTS.universal);

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
    setStatus('Ie Pee adres evonden, nou de rest noh…', 'loading');
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
        const preferredGeo = await fetchJson(ENDPOINTS.geoForIp(preferredIp), TIMEOUTS.preferredGeo);

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

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Request mislukt met status ${response.status}`);
      }

      return await response.json();
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
      pageTitle.textContent = title;
      return;
    }

    document.title = 'Oe IP-adres';
    pageTitle.textContent = 'Oe IP-adres: -';
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

    element.textContent = formatValue(value);
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
