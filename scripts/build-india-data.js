const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createGzip } = require("node:zlib");
const { pipeline } = require("node:stream/promises");

const [indiaFile, countryInfoFile] = process.argv.slice(2);
if (!indiaFile || !countryInfoFile) {
    console.error("Usage: node scripts/build-india-data.js <IN.txt> <countryInfo.txt>");
    process.exit(1);
}

const dataDirectory = path.resolve(__dirname, "..", "data");
const placeCodes = new Set([
    "PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLA5", "PPLC",
    "PPLF", "PPLG", "PPLL", "PPLR", "PPLS", "PPLX"
]);
const validCoordinate = (value, limit) => Number.isFinite(value) && Math.abs(value) <= limit;
const districtKey = (stateCode, districtCode) => `${stateCode}.${districtCode}`;
const alternateNames = (value) => [...new Set((value || "").split(",").map((name) => name.trim()).filter((name) => name && name.length <= 80))];
const normalizedName = (value) => value.trim().toLocaleLowerCase();
const displayAdminName = (value) => value.replace(/^(?:state|union territory|national capital territory) of\s+/i, "");

async function readLines(file) {
    const lines = readline.createInterface({
        input: fs.createReadStream(file, { encoding: "utf8" }),
        crlfDelay: Infinity
    });
    return lines;
}

async function writeChunk(gzip, value) {
    if (!gzip.write(value)) {
        await new Promise((resolve, reject) => {
            const onDrain = () => {
                gzip.off("error", onError);
                resolve();
            };
            const onError = (error) => {
                gzip.off("drain", onDrain);
                reject(error);
            };
            gzip.once("drain", onDrain);
            gzip.once("error", onError);
        });
    }
}

function distanceKm(first, second) {
    const radians = (degrees) => degrees * Math.PI / 180;
    const latitudeDelta = radians(second.latitude - first.latitude);
    const longitudeDelta = radians(second.longitude - first.longitude);
    const latitude1 = radians(first.latitude);
    const latitude2 = radians(second.latitude);
    const arc = 2 * Math.asin(Math.sqrt(
        Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
    ));
    return 6371 * arc;
}

async function main() {
    const countries = [];
    for await (const line of await readLines(countryInfoFile)) {
        if (!line || line.startsWith("#")) continue;
        const fields = line.split("\t");
        if (fields[0] && fields[4]) {
            countries.push({ code: fields[0], name: fields[4] });
        }
    }

    const statesByCode = new Map();
    const districtsByKey = new Map();
    for await (const line of await readLines(indiaFile)) {
        const fields = line.split("\t");
        const featureClass = fields[6];
        const featureCode = fields[7];
        const stateCode = fields[10];
        const districtCode = fields[11];
        const name = displayAdminName(fields[2] || fields[1]);

        if (featureClass !== "A" || !name) continue;
        if (featureCode === "ADM1" && stateCode) {
            statesByCode.set(stateCode, { code: stateCode, name, aliases: alternateNames(fields[3]) });
        } else if (featureCode === "ADM2" && stateCode && districtCode) {
            const latitude = Number(fields[4]);
            const longitude = Number(fields[5]);
            districtsByKey.set(districtKey(stateCode, districtCode), {
                stateCode,
                code: districtCode,
                name,
                aliases: alternateNames(fields[3]),
                latitude,
                longitude
            });
        }
    }

    const districtsByState = new Map();
    const districtByName = new Map();
    for (const district of districtsByKey.values()) {
        const stateDistricts = districtsByState.get(district.stateCode) || [];
        stateDistricts.push(district);
        districtsByState.set(district.stateCode, stateDistricts);
        for (const name of [district.name, ...district.aliases]) {
            const key = `${district.stateCode}.${normalizedName(name)}`;
            if (!districtByName.has(key)) districtByName.set(key, district);
        }
    }

    const states = [...statesByCode.values()].sort((first, second) => first.name.localeCompare(second.name));
    const districts = [...districtsByKey.values()].sort((first, second) => first.name.localeCompare(second.name));
    await fs.promises.mkdir(path.join(dataDirectory, "india"), { recursive: true });
    const indexFile = path.join(dataDirectory, "india-index.json.gz");
    const indexGzip = createGzip({ level: 9 });
    const indexComplete = pipeline(indexGzip, fs.createWriteStream(indexFile));
    await writeChunk(indexGzip, JSON.stringify({ countries, states, districts }));
    indexGzip.end();

    const placeWriters = new Map();
    for (const state of states) {
        const file = path.join(dataDirectory, "india", `${state.code}.json.gz`);
        const gzip = createGzip({ level: 9 });
        const complete = pipeline(gzip, fs.createWriteStream(file));
        const writer = { gzip, complete, firstPlace: true, count: 0 };
        placeWriters.set(state.code, writer);
        await writeChunk(gzip, "{\"places\":[");
    }

    let includedPlaces = 0;
    let inferredDistricts = 0;
    for await (const line of await readLines(indiaFile)) {
        const fields = line.split("\t");
        const stateCode = fields[10];
        if (fields[6] !== "P" || !placeCodes.has(fields[7]) || !statesByCode.has(stateCode)) continue;

        const latitude = Number(fields[4]);
        const longitude = Number(fields[5]);
        if (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) continue;

        let districtCode = fields[11];
        if (!districtsByKey.has(districtKey(stateCode, districtCode))) {
            const stateDistricts = districtsByState.get(stateCode) || [];
            const namedDistrict = districtByName.get(`${stateCode}.${normalizedName(fields[2] || fields[1] || "")}`)
                || districtByName.get(`${stateCode}.${normalizedName(fields[1] || "")}`);
            if (namedDistrict) {
                districtCode = namedDistrict.code;
            } else {
                let closest = null;
                for (const district of stateDistricts) {
                    if (!validCoordinate(district.latitude, 90) || !validCoordinate(district.longitude, 180)) continue;
                    const distance = distanceKm({ latitude, longitude }, district);
                    if (!closest || distance < closest.distance) closest = { district, distance };
                }
                if (!closest || closest.distance > 100) continue;
                districtCode = closest.district.code;
            }
            inferredDistricts++;
        }

        const name = fields[2] || fields[1];
        const writer = placeWriters.get(stateCode);
        if (!writer) continue;
        const place = [districtCode, name, latitude, longitude, Number(fields[0]), alternateNames(fields[3])];
        await writeChunk(writer.gzip, `${writer.firstPlace ? "" : ","}${JSON.stringify(place)}`);
        writer.firstPlace = false;
        writer.count++;
        includedPlaces++;
    }

    const outputs = [...placeWriters.values()].map(async (writer) => {
        await writeChunk(writer.gzip, "]}");
        writer.gzip.end();
        await writer.complete;
    });
    await Promise.all([indexComplete, ...outputs]);

    let totalBytes = (await fs.promises.stat(indexFile)).size;
    for (const state of states) {
        totalBytes += (await fs.promises.stat(path.join(dataDirectory, "india", `${state.code}.json.gz`))).size;
    }
    console.log(`Countries: ${countries.length}`);
    console.log(`India states and union territories: ${states.length}`);
    console.log(`India districts: ${districts.length}`);
    console.log(`Places: ${includedPlaces} (${inferredDistricts} assigned to their nearest district because the source record had no district code)`);
    console.log(`Wrote index and ${placeWriters.size} state shards (${(totalBytes / 1024 / 1024).toFixed(2)} MiB compressed total)`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});