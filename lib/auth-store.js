import { connectDatabase, isDatabaseConfigured, mongoose } from "./database.js";
import { uuidv7 } from "./profile-service.js";

const globalAuthStoreKey = "__insightaAuthStore__";
const globalAuthModelsKey = "__insightaAuthModels__";

function now() {
  return new Date();
}

function isExpired(record) {
  return !record?.expires_at || new Date(record.expires_at).getTime() <= Date.now();
}

function stripId(document) {
  if (!document) {
    return null;
  }

  const value = typeof document.toObject === "function" ? document.toObject({ versionKey: false }) : document;
  delete value._id;
  return value;
}

function getAuthModels() {
  if (!globalThis[globalAuthModelsKey]) {
    const collectionPrefix = process.env.DATABASE_COLLECTION_PREFIX || "insighta";

    const userSchema = new mongoose.Schema(
      {
        id: { type: String, required: true, unique: true, index: true },
        github_id: { type: String, required: true, unique: true, index: true },
        github_login: { type: String, required: true, unique: true, lowercase: true, index: true },
        github_name: { type: String, default: "" },
        email: { type: String, default: "" },
        avatar_url: { type: String, default: "" },
        role: { type: String, required: true, enum: ["admin", "analyst"], index: true },
        created_at: { type: Date, required: true, default: Date.now },
        updated_at: { type: Date, required: true, default: Date.now },
        last_login_at: { type: Date, required: true, default: Date.now },
      },
      { collection: `${collectionPrefix}_users`, versionKey: false }
    );

    const authRequestSchema = new mongoose.Schema(
      {
        id: { type: String, required: true, unique: true, index: true },
        client_type: { type: String, required: true, enum: ["web", "cli"], index: true },
        redirect_uri: { type: String, required: true },
        state: { type: String, required: true },
        code_challenge: { type: String, required: true },
        code_challenge_method: { type: String, required: true, default: "S256" },
        expires_at: { type: Date, required: true, index: true },
        created_at: { type: Date, required: true, default: Date.now },
        consumed_at: { type: Date, default: null, index: true },
      },
      { collection: `${collectionPrefix}_auth_requests`, versionKey: false }
    );

    const authCodeSchema = new mongoose.Schema(
      {
        code: { type: String, required: true, unique: true, index: true },
        auth_request_id: { type: String, required: true, index: true },
        user_id: { type: String, required: true, index: true },
        client_type: { type: String, required: true, enum: ["web", "cli"], index: true },
        redirect_uri: { type: String, required: true },
        state: { type: String, required: true },
        code_challenge: { type: String, required: true },
        expires_at: { type: Date, required: true, index: true },
        created_at: { type: Date, required: true, default: Date.now },
        consumed_at: { type: Date, default: null, index: true },
      },
      { collection: `${collectionPrefix}_auth_codes`, versionKey: false }
    );

    const sessionSchema = new mongoose.Schema(
      {
        id: { type: String, required: true, unique: true, index: true },
        user_id: { type: String, required: true, index: true },
        client_type: { type: String, required: true, enum: ["web", "cli"], index: true },
        refresh_token_hash: { type: String, required: true },
        csrf_token_hash: { type: String, required: true },
        user_agent: { type: String, default: "" },
        ip: { type: String, default: "" },
        created_at: { type: Date, required: true, default: Date.now },
        updated_at: { type: Date, required: true, default: Date.now },
        expires_at: { type: Date, required: true, index: true },
        last_rotated_at: { type: Date, default: null },
        revoked_at: { type: Date, default: null, index: true },
      },
      { collection: `${collectionPrefix}_sessions`, versionKey: false }
    );

    globalThis[globalAuthModelsKey] = {
      User: mongoose.models.InsightaUser || mongoose.model("InsightaUser", userSchema),
      AuthRequest:
        mongoose.models.InsightaAuthRequest || mongoose.model("InsightaAuthRequest", authRequestSchema),
      AuthCode: mongoose.models.InsightaAuthCode || mongoose.model("InsightaAuthCode", authCodeSchema),
      Session: mongoose.models.InsightaSession || mongoose.model("InsightaSession", sessionSchema),
    };
  }

  return globalThis[globalAuthModelsKey];
}

