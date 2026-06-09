const NOAA_DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NOAA_META_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json";
const NWS_URL = "https://api.weather.gov";
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search";
const DEFAULT_MAP_CENTER = { lat: 39.5, lng: -98.35 };
const DEFAULT_MAP_ZOOM = 4;

const state = {
  googleMap: null,
  googleMarker: null,
  googleSuggestionService: null,
  googleAuthFailed: false,
  stationCache: new Map(),
  suggestions: [],
  suggestionIndex: -1,
  suggestionTimer: null,
  suggestionRequest: null,
};

const els = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#search-input"),
  clearSearch: document.querySelector("#clear-search"),
  suggestionsList: document.querySelector("#suggestions-list"),
  status: document.querySelector("#status"),
  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  googleKey: document.querySelector("#google-key"),
  keyStatus: document.querySelector("#key-status"),
  saveKey: document.querySelector("#save-key"),
  clearKey: document.querySelector("#clear-key"),
  map: document.querySelector("#map"),
  airTemp: document.querySelector("#air-temp"),
  airSource: document.querySelector("#air-source"),
  waterTemp: document.querySelector("#water-temp"),
  waterSource: document.querySelector("#water-source"),
  wind: document.querySelector("#wind"),
  windSource: document.querySelector("#wind-source"),
  forecastPeriod: document.querySelector("#forecast-period"),
  forecastSummary: document.querySelector("#forecast-summary"),
  forecastDetail: document.querySelector("#forecast-detail"),
  forecastTemp: document.querySelector("#forecast-temp"),
  forecastLow: document.querySelector("#forecast-low"),
  forecastWind: document.querySelector("#forecast-wind"),
  forecastRain: document.querySelector("#forecast-rain"),
  riskCount: document.querySelector("#risk-count"),
  riskSource: document.querySelector("#risk-source"),
  tideList: document.querySelector("#tide-list"),
  tideStation: document.querySelector("#tide-station"),
  alertsList: document.querySelector("#alerts-list"),
  alertRegion: document.querySelector("#alert-region"),
  locationLabel: document.querySelector("#location-label"),
  tideStationDetail: document.querySelector("#tide-station-detail"),
  waterStationDetail: document.querySelector("#water-station-detail"),
};

initialize();

function initialize() {
  els.googleKey.value = getConfiguredGoogleKey();
  const savedKey = els.googleKey.value.trim();
  updateKeyStatus(savedKey);
  if (savedKey) loadGoogleMaps(savedKey);

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.suggestionIndex >= 0 && state.suggestions[state.suggestionIndex]) {
      selectSuggestion(state.suggestions[state.suggestionIndex]);
      return;
    }
    hideSuggestions();
    searchBeach(els.input.value.trim());
  });

  els.input.addEventListener("input", () => {
    updateClearSearch();
    queueSuggestions(els.input.value.trim());
  });
  els.input.addEventListener("focus", () => {
    if (state.suggestions.length) renderSuggestions(state.suggestions);
  });
  els.input.addEventListener("keydown", handleSuggestionKeys);
  els.clearSearch.addEventListener("click", () => {
    els.input.value = "";
    state.suggestions = [];
    updateClearSearch();
    hideSuggestions();
    els.input.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-combobox")) hideSuggestions();
  });

  document.querySelectorAll("[data-place]").forEach((button) => {
    button.addEventListener("click", () => {
      els.input.value = button.dataset.place;
      updateClearSearch();
      searchBeach(button.dataset.place);
    });
  });

  els.settingsButton.addEventListener("click", openSettings);
  els.saveKey.addEventListener("click", () => {
    const key = els.googleKey.value.trim();
    if (key) {
      if (!key.startsWith("AIza")) {
        setStatus("That does not look like a Google Maps API key. Copy the API key value, not the URL signing secret.", true);
        return;
      }
      saveGoogleKey(key);
      updateKeyStatus(key);
      loadGoogleMaps(key);
    }
  });
  els.clearKey.addEventListener("click", () => {
    clearGoogleKey();
    els.googleKey.value = "";
    updateKeyStatus("");
    setStatus("Google Maps key cleared. Refresh to remove the loaded map script.");
  });
}

function getConfiguredGoogleKey() {
  return window.BEACH_BUMS_CONFIG?.googleMapsKey || getSavedGoogleKey();
}

function openSettings() {
  if (typeof els.settingsDialog.showModal === "function") {
    els.settingsDialog.showModal();
    return;
  }

  els.settingsDialog.setAttribute("open", "");
}

