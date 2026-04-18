const globalStoreKey = "__stage0ProfileStore__";

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
    const normalizedFilters = {
      gender: typeof filters.gender === "string" ? filters.gender.toLowerCase() : null,
      country_id:
        typeof filters.country_id === "string"
          ? filters.country_id.toLowerCase()
          : null,
      age_group:
        typeof filters.age_group === "string"
          ? filters.age_group.toLowerCase()
          : null,
    };

    return profiles.filter((profile) => {
      if (
        normalizedFilters.gender &&
        profile.gender.toLowerCase() !== normalizedFilters.gender
      ) {
        return false;
      }

      if (
        normalizedFilters.country_id &&
        profile.country_id.toLowerCase() !== normalizedFilters.country_id
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

export function getProfileStore() {
  if (!globalThis[globalStoreKey]) {
    globalThis[globalStoreKey] = new MemoryProfileStore();
  }

  return globalThis[globalStoreKey];
}