class MemoryAuthStore {
  constructor() {
    this.usersById = new Map();
    this.userIdsByGithubId = new Map();
    this.authRequestsById = new Map();
    this.authCodesByCode = new Map();
    this.sessionsById = new Map();
  }

  async upsertGithubUser(profile) {
    const existingId = this.userIdsByGithubId.get(profile.github_id);
    const timestamp = now().toISOString();

    if (existingId) {
      const current = this.usersById.get(existingId);
      const next = {
        ...current,
        ...profile,
        id: existingId,
        updated_at: timestamp,
        last_login_at: timestamp,
      };
      this.usersById.set(existingId, next);
      return next;
    }

    const user = {
      id: uuidv7(),
      created_at: timestamp,
      updated_at: timestamp,
      last_login_at: timestamp,
      ...profile,
    };

    this.usersById.set(user.id, user);
    this.userIdsByGithubId.set(user.github_id, user.id);
    return user;
  }

  async findUserById(id) {
    return this.usersById.get(id) ?? null;
  }

  async createAuthRequest(payload) {
    const record = {
      id: uuidv7(),
      created_at: now().toISOString(),
      consumed_at: null,
      ...payload,
    };

    this.authRequestsById.set(record.id, record);
    return record;
  }

  async findAuthRequestById(id) {
    const record = this.authRequestsById.get(id) ?? null;

    if (!record || record.consumed_at || isExpired(record)) {
      return null;
    }

    return record;
  }

  async consumeAuthRequest(id) {
    const record = await this.findAuthRequestById(id);

    if (!record) {
      return null;
    }

    const updated = {
      ...record,
      consumed_at: now().toISOString(),
    };
    this.authRequestsById.set(id, updated);
    return updated;
  }

  async createAuthorizationCode(payload) {
    const record = {
      created_at: now().toISOString(),
      consumed_at: null,
      ...payload,
    };

    this.authCodesByCode.set(record.code, record);
    return record;
  }

  async findAuthorizationCode(code) {
    const record = this.authCodesByCode.get(code) ?? null;

    if (!record || record.consumed_at || isExpired(record)) {
      return null;
    }

    return record;
  }

  async consumeAuthorizationCode(code) {
    const record = await this.findAuthorizationCode(code);

    if (!record) {
      return null;
    }

    const updated = {
      ...record,
      consumed_at: now().toISOString(),
    };
    this.authCodesByCode.set(code, updated);
    return updated;
  }

  async createSession(payload) {
    const timestamp = now().toISOString();
    const record = {
      id: uuidv7(),
      created_at: timestamp,
      updated_at: timestamp,
      last_rotated_at: null,
      revoked_at: null,
      ...payload,
    };

    this.sessionsById.set(record.id, record);
    return record;
  }

  async findSessionById(id) {
    const record = this.sessionsById.get(id) ?? null;

    if (!record || record.revoked_at || isExpired(record)) {
      return null;
    }

    return record;
  }

  async updateSession(id, updates) {
    const current = this.sessionsById.get(id);

    if (!current) {
      return null;
    }

    const next = {
      ...current,
      ...updates,
      updated_at: now().toISOString(),
    };
    this.sessionsById.set(id, next);
    return next;
  }

  async revokeSession(id) {
    const current = this.sessionsById.get(id);

    if (!current) {
      return null;
    }

    const next = {
      ...current,
      revoked_at: now().toISOString(),
      updated_at: now().toISOString(),
    };
    this.sessionsById.set(id, next);
    return next;
  }
}

class MongooseAuthStore {
  async upsertGithubUser(profile) {
    const { User } = getAuthModels();
    const timestamp = now();
    const document = await User.findOneAndUpdate(
      { github_id: profile.github_id },
      {
        $set: {
          ...profile,
          updated_at: timestamp,
          last_login_at: timestamp,
        },
        $setOnInsert: {
          id: uuidv7(),
          created_at: timestamp,
        },
      },
      {
        new: true,
        upsert: true,
      }
    )
      .lean()
      .select("-_id");

    return document;
  }