function getSavedGoogleKey() {
  try {
    return window.localStorage?.getItem("googleMapsKey") || "";
  } catch {
    setStatus("Settings storage is unavailable on this page. Use http://127.0.0.1:4174 instead of opening the file directly.", true);
    return "";
  }
}

function saveGoogleKey(key) {
  try {
    window.localStorage?.setItem("googleMapsKey", key);
  } catch {
    setStatus("Could not save the key on this page. Open http://127.0.0.1:4174 and try again.", true);
  }
}

function clearGoogleKey() {
  try {
    window.localStorage?.removeItem("googleMapsKey");
  } catch {
    setStatus("Could not clear the saved key on this page.", true);
  }
}

function updateKeyStatus(key) {
  const configuredBySite = Boolean(window.BEACH_BUMS_CONFIG?.googleMapsKey);
  els.keyStatus.textContent = key
    ? `${configuredBySite ? "Site key" : "Saved key"}: ${key.slice(0, 6)}...${key.slice(-4)}`
    : "No Google Maps key saved for this browser origin.";
}

function queueSuggestions(query) {
  window.clearTimeout(state.suggestionTimer);
  state.suggestionIndex = -1;
  state.suggestionSource = null;

  if (query.length < 2) {
    hideSuggestions();
    return;
  }

  state.suggestionTimer = window.setTimeout(() => {
    loadSuggestions(query).catch((error) => {
      if (error.name !== "AbortError") console.warn("Suggestion lookup failed", error);
    });
  }, 250);
}

async function loadSuggestions(query) {
  if (state.suggestionRequest) state.suggestionRequest.abort();
  state.suggestionRequest = new AbortController();

  const googleSuggestions = await getGoogleSuggestions(query);
  if (googleSuggestions.length) {
    state.suggestions = rankSuggestions(googleSuggestions).slice(0, 6);
    state.suggestionSource = "google";
    renderSuggestions(state.suggestions);
    return;
  }

  const params = new URLSearchParams({
    q: query,
    countrycodes: "us",
    format: "jsonv2",
    limit: "6",
    addressdetails: "1",
  });

  const results = await fetchJson(`${GEOCODE_URL}?${params}`, {
    signal: state.suggestionRequest.signal,
  });

  const suggestions = results
    .map(formatSuggestion)
    .filter(Boolean)
    .filter((suggestion, index, list) => list.findIndex((item) => item.label === suggestion.label) === index);

  state.suggestions = rankSuggestions(suggestions).slice(0, 6);
  state.suggestionSource = "fallback";
  renderSuggestions(state.suggestions);
}

async function getGoogleSuggestions(query) {
  if (!state.googleSuggestionService) return [];

  try {
    const predictions = await new Promise((resolve) => {
      state.googleSuggestionService.getPlacePredictions({
        input: query,
        componentRestrictions: { country: "us" },
      }, (results, status) => {
        if (status === google.maps.places.PlacesServiceStatus.OK && results) resolve(results);
        else resolve([]);
      });
    });

    return predictions.map((prediction) => {
      const main = prediction.structured_formatting?.main_text || prediction.description;
      const detail = prediction.structured_formatting?.secondary_text || "United States";
      const detailParts = detail.split(",");
      return {
        name: main,
        detail,
        label: prediction.description,
        types: prediction.types || [],
        shortLabel: `${main}${detail ? `, ${detailParts[detailParts.length - 1].trim()}` : ""}`,
      };
    });
  } catch {
    return [];
  }
}

function rankSuggestions(suggestions) {
  return suggestions
    .map((suggestion, originalIndex) => ({
      ...suggestion,
      rankScore: suggestionRank(suggestion, originalIndex),
    }))
    .filter((suggestion) => suggestion.rankScore > -40)
    .sort((a, b) => b.rankScore - a.rankScore)
    .map(({ rankScore, ...suggestion }) => suggestion);
}

