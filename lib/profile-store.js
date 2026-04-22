import mongoose from "mongoose";

const globalStoreKey = "__stage0ProfileStore__";
const globalMongooseKey = "__stage0MongooseConnection__";
const globalProfileModelKey = "__stage0ProfileModel__";

function buildMongoQuery(filters = {}) {
  const query = {};

  if (filters.gender) {
    query.gender = filters.gender;
  }

  if (filters.age_group) {
    query.age_group = filters.age_group;
  }

  if (filters.country_id) {
    query.country_id = filters.country_id;
  }

  if (filters.min_age !== undefined || filters.max_age !== undefined) {
    query.age = {};

    if (filters.min_age !== undefined) {
      query.age.$gte = filters.min_age;
    }

    if (filters.max_age !== undefined) {
      query.age.$lte = filters.max_age;
    }
  }

  if (filters.min_gender_probability !== undefined) {
    query.gender_probability = { $gte: filters.min_gender_probability };
  }

  if (filters.min_country_probability !== undefined) {
    query.country_probability = { $gte: filters.min_country_probability };
  }

  return query;
}

function getSort(sortBy, order) {
  return {
    [sortBy]: order === "asc" ? 1 : -1,
    id: 1,
  };
}

function applyMemoryFilters(profile, filters) {
  if (filters.gender && profile.gender !== filters.gender) {
    return false;
  }

  if (filters.age_group && profile.age_group !== filters.age_group) {
    return false;
  }

  if (filters.country_id && profile.country_id !== filters.country_id) {
    return false;
  }

  if (filters.min_age !== undefined && profile.age < filters.min_age) {
    return false;
  }

  if (filters.max_age !== undefined && profile.age > filters.max_age) {
    return false;
  }

  if (
    filters.min_gender_probability !== undefined &&
    profile.gender_probability < filters.min_gender_probability
  ) {
    return false;
  }

  if (
    filters.min_country_probability !== undefined &&
    profile.country_probability < filters.min_country_probability
  ) {
    return false;
  }

  return true;
}

function compareProfiles(left, right, sortBy, order) {
  const direction = order === "asc" ? 1 : -1;
  const leftValue = sortBy === "created_at" ? new Date(left.created_at).getTime() : left[sortBy];
  const rightValue =
    sortBy === "created_at" ? new Date(right.created_at).getTime() : right[sortBy];

  if (leftValue < rightValue) {
    return -1 * direction;
  }

  if (leftValue > rightValue) {
    return 1 * direction;
  }

  return left.id.localeCompare(right.id);
}

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
          enum: ["male", "female"],
          index: true,
        },
        gender_probability: {
          type: Number,
          required: true,
          index: true,
        },
        age: {
          type: Number,
          required: true,
          index: true,
        },
        age_group: {
          type: String,
          required: true,
          lowercase: true,
          trim: true,
          enum: ["child", "teenager", "adult", "senior"],
          index: true,
        },
        country_id: {
          type: String,
          required: true,
          uppercase: true,
          trim: true,
          index: true,
        },
        country_name: {
          type: String,
          required: true,
          trim: true,
        },
        country_probability: {
          type: Number,
          required: true,
          index: true,
        },
        created_at: {
          type: Date,
          required: true,
          default: Date.now,
          index: true,
        },
      },
      {
        collection: collectionName,
        versionKey: false,
      }
    );

    profileSchema.index({ gender: 1, age_group: 1, country_id: 1, age: 1 });
    profileSchema.index({ country_id: 1, age: 1 });
    profileSchema.index({ created_at: 1, id: 1 });
    profileSchema.index({ gender_probability: 1, id: 1 });

    globalThis[globalProfileModelKey] =
      mongoose.models.Profile || mongoose.model("Profile", profileSchema);
  }

  return globalThis[globalProfileModelKey];
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

  async list({ filters = {}, sortBy = "created_at", order = "asc", page = 1, limit = 10 } = {}) {
    const allProfiles = Array.from(this.profilesById.values()).filter((profile) =>
      applyMemoryFilters(profile, filters)
    );
    const sortedProfiles = allProfiles.sort((left, right) =>
      compareProfiles(left, right, sortBy, order)
    );
    const startIndex = (page - 1) * limit;

    return {
      total: sortedProfiles.length,
      data: sortedProfiles.slice(startIndex, startIndex + limit),
    };
  }

  async create(profile) {
    this.profilesById.set(profile.id, profile);
    this.profileIdsByName.set(profile.name.toLowerCase(), profile.id);
    return profile;
  }

  async upsertMany(profiles) {
    let inserted = 0;
    let updated = 0;

    for (const profile of profiles) {
      const existingId = this.profileIdsByName.get(profile.name.toLowerCase());

      if (existingId) {
        const existingProfile = this.profilesById.get(existingId);
        this.profilesById.set(existingId, { ...existingProfile, ...profile, id: existingId });
        updated += 1;
        continue;
      }

      this.profilesById.set(profile.id, profile);
      this.profileIdsByName.set(profile.name.toLowerCase(), profile.id);
      inserted += 1;
    }

    return { inserted, updated };
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

  async list({ filters = {}, sortBy = "created_at", order = "asc", page = 1, limit = 10 } = {}) {
    const ProfileModel = getProfileModel();
    const query = buildMongoQuery(filters);
    const skip = (page - 1) * limit;

    const [total, data] = await Promise.all([
      ProfileModel.countDocuments(query),
      ProfileModel.find(query)
        .sort(getSort(sortBy, order))
        .skip(skip)
        .limit(limit)
        .lean()
        .select("-_id"),
    ]);

    return { total, data };
  }

  async create(profile) {
    const ProfileModel = getProfileModel();
    const document = await ProfileModel.create(profile);
    const createdProfile = document.toObject({ versionKey: false });
    delete createdProfile._id;
    return createdProfile;
  }

  async upsertMany(profiles) {
    if (profiles.length === 0) {
      return { inserted: 0, updated: 0 };
    }

    const ProfileModel = getProfileModel();
    const existingNames = new Set(
      (
        await ProfileModel.find({ name: { $in: profiles.map((profile) => profile.name) } })
          .lean()
          .select({ name: 1, _id: 0 })
      ).map((profile) => profile.name)
    );

    const operations = profiles.map((profile) => {
      const { id, ...updatableFields } = profile;

      return {
      updateOne: {
        filter: { name: profile.name },
        update: { $set: updatableFields, $setOnInsert: { id } },
        upsert: true,
      },
      };
    });

    await ProfileModel.bulkWrite(operations, { ordered: false });

    let inserted = 0;
    let updated = 0;

    for (const profile of profiles) {
      if (existingNames.has(profile.name)) {
        updated += 1;
      } else {
        inserted += 1;
      }
    }

    return { inserted, updated };
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
