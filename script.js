const LOCATION_DATA_URL = "data/india-index.json.gz";
const locationInputs = {
    country: document.getElementById("countryInput"),
    state: document.getElementById("stateInput"),
    district: document.getElementById("districtInput"),
    city: document.getElementById("cityInput")
};
const locationStatus = document.getElementById("locationStatus");
const weatherStatus = document.getElementById("weatherStatus");
const weatherPanel = document.getElementById("weatherPanel");
const weatherButton = document.getElementById("weatherButton");
const selections = { country: null, state: null, district: null, city: null };
const optionLists = {
    country: [],
    state: [],
    district: [],
    city: []
};
let weatherIsLoading = false;
let locationData = null;
const placeDataByState = new Map();

function normalized(value) {
    return value.trim().toLocaleLowerCase();
}

function setStatus(element, message) {
    element.textContent = message;
}

function updateWeatherButton() {
    weatherButton.disabled = weatherIsLoading || !(
        selections.country && selections.state && selections.district && selections.city
    );
}

function clearSelection(level) {
    const levels = ["country", "state", "district", "city"];
    const start = levels.indexOf(level);

    for (const currentLevel of levels.slice(start)) {
        selections[currentLevel] = null;
        optionLists[currentLevel] = [];
        locationInputs[currentLevel].value = "";
        locationInputs[currentLevel].disabled = currentLevel !== "country";
        document.getElementById(`${currentLevel}Options`).replaceChildren();
    }

    const nextLevel = levels[start + 1];
    if (nextLevel) {
        const labels = {
            state: "Choose a country first",
            district: "Choose a state first",
            city: "Choose a district first"
        };
        locationInputs[nextLevel].placeholder = labels[nextLevel];
    }
    updateWeatherButton();
}

function setOptions(level, items) {
    optionLists[level] = items;
    const datalist = document.getElementById(`${level}Options`);
    datalist.replaceChildren(...items.map((item) => {
        const option = document.createElement("option");
        option.value = item.label;
        return option;
    }));
}

function matchOption(level) {
    const value = normalized(locationInputs[level].value);
    return optionLists[level].find((item) => normalized(item.label) === value
        || item.aliases?.some((alias) => normalized(alias) === value)) || null;
}

function optionId(option) {
    return option?.id ?? option?.geonameId ?? option?.code;
}

function makeOptions(items, getName = (item) => item.name) {
    const counts = new Map();
    for (const item of items) {
        const name = getName(item);
        counts.set(name, (counts.get(name) || 0) + 1);
    }

    return items.map((item) => {
        const name = getName(item);
        let label = name;
        if (counts.get(name) > 1) {
            const qualifier = item.parentName || item.districtName || item.stateName || item.id;
            label = `${name} - ${qualifier}`;
        }
        return { ...item, name, label };
    });
}

async function loadLocationData() {
    setStatus(locationStatus, "Loading local location data...");
    try {
        locationData = await loadCompressedJson(LOCATION_DATA_URL);
        if (!locationData.countries?.length || !locationData.states?.length || !locationData.districts?.length) {
            throw new Error("The local location dataset is incomplete. Rebuild it using the README instructions.");
        }
        setOptions("country", makeOptions(locationData.countries));
        setStatus(locationStatus, "Search and choose a country to begin.");
    } catch (error) {
        setStatus(locationStatus, error.message || "Could not load local location data.");
    }
}

async function loadCompressedJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error("Local location data is missing. Rebuild the dataset using the README instructions.");
    }

    if (response.headers.get("content-encoding")?.includes("gzip")) {
        return response.json();
    }

    if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot open the compressed location data. Update to a recent browser version.");
    }

    const decompressed = response.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(decompressed).json();
}

function loadStates(country) {
    clearSelection("state");
    if (country.code !== "IN") {
        setStatus(locationStatus, "Local state, district, and city data is currently available for India.");
        return;
    }

    locationInputs.state.disabled = false;
    locationInputs.state.placeholder = "Search states / regions";
    const states = locationData.states.map((state) => ({ ...state, id: state.code }));
    setOptions("state", makeOptions(states));
    setStatus(locationStatus, "Choose a state or union territory.");
}

function loadDistricts(state) {
    clearSelection("district");
    locationInputs.district.disabled = false;
    locationInputs.district.placeholder = "Search districts";
    const districts = locationData.districts
        .filter((district) => district.stateCode === state.code)
        .map((district) => ({ ...district, id: `${district.stateCode}.${district.code}`, stateName: state.name }));
    setOptions("district", makeOptions(districts));
    setStatus(locationStatus, districts.length ? "Choose a district." : "No district data is available for this state or region.");
}

async function loadCities(district) {
    clearSelection("city");
    locationInputs.city.disabled = false;
    locationInputs.city.placeholder = "Search cities / localities";
    setStatus(locationStatus, "Loading cities and localities...");

    try {
        const stateCode = district.stateCode;
        let statePlaces = placeDataByState.get(stateCode);
        if (!statePlaces) {
            statePlaces = await loadCompressedJson(`data/india/${encodeURIComponent(stateCode)}.json.gz`);
            placeDataByState.set(stateCode, statePlaces);
        }

        if (selections.district?.stateCode !== stateCode || selections.district?.code !== district.code) return;
        const cities = statePlaces.places
            .filter((place) => place[0] === district.code)
            .map((place) => ({
                id: place[4],
                name: place[1],
                lat: place[2],
                lng: place[3],
                districtName: district.name
            }))
            .sort((first, second) => first.name.localeCompare(second.name));
        setOptions("city", makeOptions(cities));
        setStatus(locationStatus, cities.length ? "Choose a city or locality." : "No populated places were found for this district.");
    } catch (error) {
        setStatus(locationStatus, error.message || "Could not load local city data.");
    }
}