function suggestionRank(suggestion, originalIndex) {
  const haystack = `${suggestion.name || ""} ${suggestion.shortLabel || ""} ${suggestion.detail || ""} ${suggestion.label || ""}`.toLowerCase();
  const types = suggestion.types || [];
  let score = 100 - originalIndex;

  if (types.some((type) => ["locality", "postal_code", "administrative_area_level_3"].includes(type))) score += 60;
  if (types.some((type) => ["natural_feature", "tourist_attraction", "park"].includes(type))) score += 35;
  if (types.some((type) => ["school", "university", "secondary_school"].includes(type))) score -= 90;
  if (types.some((type) => ["train_station", "transit_station", "bus_station"].includes(type))) score -= 55;

  if (/\bbeach\b|\bshore\b|\bcoast\b|\bocean\b|\bseaside\b|\bboardwalk\b|\bstate park\b/.test(haystack)) score += 55;
  if (/\bcity\b|\btown\b|\bvillage\b|\bcounty\b/.test(haystack)) score += 10;
  if (/\bschool\b|\bhigh school\b|\belementary\b|\bcollege\b|\bacademy\b|\buniversity\b/.test(haystack)) score -= 100;
  if (/\bstation\b|\bterminal\b|\bairport\b|\bhospital\b|\bmall\b|\bcomplex\b|\bshop\b|\bstore\b/.test(haystack)) score -= 45;

  return score;
}

function formatSuggestion(result) {
  const address = result.address || {};
  const name = address.city
    || address.town
    || address.village
    || address.hamlet
    || address.suburb
    || address.neighbourhood
    || result.name;
  if (!name && !result.display_name) return null;

  const stateName = address.state ? `, ${address.state}` : "";
  const postal = address.postcode ? ` ${address.postcode}` : "";
  const label = result.display_name;
  return {
    name: name || result.display_name.split(",")[0],
    detail: `${address.county ? `${address.county}, ` : ""}${address.state || "United States"}${postal}`,
    label,
    lat: Number(result.lat),
    lon: Number(result.lon),
    shortLabel: `${name || result.display_name.split(",")[0]}${stateName}`,
  };
}

function renderSuggestions(suggestions) {
  if (!suggestions.length) {
    hideSuggestions();
    return;
  }

  els.suggestionsList.hidden = false;
  els.input.setAttribute("aria-expanded", "true");
  const rows = suggestions.map((suggestion, index) => `
    <button class="suggestion-option${index === state.suggestionIndex ? " is-active" : ""}" type="button" role="option" aria-selected="${index === state.suggestionIndex}" data-index="${index}">
      <span class="suggestion-icon" aria-hidden="true">●</span>
      <span>
        <span class="suggestion-name">${escapeHtml(suggestion.shortLabel)}</span>
        <span class="suggestion-detail">${escapeHtml(suggestion.detail)}</span>
      </span>
    </button>
  `).join("");
  els.suggestionsList.innerHTML = state.suggestionSource === "google"
    ? `${rows}${googleAttribution()}`
    : rows;

  els.suggestionsList.querySelectorAll(".suggestion-option").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      selectSuggestion(state.suggestions[Number(button.dataset.index)]);
    });
  });
}

function handleSuggestionKeys(event) {
  if (els.suggestionsList.hidden || !state.suggestions.length) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    state.suggestionIndex = (state.suggestionIndex + 1) % state.suggestions.length;
    renderSuggestions(state.suggestions);
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    state.suggestionIndex = state.suggestionIndex <= 0
      ? state.suggestions.length - 1
      : state.suggestionIndex - 1;
    renderSuggestions(state.suggestions);
  }

  if (event.key === "Escape") {
    hideSuggestions();
  }
}

function selectSuggestion(suggestion) {
  if (!suggestion) return;
  els.input.value = suggestion.shortLabel;
  updateClearSearch();
  hideSuggestions();
  searchBeach(suggestion.label);
}

function hideSuggestions() {
  state.suggestionIndex = -1;
  els.suggestionsList.hidden = true;
  els.suggestionsList.innerHTML = "";
  els.input.setAttribute("aria-expanded", "false");
}

function updateClearSearch() {
  els.clearSearch.hidden = !els.input.value.trim();
}

function googleAttribution() {
  return `
    <div class="powered-by-google" aria-label="Powered by Google">
      powered by
      <strong>
        <span class="google-blue">G</span><span class="google-red">o</span><span class="google-yellow">o</span><span class="google-blue">g</span><span class="google-green">l</span><span class="google-red">e</span>
      </strong>
    </div>
  `;
}

