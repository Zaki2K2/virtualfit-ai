'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Info } from 'lucide-react';
import { z } from 'zod';
import {
  CATEGORY_LABELS,
  CLOTHING_CATEGORIES,
  type ClothingCategory,
  GENDER_LABELS,
  GENDERS,
  type ProfileUpdateInput,
} from '@virtualfit/shared';
import { PageContainer, PageHeader } from '@/components/shared/page-header';
import { ErrorState, Spinner } from '@/components/shared/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useProfile, useUpdateProfile } from '@/hooks/use-api';
import { describeError } from '@/lib/api-errors';

/** Optional number held as text in the form; empty string means "not provided". */
const measurement = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number(v) >= min && Number(v) <= max), {
      message: `${label} must be between ${min} and ${max}`,
    });

const formSchema = z.object({
  displayName: z.string().trim().max(60, 'Keep it under 60 characters'),
  gender: z.enum(['', ...GENDERS]),
  heightCm: measurement('Height', 50, 260),
  weightKg: measurement('Weight', 20, 400),
  chestCm: measurement('Chest', 30, 250),
  waistCm: measurement('Waist', 30, 250),
  hipsCm: measurement('Hips', 30, 250),
  preferredCategories: z.array(z.string()),
  rememberAiConsent: z.boolean(),
});
type FormValues = z.infer<typeof formSchema>;

const toText = (n: number | null | undefined) => (n == null ? '' : String(n));
const toNumber = (s: string) => (s === '' ? null : Number(s));

const MEASUREMENTS: Array<{
  name: 'heightCm' | 'weightKg' | 'chestCm' | 'waistCm' | 'hipsCm';
  label: string;
  unit: string;
}> = [
  { name: 'heightCm', label: 'Height', unit: 'cm' },
  { name: 'weightKg', label: 'Weight', unit: 'kg' },
  { name: 'chestCm', label: 'Chest', unit: 'cm' },
  { name: 'waistCm', label: 'Waist', unit: 'cm' },
  { name: 'hipsCm', label: 'Hips', unit: 'cm' },
];

export function ProfileForm() {
  const profile = useProfile();
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    reset({
      displayName: p.displayName,
      gender: p.gender ?? '',
      heightCm: toText(p.heightCm),
      weightKg: toText(p.weightKg),
      chestCm: toText(p.chestCm),
      waistCm: toText(p.waistCm),
      hipsCm: toText(p.hipsCm),
      preferredCategories: p.preferredCategories,
      rememberAiConsent: p.privacy.rememberAiConsent,
    });
  }, [profile.data, reset]);

  function onSubmit(v: FormValues) {
    setSaved(false);
    const input: ProfileUpdateInput = {
      displayName: v.displayName,
      gender: v.gender === '' ? null : v.gender,
      heightCm: toNumber(v.heightCm),
      weightKg: toNumber(v.weightKg),
      chestCm: toNumber(v.chestCm),
      waistCm: toNumber(v.waistCm),
      hipsCm: toNumber(v.hipsCm),
      preferredCategories: v.preferredCategories as ClothingCategory[],
      privacy: { rememberAiConsent: v.rememberAiConsent },
    };
    update.mutate(input, { onSuccess: () => setSaved(true) });
  }

  return (
    <PageContainer className="max-w-3xl">
      <PageHeader
        title="Profile"
        description="Optional details for a more personal experience. Everything here is optional."
      />

      {profile.isLoading ? (
        <Spinner label="Loading profile..." />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          <Card>
            <CardHeader>
              <CardTitle>About you</CardTitle>
              <CardDescription>
                You are using VirtualFit AI as a guest. Accounts are not available yet, so this
                profile is tied to this browser.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Display name</Label>
                <Input
                  id="displayName"
                  autoComplete="nickname"
                  aria-invalid={!!errors.displayName}
                  {...register('displayName')}
                />
                <FieldError message={errors.displayName?.message} />
              </div>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Gender</legend>
                <div className="flex gap-3">
                  {GENDERS.map((g) => (
                    <label
                      key={g}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
                    >
                      <input
                        type="radio"
                        value={g}
                        className="size-4 accent-[var(--color-accent)]"
                        {...register('gender')}
                      />
                      {GENDER_LABELS[g]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Body measurements</CardTitle>
              <CardDescription>
                Stored for future size recommendations. Nothing is sent to the AI model.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="flex gap-2 rounded-md bg-accent-soft p-3 text-sm text-accent">
                <Info className="mt-0.5 size-4 shrink-0" />
                Height and weight alone cannot determine how clothing will fit. Size recommendations
                are not implemented yet; try-on results show appearance only.
              </p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {MEASUREMENTS.map(({ name, label, unit }) => (
                  <div key={name} className="space-y-1.5">
                    <Label htmlFor={name}>
                      {label} ({unit})
                    </Label>
                    <Input
                      id={name}
                      inputMode="decimal"
                      aria-invalid={!!errors[name]}
                      {...register(name)}
                    />
                    <FieldError message={errors[name]?.message} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Preferred clothing categories</CardTitle>
            </CardHeader>
            <CardContent>
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="sr-only">Preferred clothing categories</legend>
                {CLOTHING_CATEGORIES.map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      value={c}
                      className="size-4 accent-[var(--color-accent)]"
                      {...register('preferredCategories')}
                    />
                    {CATEGORY_LABELS[c]}
                  </label>
                ))}
              </fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Privacy preferences</CardTitle>
            </CardHeader>
            <CardContent>
              <label className="flex cursor-pointer gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                  {...register('rememberAiConsent')}
                />
                <span>
                  <span className="block font-medium">
                    Remember my consent for external AI processing
                  </span>
                  <span className="text-muted-foreground">
                    Pre-ticks the consent box in the studio when a real AI service is used. You can
                    still untick it before each generation. Does nothing in simulation mode.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={update.isPending || !isDirty}>
              {update.isPending ? 'Saving...' : 'Save profile'}
            </Button>
            {saved && !isDirty && (
              <span role="status" className="inline-flex items-center gap-1.5 text-sm text-success">
                <Check className="size-4" /> Saved
              </span>
            )}
            {update.isError && (
              <span role="alert" className="text-sm text-danger">
                {describeError(update.error).message}
              </span>
            )}
          </div>
        </form>
      )}
    </PageContainer>
  );
}
