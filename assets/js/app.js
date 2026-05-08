(() => {
  'use strict';

  const ENDPOINTS = {
    geo: 'https://ipapi.co/json/',
    ipv4: 'https://api.ipify.org?format=json',
    ipv6: 'https://api6.ipify.org?format=json',
    universal: 'https://api64.ipify.org?format=json'
  };

  const REQUEST_TIMEOUT_MS = 9000;

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

  document.addEventListener('DOMContentLoaded', () => {
    refreshButton.addEventListener('click', loadIpData);
    loadIpData();
  });

  async function loadIpData() {
    setLoading(true);
    setStatus('Gegevens worden laoden…', 'loading');
    resetMap('Coördinaoten worden laoden…');

    try {
      const [geoResult, ipv4Result, ipv6Result, universalResult] = await Promise.allSettled([
        fetchJson(ENDPOINTS.geo),
        fetchJson(ENDPOINTS.ipv4),
        fetchJson(ENDPOINTS.ipv6),
        fetchJson(ENDPOINTS.universal)
      ]);

      const geo = unwrapResult(geoResult);
      const ipv4 = unwrapResult(ipv4Result);
      const ipv6 = unwrapResult(ipv6Result);
      const universal = unwrapResult(universalResult);

      renderGeoDetails(geo);
      updatePageTitle(geo?.ip);
      renderSeparateAddresses(ipv4, ipv6, universal);

      const latitude = parseCoordinate(geo?.latitude);
      const longitude = parseCoordinate(geo?.longitude);

      if (latitude !== null && longitude !== null) {
        renderMap(latitude, longitude);
      } else {
        resetMap('Gien geldige coördinaoten evonden veur dit IP-adres.');
      }

      lastUpdated.textContent = `Lest biewerkt: ${new Date().toLocaleString('nl-NL')}`;
      setStatus('Laoden', 'success');
    } catch (error) {
      console.error(error);
      updatePageTitle(null);
      setStatus('Fout bie \'t laoden', 'error');
      resetMap('De IP-gegevens kunden niet laoden worden. Prebeer het opnij.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
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

  function unwrapResult(result) {
    if (result.status === 'fulfilled') {
      return result.value;
    }

    return null;
  }

  function renderGeoDetails(data) {
    const ip = data?.ip || '-';

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


  function updatePageTitle(ip) {
    if (ip) {
      const title = `Dien IP-adres: ${ip}`;
      document.title = title;
      pageTitle.textContent = title;
      return;
    }

    document.title = 'Oe IP-adres';
    pageTitle.textContent = 'Oe IP-adres: -';
  }

  function renderSeparateAddresses(ipv4, ipv6, universal) {
    setText(fields.ipv4, ipv4?.ip || 'Niet beschikbaor');
    setText(fields.ipv6, isIPv6(ipv6?.ip) ? ipv6.ip : 'Niet beschikbaor');
    setText(fields.universalIp, universal?.ip ? `${universal.ip} (${getIpVersion(universal.ip)})` : 'Niet beschikbaor');
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
