import "dotenv/config";
import { getProfileStore } from "../lib/profile-store.js";
import { resolveSeedSource, seedProfiles } from "../lib/profile-seed.js";

async function run() {
  const source = resolveSeedSource(process.argv[2]);
  const store = await getProfileStore();
  const result = await seedProfiles({ store, source, strict: false });

  console.log(
    JSON.stringify(
      {
        status: "success",
        source,
        inserted: result.inserted,
        updated: result.updated,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "error",
        message: error.message,
      },
      null,
      2
    )
  );

  process.exitCode = 1;
});