  async findUserById(id) {
    const { User } = getAuthModels();
    return User.findOne({ id }).lean().select("-_id");
  }

  async createAuthRequest(payload) {
    const { AuthRequest } = getAuthModels();
    const record = await AuthRequest.create({
      id: uuidv7(),
      created_at: now(),
      consumed_at: null,
      ...payload,
    });
    return stripId(record);
  }

  async findAuthRequestById(id) {
    const { AuthRequest } = getAuthModels();
    return AuthRequest.findOne({
      id,
      consumed_at: null,
      expires_at: { $gt: now() },
    })
      .lean()
      .select("-_id");
  }

  async consumeAuthRequest(id) {
    const { AuthRequest } = getAuthModels();
    return AuthRequest.findOneAndUpdate(
      {
        id,
        consumed_at: null,
        expires_at: { $gt: now() },
      },
      {
        $set: {
          consumed_at: now(),
        },
      },
      {
        new: true,
      }
    )
      .lean()
      .select("-_id");
  }

  async createAuthorizationCode(payload) {
    const { AuthCode } = getAuthModels();
    const record = await AuthCode.create({
      created_at: now(),
      consumed_at: null,
      ...payload,
    });
    return stripId(record);
  }

  async findAuthorizationCode(code) {
    const { AuthCode } = getAuthModels();
    return AuthCode.findOne({
      code,
      consumed_at: null,
      expires_at: { $gt: now() },
    })
      .lean()
      .select("-_id");
  }

  async consumeAuthorizationCode(code) {
    const { AuthCode } = getAuthModels();
    return AuthCode.findOneAndUpdate(
      {
        code,
        consumed_at: null,
        expires_at: { $gt: now() },
      },
      {
        $set: {
          consumed_at: now(),
        },
      },
      {
        new: true,
      }
    )
      .lean()
      .select("-_id");
  }

  async createSession(payload) {
    const { Session } = getAuthModels();
    const timestamp = now();
    const record = await Session.create({
      id: uuidv7(),
      created_at: timestamp,
      updated_at: timestamp,
      last_rotated_at: null,
      revoked_at: null,
      ...payload,
    });
    return stripId(record);
  }

  async findSessionById(id) {
    const { Session } = getAuthModels();
    return Session.findOne({
      id,
      revoked_at: null,
      expires_at: { $gt: now() },
    })
      .lean()
      .select("-_id");
  }

  async updateSession(id, updates) {
    const { Session } = getAuthModels();
    return Session.findOneAndUpdate(
      { id },
      {
        $set: {
          ...updates,
          updated_at: now(),
        },
      },
      {
        new: true,
      }
    )
      .lean()
      .select("-_id");
  }

  async revokeSession(id) {
    const { Session } = getAuthModels();
    return Session.findOneAndUpdate(
      { id },
      {
        $set: {
          revoked_at: now(),
          updated_at: now(),
        },
      },
      {
        new: true,
      }
    )
      .lean()
      .select("-_id");
  }
}

async function createAuthStore() {
  if (!isDatabaseConfigured()) {
    console.log("DATABASE_URL/DB_URI not found. Using in-memory auth store.");
    return new MemoryAuthStore();
  }

  try {
    await connectDatabase();
    const { User, AuthRequest, AuthCode, Session } = getAuthModels();
    await Promise.all([User.init(), AuthRequest.init(), AuthCode.init(), Session.init()]);
    return new MongooseAuthStore();
  } catch (error) {
    console.error("MongoDB auth store failed. Falling back to in-memory auth store.", error);
    return new MemoryAuthStore();
  }
}

export function getAuthStore() {
  if (!globalThis[globalAuthStoreKey]) {
    globalThis[globalAuthStoreKey] = createAuthStore();
  }

  return globalThis[globalAuthStoreKey];
}
