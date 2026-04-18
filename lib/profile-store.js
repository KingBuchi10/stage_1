import mongoose from "mongoose";

const globalStoreKey = "__stage0ProfileStore__";
const globalMongooseKey = "__stage0MongooseConnection__";
const globalProfileModelKey = "__stage0ProfileModel__";

function getProfileModel() {
  if (!globalThis[globalProfileModelKey]) {
    const collectionName = process.env.DATABASE_COLLECTION || "profiles";

    const profileSchema = new mongoose.Schema(
      {
        id: {
          type: String,
          required: true,
          unique: true,
          index: true,
          trim: true,
        },
        name: {
          type: String,
          required: true,
          unique: true,
          index: true,
          lowercase: true,
          trim: true,
        },
        gender: {
          type: String,
          required: true,
          lowercase: true,
          trim: true,
        },
        gender_probability: {
          type: Number,
          required: true,
        },
        sample_size: {
          type: Number,
          required: true,
        },
        age: {
          type: Number,
          required: true,
        },
        age_group: {
          type: String,
          required: true,
          lowercase: true,
          trim: true,
          enum: ["child", "teenager", "adult", "senior"],
        },
        country_id: {
          type: String,
          required: true,
          uppercase: true,
          trim: true,
          index: true,
        },
        country_probability: {
          type: Number,
          required: true,
        },
        created_at: {
          type: String,
          required: true,
        },
      },
      {
        collection: collectionName,
        versionKey: false,
      }
    );

    profileSchema.index({ gender: 1, country_id: 1, age_group: 1 });

    globalThis[globalProfileModelKey] =
      mongoose.models.Profile || mongoose.model("Profile", profileSchema);
  }

  return globalThis[globalProfileModelKey];
}

function normalizeFilters(filters = {}) {
  return {
    gender: typeof filters.gender === "string" ? filters.gender.toLowerCase() : null,
    country_id:
      typeof filters.country_id === "string"
        ? filters.country_id.toUpperCase()
        : null,
    age_group:
      typeof filters.age_group === "string"
        ? filters.age_group.toLowerCase()
        : null,
  };
}

class MemoryProfileStore {
  constructor() {
    this.profilesById = new Map();
    this.profileIdsByName = new Map();
  }

  async findById(id) {
    return this.profilesById.get(id) ?? null;
  }

  async findByName(name) {
    const id = this.profileIdsByName.get(name.toLowerCase());
    if (!id) {
      return null;
    }

    return this.findById(id);
  }

  async list(filters = {}) {
    const profiles = Array.from(this.profilesById.values());
    const normalizedFilters = normalizeFilters(filters);

    return profiles.filter((profile) => {
      if (
        normalizedFilters.gender &&
        profile.gender.toLowerCase() !== normalizedFilters.gender
      ) {
        return false;
      }

      if (
        normalizedFilters.country_id &&
        profile.country_id.toUpperCase() !== normalizedFilters.country_id
      ) {
        return false;
      }

      if (
        normalizedFilters.age_group &&
        profile.age_group.toLowerCase() !== normalizedFilters.age_group
      ) {
        return false;
      }

      return true;
    });
  }

  async create(profile) {
    this.profilesById.set(profile.id, profile);
    this.profileIdsByName.set(profile.name.toLowerCase(), profile.id);
    return profile;
  }

  async delete(id) {
    const profile = this.profilesById.get(id);

    if (!profile) {
      return false;
    }

    this.profilesById.delete(id);
    this.profileIdsByName.delete(profile.name.toLowerCase());
    return true;
  }
}

class MongooseProfileStore {
  async findById(id) {
    const ProfileModel = getProfileModel();
    return ProfileModel.findOne({ id }).lean().select("-_id");
  }

  async findByName(name) {
    const ProfileModel = getProfileModel();
    return ProfileModel.findOne({ name: name.toLowerCase() }).lean().select("-_id");
  }

  async list(filters = {}) {
    const ProfileModel = getProfileModel();
    const normalizedFilters = normalizeFilters(filters);
    const query = {};

    if (normalizedFilters.gender) {
      query.gender = normalizedFilters.gender;
    }

    if (normalizedFilters.country_id) {
      query.country_id = normalizedFilters.country_id;
    }

    if (normalizedFilters.age_group) {
      query.age_group = normalizedFilters.age_group;
    }

    return ProfileModel.find(query).sort({ created_at: 1 }).lean().select("-_id");
  }

  async create(profile) {
    const ProfileModel = getProfileModel();
    const document = await ProfileModel.create(profile);
    const createdProfile = document.toObject({ versionKey: false });
    delete createdProfile._id;
    return createdProfile;
  }

  async delete(id) {
    const ProfileModel = getProfileModel();
    const result = await ProfileModel.deleteOne({ id });
    return result.deletedCount > 0;
  }
}

async function connectMongoose(connectionString) {
  if (!globalThis[globalMongooseKey]) {
    globalThis[globalMongooseKey] = mongoose
      .connect(connectionString, {
        dbName: process.env.DATABASE_NAME,
      })
      .then((connection) => {
        const databaseName = connection.connection.name;
        const collectionName = getProfileModel().collection.collectionName;

        console.log(
          `Connected to MongoDB with Mongoose successfully. Database: ${databaseName}, Collection: ${collectionName}`
        );

        return connection;
      });
  }

  return globalThis[globalMongooseKey];
}

async function createProfileStore() {
  const connectionString = process.env.DATABASE_URL || process.env.DB_URI;

  if (!connectionString) {
    console.log("DATABASE_URL/DB_URI not found. Using in-memory profile store.");
    return new MemoryProfileStore();
  }

  try {
    await connectMongoose(connectionString);
    await getProfileModel().init();
    return new MongooseProfileStore();
  } catch (error) {
    console.error(
      "MongoDB connection failed. Falling back to in-memory profile store.",
      error
    );
    return new MemoryProfileStore();
  }
}

export function getProfileStore() {
  if (!globalThis[globalStoreKey]) {
    globalThis[globalStoreKey] = createProfileStore();
  }

  return globalThis[globalStoreKey];
}
