import type { Profile, ProfileUpdateInput } from '@virtualfit/shared';
import type { Collection } from '../../db/collection';
import type { UserDoc } from './users.types';

const EMPTY: Profile = {
  displayName: '',
  gender: null,
  heightCm: null,
  weightKg: null,
  chestCm: null,
  waistCm: null,
  hipsCm: null,
  preferredCategories: [],
  privacy: { rememberAiConsent: false },
  updatedAt: null,
};

function toDto(doc: UserDoc): Profile {
  return {
    displayName: doc.displayName,
    gender: doc.gender ?? null,
    heightCm: doc.heightCm,
    weightKg: doc.weightKg,
    chestCm: doc.chestCm,
    waistCm: doc.waistCm,
    hipsCm: doc.hipsCm,
    preferredCategories: doc.preferredCategories,
    privacy: { rememberAiConsent: doc.rememberAiConsent },
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class UsersService {
  constructor(private readonly docs: Collection<UserDoc>) {}

  async get(guestId: string): Promise<Profile> {
    const doc = await this.docs.get(guestId);
    return doc ? toDto(doc) : EMPTY;
  }

  async update(guestId: string, input: ProfileUpdateInput): Promise<Profile> {
    const { privacy, ...fields } = input;
    const patch: Partial<UserDoc> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) (patch as Record<string, unknown>)[key] = value;
    }
    if (privacy?.rememberAiConsent !== undefined)
      patch.rememberAiConsent = privacy.rememberAiConsent;

    const existing = await this.docs.get(guestId);
    if (existing) return toDto((await this.docs.update(guestId, patch)) as UserDoc);

    const now = new Date();
    const created: UserDoc = {
      id: guestId,
      displayName: '',
      gender: null,
      heightCm: null,
      weightKg: null,
      chestCm: null,
      waistCm: null,
      hipsCm: null,
      preferredCategories: [],
      rememberAiConsent: false,
      createdAt: now,
      updatedAt: now,
      ...patch,
    };
    return toDto(await this.docs.insert(created));
  }

  async remove(guestId: string): Promise<void> {
    await this.docs.remove(guestId);
  }
}
