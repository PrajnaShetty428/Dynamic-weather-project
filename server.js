const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT) || 3000;
const weatherApiKey = process.env.WEATHER_API_KEY;
const publicFiles = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/style.css": ["style.css", "text/css; charset=utf-8"],
    "/script.js": ["script.js", "text/javascript; charset=utf-8"],
    "/data/india-index.json.gz": ["data/india-index.json.gz", "application/gzip"]
};

function sendJson(response, status, data) {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
}

function weatherErrorMessage(code, status) {
    if (code === 1006) return "WeatherAPI could not find weather for this place. Try another locality.";
    if (code === 2006 || code === 2008) return "The weather service key is invalid or disabled. Check WEATHER_API_KEY.";
    if (code === 2007 || status === 429) return "The weather service usage limit has been reached. Try again later.";
    return "The weather service could not return current conditions. Please try again later.";
}

function openMeteoCondition(code, isDay) {
    const descriptions = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        56: "Light freezing drizzle",
        57: "Dense freezing drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        66: "Light freezing rain",
        67: "Heavy freezing rain",
        71: "Slight snowfall",
        73: "Moderate snowfall",
        75: "Heavy snowfall",
        77: "Snow grains",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        85: "Slight snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail"
    };
    let symbol = "\u2601";

    if (code === 0) symbol = isDay ? "\u2600" : "\u263d";
    else if (code <= 3) symbol = "\u26c5";
    else if (code === 45 || code === 48) symbol = "\u2592";
    else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) symbol = "\u2614";
    else if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) symbol = "\u2744";
    else if (code >= 95) symbol = "\u26c8";

    return { text: descriptions[code] || "Current conditions", symbol };
}

async function getOpenMeteoWeather(response, latitude, longitude) {
    const apiUrl = new URL("https://api.open-meteo.com/v1/forecast");
    apiUrl.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        timezone: "auto"
    });

    try {
        const upstream = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
        const data = await upstream.json();
        const current = data.current;
        if (!upstream.ok || !current || !Number.isFinite(current.temperature_2m)) {
            sendJson(response, 502, { error: "Open-Meteo could not return current weather for this location. Please try again later." });
            return;
        }

        sendJson(response, 200, {
            provider: "Open-Meteo",
            current: {
                temp_c: current.temperature_2m,
                feelslike_c: current.apparent_temperature,
                humidity: current.relative_humidity_2m,
                wind_kph: current.wind_speed_10m,
                condition: openMeteoCondition(current.weather_code, current.is_day === 1)
            }
        });
    } catch {
        sendJson(response, 502, { error: "Could not connect to Open-Meteo. Check your connection and try again." });
    }
}

async function getWeather(response, requestUrl) {
    const query = requestUrl.searchParams.get("q") || "";
    const [latitude, longitude] = query.split(",").map(Number);
    if (query.length > 80 || !Number.isFinite(latitude) || !Number.isFinite(longitude)
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
        sendJson(response, 400, { error: "The selected place does not have valid coordinates. Choose it again." });
        return;
    }

    if (!weatherApiKey) {
        await getOpenMeteoWeather(response, latitude, longitude);
        return;
    }

    const apiUrl = new URL("https://api.weatherapi.com/v1/current.json");
    apiUrl.search = new URLSearchParams({
        key: weatherApiKey,
        q: `${latitude},${longitude}`,
        aqi: "yes"
    });

    try {
        const upstream = await fetch(apiUrl, { signal: AbortSignal.timeout(12000) });
        const data = await upstream.json();
        if (!upstream.ok || data.error) {
            const code = data.error?.code;
            const responseStatus = code === 1006 ? 404 : code === 2007 || upstream.status === 429 ? 429 : 502;
            sendJson(response, responseStatus, { error: weatherErrorMessage(code, upstream.status) });
            return;
        }
        sendJson(response, 200, data);
    } catch {
        sendJson(response, 502, { error: "Could not connect to WeatherAPI. Check the server connection and try again." });
    }
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (request.method !== "GET") {
        sendJson(response, 405, { error: "Only GET requests are supported." });
        return;
    }

    if (requestUrl.pathname === "/api/weather") {
        await getWeather(response, requestUrl);
        return;
    }

    const stateShard = requestUrl.pathname.match(/^\/data\/india\/(\d{2})\.json\.gz$/);
    const file = stateShard
        ? [`data/india/${stateShard[1]}.json.gz`, "application/gzip"]
        : publicFiles[requestUrl.pathname];
    if (!file) {
        sendJson(response, 404, { error: "Not found." });
        return;
    }

    fs.readFile(path.join(__dirname, file[0]), (error, content) => {
        if (error) {
            sendJson(response, 500, { error: "The application file could not be read." });
            return;
        }
        const headers = { "Content-Type": file[1], "X-Content-Type-Options": "nosniff" };
        if (file[2]) headers["Content-Encoding"] = file[2];
        response.writeHead(200, headers);
        response.end(content);
    });
});

const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
    console.log(`Dynamic Weather App running at http://localhost:${port}`);
});