async function searchBeach(query) {
  if (!query) return;
  setLoading(true, `Searching for ${query}...`);

  try {
    const place = await geocode(query);
    updateLocation(place);
    updateMap(place);
    setStatus(`Found ${place.label}. Loading weather, tides, and water conditions...`);

    const [stations, weather, alerts] = await Promise.all([
      resolveStations(place),
      getWeather(place),
      getAlerts(place),
    ]);

    const [tides, waterTemp] = await Promise.all([
      getTidePredictions(stations.tide),
      getWaterTemperature(stations.water),
    ]);

    renderWeather(weather);
    renderWaterTemp(waterTemp, stations.water);
    renderTides(tides, stations.tide);
    renderAlerts(alerts);
    renderStations(place, stations);
    setStatus(`Updated ${place.label} at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`);
  } catch (error) {
    console.error(error);
    setStatus(searchErrorMessage(error), true);
  } finally {
    setLoading(false);
  }
}

async function geocode(query) {
  if (window.google?.maps?.Geocoder) {
    const geocoder = new google.maps.Geocoder();
    const result = await new Promise((resolve, reject) => {
      geocoder.geocode({ address: query, componentRestrictions: { country: "US" } }, (results, status) => {
        if (status === "OK" && results?.[0]) resolve(results[0]);
        else reject(new Error("Google could not find that beach or town."));
      });
    });
    return {
      label: result.formatted_address,
      lat: result.geometry.location.lat(),
      lon: result.geometry.location.lng(),
    };
  }

  const params = new URLSearchParams({
    q: query,
    countrycodes: "us",
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
  });
  const results = await fetchJson(`${GEOCODE_URL}?${params}`);
  if (!results.length) throw new Error("Could not find that beach, town, or ZIP code.");
  return {
    label: results[0].display_name,
    lat: Number(results[0].lat),
    lon: Number(results[0].lon),
  };
}

async function resolveStations(place) {
  const [tideStations, waterStations] = await Promise.all([
    getStations("waterlevels"),
    getStations("watertemp"),
  ]);

  const tide = nearestStation(place, tideStations);
  const water = nearestStation(place, waterStations);
  if (!tide) throw new Error("No nearby NOAA tide station was found.");
  if (!water) throw new Error("No nearby NOAA water-temperature station was found.");
  return { tide, water };
}

async function getStations(type) {
  if (state.stationCache.has(type)) return state.stationCache.get(type);
  const url = `${NOAA_META_URL}?type=${encodeURIComponent(type)}`;
  const json = await fetchJson(url);
  const stations = (json.stations || [])
    .map((station) => ({
      id: station.id,
      name: station.name,
      state: station.state,
      lat: Number(station.lat),
      lon: Number(station.lng ?? station.lon),
    }))
    .filter((station) => station.id && Number.isFinite(station.lat) && Number.isFinite(station.lon));
  state.stationCache.set(type, stations);
  return stations;
}

function nearestStation(place, stations) {
  return stations
    .map((station) => ({
      ...station,
      miles: haversineMiles(place.lat, place.lon, station.lat, station.lon),
    }))
    .sort((a, b) => a.miles - b.miles)[0];
}

async function getWeather(place) {
  const point = await fetchJson(`${NWS_URL}/points/${place.lat.toFixed(4)},${place.lon.toFixed(4)}`);
  const stations = await fetchJson(point.properties.observationStations);
  const stationUrl = stations.features?.[0]?.id;
  let observation = null;

  if (stationUrl) {
    try {
      observation = await fetchJson(`${stationUrl}/observations/latest`);
    } catch {
      observation = null;
    }
  }

  let forecast = null;
  try {
    forecast = await fetchJson(point.properties.forecast);
  } catch {
    forecast = null;
  }

  return { observation, forecast, stationUrl };
}