function onLocationInput(level, nextLevel, loadNext) {
    locationInputs[level].addEventListener("input", () => {
        const match = matchOption(level);
        if (!match) {
            selections[level] = null;
            clearSelection(nextLevel);
            setStatus(locationStatus, "Choose an option from the suggestions to continue.");
            return;
        }

        if (optionId(selections[level]) === optionId(match)) {
            return;
        }

        selections[level] = match;
        clearSelection(nextLevel);
        loadNext(match);
    });
}

onLocationInput("country", "state", loadStates);
onLocationInput("state", "district", loadDistricts);
onLocationInput("district", "city", loadCities);
locationInputs.city.addEventListener("input", () => {
    const match = matchOption("city");
    selections.city = match;
    if (!match && locationInputs.city.value) {
        setStatus(locationStatus, "Choose a city or locality from the suggestions.");
    }
    updateWeatherButton();
});

function addDetail(list, label, value) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    wrapper.append(term, description);
    list.append(wrapper);
}

function openMeteoCondition(code, isDay) {
    const descriptions = {
        0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
        45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
        55: "Dense drizzle", 56: "Light freezing drizzle", 57: "Dense freezing drizzle",
        61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain", 66: "Light freezing rain",
        67: "Heavy freezing rain", 71: "Slight snowfall", 73: "Moderate snowfall",
        75: "Heavy snowfall", 77: "Snow grains", 80: "Slight rain showers",
        81: "Moderate rain showers", 82: "Violent rain showers", 85: "Slight snow showers",
        86: "Heavy snow showers", 95: "Thunderstorm", 96: "Thunderstorm with slight hail",
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

async function getOpenMeteoWeather(latitude, longitude) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m",
        temperature_unit: "celsius",
        wind_speed_unit: "kmh",
        timezone: "auto"
    });

    const response = await fetch(url);
    const data = await response.json();
    const current = data.current;
    if (!response.ok || !current || !Number.isFinite(current.temperature_2m)) {
        throw new Error("Could not retrieve current weather. Please try again later.");
    }

    return {
        current: {
            temp_c: current.temperature_2m,
            feelslike_c: current.apparent_temperature,
            humidity: current.relative_humidity_2m,
            wind_kph: current.wind_speed_10m,
            condition: openMeteoCondition(current.weather_code, current.is_day === 1)
        }
    };
}

async function getWeather(latitude, longitude) {
    const query = new URLSearchParams({ q: `${latitude},${longitude}` });

    try {
        const response = await fetch(`api/weather?${query}`);
        if (response.ok) {
            const data = await response.json();
            if (data.current?.condition) return data;
        } else if (response.status !== 404) {
            const data = await response.json().catch(() => ({}));
            if (data.error) throw new Error(data.error);
        }
    } catch (error) {
        if (!(error instanceof TypeError) && !(error instanceof SyntaxError)) throw error;
    }

    return getOpenMeteoWeather(latitude, longitude);
}

function showWeather(data) {
    weatherPanel.replaceChildren();

    const location = data.location || {
        name: selections.city?.name,
        region: selections.district?.name,
        country: [selections.state?.name, selections.country?.name].filter(Boolean).join(", ")
    };
    const heading = document.createElement("p");
    heading.className = "weather-heading";
    heading.textContent = [location.name, location.region, location.country].filter(Boolean).join(", ");

    const main = document.createElement("div");
    main.className = "weather-main";
    let icon;
    if (data.current.condition.icon) {
        icon = document.createElement("img");
        icon.className = "weather-icon";
        icon.alt = data.current.condition.text;
        icon.src = data.current.condition.icon.startsWith("//")
            ? `https:${data.current.condition.icon}`
            : data.current.condition.icon;
    } else {
        icon = document.createElement("span");
        icon.className = "weather-icon weather-symbol";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = data.current.condition.symbol || "\u2601";
    }
    const summary = document.createElement("div");
    const temperature = document.createElement("p");
    temperature.className = "temperature";
    temperature.textContent = `${data.current.temp_c}°C`;
    const condition = document.createElement("p");
    condition.className = "condition";
    condition.textContent = data.current.condition.text;
    summary.append(temperature, condition);
    main.append(icon, summary);

    const details = document.createElement("dl");
    details.className = "weather-details";
    addDetail(details, "Feels like", `${data.current.feelslike_c}°C`);
    addDetail(details, "Humidity", `${data.current.humidity}%`);
    addDetail(details, "Wind", `${data.current.wind_kph} kph`);

    weatherPanel.append(heading, main, details);
}

document.getElementById("locationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    weatherPanel.replaceChildren();
    setStatus(weatherStatus, "");

    if (!selections.country || !selections.state || !selections.district || !selections.city) {
        setStatus(weatherStatus, "Choose a country, state, district, and city or locality first.");
        return;
    }

    const latitude = Number(selections.city.lat);
    const longitude = Number(selections.city.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        setStatus(weatherStatus, "Coordinates are missing for this place. Choose another location.");
        return;
    }

    weatherIsLoading = true;
    updateWeatherButton();
    setStatus(weatherStatus, "Getting current weather...");

    try {
        const result = await getWeather(latitude, longitude);
        showWeather(result);
        setStatus(weatherStatus, "");
    } catch (error) {
        setStatus(weatherStatus, error.name === "TypeError"
            ? "Could not reach the weather service. Check your connection and try again."
            : error.message);
    } finally {
        weatherIsLoading = false;
        updateWeatherButton();
    }
});

loadLocationData();