- Fetch current conditions from WeatherAPI when configured, with a free Open-Meteo fallback when no key is available.
2. No weather key is required for local use: Open-Meteo is used automatically when `WEATHER_API_KEY` is unset. To prefer WeatherAPI, set a key in the server environment; do not put it in `script.js`.
The app uses a compressed JSON dataset generated from GeoNames' daily `IN.zip` and `countryInfo.txt` extracts. All countries are listed, while local state, district, and populated-place records currently cover India. GeoNames alternate place spellings are retained as selectable suggestions and resolve to the same place ID and coordinates. Country/state/district data loads from a small index; only the selected state's place records are fetched from its compressed shard. The selected place's coordinates are sent to the server for weather lookup, avoiding ambiguity between places with the same name.
When set, the WeatherAPI key is read by `server.js` and is never sent to the browser. The original page's key was exposed to every visitor; revoke it and use a fresh key in the environment if you choose WeatherAPI. Without a key, the server uses Open-Meteo's free non-commercial forecast endpoint and displays its WMO condition code as a symbol. Follow Open-Meteo's current usage and attribution terms.
# Dynamic Weather App

A responsive, plain HTML/CSS/JavaScript weather app with dependent country, state, district, and city/locality search.

## Features

- Search locations from country through populated place, with each level dependent on the previous selection.
- Load location data from a compressed local GeoNames dataset; no location API account is needed at runtime.
- Fetch current temperature, condition, icon, feels-like temperature, humidity, and wind from WeatherAPI.
- Keep the WeatherAPI key on the local Node server rather than in browser JavaScript.
- Provide loading, missing-data, network, invalid-location, and API-limit messages.
- Adapt the form and weather summary to desktop and mobile screens.

## Project Structure

```text
index.html    Page structure
style.css     Responsive interface
script.js     Location search and weather display
server.js     Static server and private WeatherAPI proxy
data/         Compressed local location data
scripts/      Dataset builder
README.md
```

## Setup

1. Install Node.js 18 or later.
2. Create or use a WeatherAPI account and set its key in the server environment. Do not put the WeatherAPI key in `script.js`.

Start the app without a key to use Open-Meteo:

```powershell
node server.js
```

To use WeatherAPI instead, set its key before starting the server:

```powershell
$env:WEATHER_API_KEY = "your-weatherapi-key"
node server.js
```

Open http://localhost:3000. The app also works on static hosts such as GitHub Pages: location files use relative paths and are decompressed in the browser, while weather falls back to Open-Meteo if the host has no `/api/weather` route. In static hosting, Open-Meteo is used directly even if a server-side WeatherAPI key exists elsewhere. The Node server binds to localhost by default; for a hosted Node deployment, set `HOST=0.0.0.0` and protect the proxy with deployment-appropriate access and rate limits.

## Location Data

The app uses a compressed JSON dataset generated from GeoNames' daily `IN.zip` and `countryInfo.txt` extracts. All countries are listed, while local state, district, and populated-place records currently cover India. Country/state/district data loads from a small index; only the selected state's populated places are fetched from its compressed shard. The selected place's coordinates are sent to the server and used as WeatherAPI's `q` value, avoiding ambiguity between places with the same name.

The dataset is compressed to keep downloads small and is served with HTTP gzip encoding. Some source places have no district code; the builder first matches a same-named district, then assigns the place to its nearest GeoNames district centroid only when it is within 100 km. The source is provided as-is, and locality/district coverage may be incomplete. GeoNames data is licensed under CC BY 4.0; attribution is shown in the app. Refresh the dataset periodically because it is a snapshot.

To rebuild the dataset, download and extract `IN.zip` from `https://download.geonames.org/export/dump/`, download `countryInfo.txt` from the same directory, then run:

```powershell
node scripts/build-india-data.js "C:\path\to\IN.txt" "C:\path\to\countryInfo.txt"
```

WeatherAPI is called by `server.js`; its key is read from `WEATHER_API_KEY` and is never sent to the browser. The key previously embedded in the original page was exposed to every visitor. Replace/revoke that key in WeatherAPI and use a fresh one in the environment.

## Git

```powershell
git add index.html style.css script.js server.js README.md scripts data
git commit -m "Add hierarchical location search"
```

## Author

Prajna Shetty

GitHub: https://github.com/PrajnaShetty428