async function getAlerts(place) {
  const url = `${NWS_URL}/alerts/active?point=${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
  const json = await fetchJson(url);
  return json.features || [];
}

async function getTidePredictions(station) {
  const today = yyyymmdd(new Date());
  const params = new URLSearchParams({
    product: "predictions",
    application: "beach_conditions_app",
    begin_date: today,
    end_date: today,
    datum: "MLLW",
    station: station.id,
    time_zone: "lst_ldt",
    units: "english",
    interval: "hilo",
    format: "json",
  });
  const json = await fetchJson(`${NOAA_DATA_URL}?${params}`);
  return json.predictions || [];
}

async function getWaterTemperature(station) {
  const params = new URLSearchParams({
    product: "water_temperature",
    application: "beach_conditions_app",
    date: "latest",
    station: station.id,
    time_zone: "lst_ldt",
    units: "english",
    format: "json",
  });
  const json = await fetchJson(`${NOAA_DATA_URL}?${params}`);
  return json.data?.[0] || null;
}

function renderWeather(weather) {
  const props = weather.observation?.properties;
  const tempF = cToF(props?.temperature?.value);
  const windMph = msToMph(props?.windSpeed?.value);
  const windDirection = degreesToCompass(props?.windDirection?.value);
  const fallbackPeriod = weather.forecast?.properties?.periods?.[0];

  els.airTemp.textContent = tempF == null
    ? fallbackPeriod?.temperature
      ? `${fallbackPeriod.temperature}°${fallbackPeriod.temperatureUnit}`
      : "--"
    : `${Math.round(tempF)}°F`;
  els.airSource.textContent = props?.station ? "Latest NWS observation" : "NWS forecast fallback";

  els.wind.textContent = windMph == null
    ? fallbackPeriod?.windSpeed || "--"
    : `${Math.round(windMph)} mph${windDirection ? ` ${windDirection}` : ""}`;
  els.windSource.textContent = windDirection
    ? `Wind from the ${windDirection}`
    : fallbackPeriod?.windDirection
      ? `Wind from the ${fallbackPeriod.windDirection}`
      : "Direction unavailable";

  renderDayForecast(weather.forecast?.properties?.periods || []);
}

function renderDayForecast(periods) {
  const period = periods.find((item) => item.isDaytime) || periods[0];

  if (!period) {
    els.forecastPeriod.textContent = "NWS forecast unavailable";
    els.forecastSummary.textContent = "--";
    els.forecastDetail.textContent = "No daily forecast returned for this location.";
    els.forecastTemp.textContent = "--";
    els.forecastLow.textContent = "--";
    els.forecastWind.textContent = "--";
    els.forecastRain.textContent = "--";
    return;
  }

  const nightPeriod = periods.find((item) => !item.isDaytime);
  const rainChance = period.probabilityOfPrecipitation?.value;
  els.forecastPeriod.textContent = period.name || "Today";
  els.forecastSummary.textContent = period.shortForecast || "Forecast available";
  els.forecastDetail.textContent = period.detailedForecast || "No detailed forecast provided.";
  els.forecastTemp.textContent = `${period.temperature}°${period.temperatureUnit}`;
  els.forecastLow.textContent = nightPeriod ? `${nightPeriod.temperature}°${nightPeriod.temperatureUnit}` : "--";
  els.forecastWind.textContent = `${period.windSpeed || "--"}${period.windDirection ? ` ${period.windDirection}` : ""}`;
  els.forecastRain.textContent = Number.isFinite(Number(rainChance)) ? `${rainChance}%` : "--";
}

function renderWaterTemp(reading, station) {
  const value = Number(reading?.v);
  els.waterTemp.textContent = Number.isFinite(value) ? `${Math.round(value)}°F` : "--";
  els.waterSource.textContent = reading?.t ? `NOAA ${formatDateTime(reading.t)}` : "NOAA sensor unavailable";
  els.waterStationDetail.textContent = stationLabel(station);
}

function renderTides(tides, station) {
  els.tideStation.textContent = stationLabel(station);
  els.tideStationDetail.textContent = stationLabel(station);

  if (!tides.length) {
    els.tideList.className = "tide-list empty-state";
    els.tideList.textContent = "No high/low tide predictions returned for today.";
    return;
  }

  els.tideList.className = "tide-list";
  els.tideList.innerHTML = tides.map((tide) => {
    const type = tide.type === "H" ? "High" : "Low";
    return `
      <div class="tide-item">
        <span class="tide-type">${type}</span>
        <span class="tide-time">${formatDateTime(tide.t)}</span>
        <span class="tide-height">${Number(tide.v).toFixed(2)} ft</span>
      </div>
    `;
  }).join("");
}

function renderAlerts(alerts) {
  const beachAlerts = alerts.filter((alert) => {
    const text = `${alert.properties.event} ${alert.properties.headline} ${alert.properties.description}`.toLowerCase();
    return /rip|beach|surf|marine|coastal|flood|current|swim|wave|wind/.test(text);
  });
  const displayAlerts = beachAlerts.length ? beachAlerts : alerts;

  els.riskCount.textContent = displayAlerts.length ? `${displayAlerts.length}` : "0";
  els.riskSource.textContent = displayAlerts.length ? "Active NWS alerts" : "No active NWS alerts";
  els.alertRegion.textContent = displayAlerts.length ? "Active notices" : "No active notices";

  if (!displayAlerts.length) {
    els.alertsList.className = "alerts-list empty-state";
    els.alertsList.textContent = "No active beach, marine, or weather alerts at this point.";
    return;
  }

  els.alertsList.className = "alerts-list";
  els.alertsList.innerHTML = displayAlerts.slice(0, 5).map((alert) => `
    <div class="alert-item">
      <strong>${escapeHtml(alert.properties.event || "Weather alert")}</strong>
      <p>${escapeHtml(alert.properties.headline || alert.properties.description || "Open NWS for details.")}</p>
    </div>
  `).join("");
}

function renderStations(place, stations) {
  els.locationLabel.textContent = `${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}`;
  els.tideStationDetail.textContent = stationLabel(stations.tide);
  els.waterStationDetail.textContent = stationLabel(stations.water);
}

function updateLocation(place) {
  els.locationLabel.textContent = place.label;
}

function updateMap(place) {
  if (!window.google?.maps?.Map) {
    els.map.innerHTML = `
      <div class="map-fallback">
        <div>
          <p>${escapeHtml(place.label)}</p>
          <span>${place.lat.toFixed(4)}, ${place.lon.toFixed(4)}</span>
        </div>
      </div>
    `;
    return;
  }

  const position = { lat: place.lat, lng: place.lon };
  if (!state.googleMap) {
    state.googleMap = new google.maps.Map(els.map, {
      center: position,
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
    });
    createOrMoveMarker(position);
  } else {
    state.googleMap.setCenter(position);
    state.googleMap.setZoom(12);
    createOrMoveMarker(position);
  }
}

function loadGoogleMaps(key) {
  if (window.google?.maps) return;
  window.gm_authFailure = () => {
    state.googleAuthFailed = true;
    setStatus("Google Maps rejected this key. Check website restrictions, API restrictions, billing, and that http://localhost:4174/* is allowed.", true);
  };
  window.initBeachMap = async () => {
    const [{ Map }] = await Promise.all([
      google.maps.importLibrary("maps"),
      google.maps.importLibrary("places"),
    ]);
    google.maps.Map = Map;
    setupGoogleAutocomplete();
    initializeDefaultMap();
    setStatus("Google Maps is ready. Search with Google-powered location lookup.");
  };
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=initBeachMap`;
  script.async = true;
  script.onerror = () => setStatus("Google Maps failed to load. Check the key and enabled APIs.", true);
  document.head.appendChild(script);
}

