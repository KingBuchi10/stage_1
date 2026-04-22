import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import app from "./api/index.js";
import { getProfileStore } from "./lib/profile-store.js";
import { resolveSeedSource, seedProfiles } from "./lib/profile-seed.js";

const port = process.env.PORT || 3000;

async function seedIfConfigured(profileStore) {
  const source = resolveSeedSource();
  const isRemoteSource = /^https?:\/\//i.test(source);
  const shouldSeed =
    process.env.AUTO_SEED_PROFILES === "true" ||
    (!isRemoteSource &&
      fs.existsSync(path.isAbsolute(source) ? source : path.resolve(process.cwd(), source)));

  if (!shouldSeed) {
    return;
  }

  try {
    const result = await seedProfiles({ store: profileStore, source, strict: false });
    console.log(`Seed complete. Inserted: ${result.inserted}, Updated: ${result.updated}`);
  } catch (error) {
    console.error(`Seed skipped: ${error.message}`);
  }
}

async function startServer() {
  const profileStore = await getProfileStore();
  await seedIfConfigured(profileStore);

  app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });
}

startServer();
