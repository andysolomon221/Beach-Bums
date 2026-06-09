import { writeFileSync } from "node:fs";

const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY || "";
const config = {
  googleMapsKey,
};

writeFileSync(
  "config.js",
  `window.BEACH_BUMS_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
);
