import mongoose from "mongoose";

const globalMongooseKey = "__insightaMongooseConnection__";

export function getDatabaseConfig() {
  return {
    connectionString: process.env.DATABASE_URL || process.env.DB_URI || "",
    databaseName: process.env.DATABASE_NAME || "",
  };
}

export function isDatabaseConfigured() {
  return Boolean(getDatabaseConfig().connectionString);
}

export async function connectDatabase() {
  const { connectionString, databaseName } = getDatabaseConfig();

  if (!connectionString) {
    return null;
  }

  if (!globalThis[globalMongooseKey]) {
    globalThis[globalMongooseKey] = mongoose
      .connect(connectionString, {
        dbName: databaseName || undefined,
      })
      .then((connection) => {
        console.log(`Connected to MongoDB successfully. Database: ${connection.connection.name}`);
        return connection;
      });
  }

  return globalThis[globalMongooseKey];
}

export { mongoose };