function initializeDefaultMap() {
  if (state.googleAuthFailed || state.googleMap || !window.google?.maps?.Map) return;

  state.googleMap = new google.maps.Map(els.map, {
    center: DEFAULT_MAP_CENTER,
    zoom: DEFAULT_MAP_ZOOM,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
}

function createOrMoveMarker(position) {
  if (state.googleAuthFailed) return;

  if (state.googleMarker) {
    state.googleMarker.setPosition(position);
    return;
  }

  if (google.maps.Marker) {
    state.googleMarker = new google.maps.Marker({
      map: state.googleMap,
      position,
      title: "Selected beach",
    });
  }
}

function setupGoogleAutocomplete() {
  if (google.maps.places?.AutocompleteService) {
    state.googleSuggestionService = new google.maps.places.AutocompleteService();
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);
  return response.json();
}

function searchErrorMessage(error) {
  if (error.name === "TypeError") {
    return "Safari blocked or could not complete one of the live data requests. Try again, or add a Google Maps key for search lookup.";
  }
  return error.message || "Something went wrong loading this beach.";
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function setLoading(isLoading, message) {
  els.form.querySelector("button").disabled = isLoading;
  if (message) setStatus(message);
}

function yyyymmdd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function formatDateTime(value) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function cToF(celsius) {
  const value = Number(celsius);
  return Number.isFinite(value) ? (value * 9 / 5) + 32 : null;
}

function msToMph(ms) {
  const value = Number(ms);
  return Number.isFinite(value) ? value * 2.23694 : null;
}

function degreesToCompass(degrees) {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return null;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const index = Math.round(((value % 360) / 22.5)) % 16;
  return directions[index];
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const radius = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return value * Math.PI / 180;
}

function stationLabel(station) {
  if (!station) return "--";
  const statePart = station.state ? `, ${station.state}` : "";
  return `${station.name}${statePart} (${Math.round(station.miles)} mi)`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
