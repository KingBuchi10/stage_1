import "dotenv/config";
import app from "./api/index.js";
import { getProfileStore } from "./lib/profile-store.js";

const port = process.env.PORT || 3000;

async function startServer() {
  await getProfileStore();

  app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });
}

startServer();
