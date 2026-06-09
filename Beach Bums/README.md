# Beach Bums

A static first version of a beach-conditions website. Beach Bums searches by town, ZIP code, or beach name, then aggregates:

- Current outdoor temperature and wind from the National Weather Service API.
- Current water temperature from the nearest NOAA CO-OPS water-temperature station.
- Today's high and low tide predictions from the nearest NOAA CO-OPS tide station.
- Active NWS alerts related to beach, surf, rip current, marine, coastal, wind, wave, and flood conditions.
- Optional Google Maps and Google Places search when a browser API key is configured.
- Typeahead search suggestions for cities, ZIP-oriented places, and beaches while typing.

## Run Locally

Because the app uses browser `fetch` calls, serve it from a local web server:

```bash
node build-config.mjs
python3 -m http.server 4174
```

Then open:

```text
http://127.0.0.1:4174
```

You can also paste a Google Maps key into the settings gear for local testing.

## Deploy To Netlify

1. Push or upload this folder to a Netlify site.
2. In Netlify, open **Site configuration > Environment variables**.
3. Add:

```text
GOOGLE_MAPS_API_KEY=your Google Maps browser key
```

4. Deploy the site.
5. In Google Cloud, restrict the key to the Netlify domain, for example:

```text
https://your-site-name.netlify.app/*
```

For local testing, also keep:

```text
http://127.0.0.1:4174/*
http://localhost:4174/*
```

## Google Maps Setup

The app works without Google Maps by using a plain search fallback and a coordinate preview. To enable Google Maps:

1. Create a browser API key in Google Cloud.
2. Enable Maps JavaScript API, Places API, and Geocoding API.
3. Restrict the key to your site domain for production.
4. Add the key to Netlify as `GOOGLE_MAPS_API_KEY`, or open the app settings button and paste the key for local testing.

Keys pasted into settings are stored in browser local storage only.

When Google Maps is configured, search suggestions use Google Places predictions. Without a key, suggestions fall back to the public geocoder used by the prototype.

## Data Sources

- NOAA CO-OPS Data API: `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter`
- NOAA CO-OPS Metadata API: `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json`
- National Weather Service API: `https://api.weather.gov`
- Fallback geocoding: OpenStreetMap Nominatim

For production, move third-party requests behind a small backend so you can cache station lists, protect provider keys, add rate limiting, and normalize error handling.
