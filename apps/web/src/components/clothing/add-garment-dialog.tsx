'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { z } from 'zod';
import { CATEGORY_LABELS, CLOTHING_CATEGORIES, categorySchema } from '@virtualfit/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError, Input, Label, Select } from '@/components/ui/input';
import { ImageDropzone } from '@/components/shared/image-dropzone';
import { api } from '@/services/api';
import { describeError } from '@/lib/api-errors';

const formSchema = z.object({
  name: z.string().trim().min(1, 'Give the garment a name').max(80),
  category: categorySchema,
  description: z.string().trim().max(300, 'Keep it under 300 characters'),
});
type FormValues = z.infer<typeof formSchema>;

export function AddGarmentDialog({ maxMb }: { maxMb: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', category: 'tops', description: '' },
  });

  function close(next: boolean) {
    setOpen(next);
    if (!next) {
      reset();
      setFile(null);
      setFileError(null);
      setServerError(null);
    }
  }

  async function onSubmit(values: FormValues) {
    if (!file) {
      setFileError('Choose a garment image first.');
      return;
    }
    setServerError(null);
    const form = new FormData();
    form.append('name', values.name);
    form.append('category', values.category);
    form.append('description', values.description);
    form.append('image', file);
    try {
      await api.createClothing(form);
      await qc.invalidateQueries({ queryKey: ['clothing'] });
      close(false);
    } catch (err) {
      setServerError(describeError(err).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> Add garment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-lg font-semibold">Add your own garment</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          Upload a clear photo of a single garment on a plain background for the best results. It
          stays private to this browser session.
        </DialogDescription>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <ImageDropzone
            file={file}
            onChange={(f) => {
              setFile(f);
              setFileError(null);
            }}
            maxMb={maxMb}
            label="Garment image"
            hint={`JPEG or PNG, up to ${maxMb} MB`}
            aspect="aspect-[4/3]"
          />
          <FieldError message={fileError ?? undefined} />
          <div className="space-y-1.5">
            <Label htmlFor="g-name">Name</Label>
            <Input id="g-name" aria-invalid={!!errors.name} {...register('name')} />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-category">Category</Label>
            <Select id="g-category" {...register('category')}>
              {CLOTHING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="g-desc">Description (optional)</Label>
            <Input id="g-desc" aria-invalid={!!errors.description} {...register('description')} />
            <FieldError message={errors.description?.message} />
          </div>
          {serverError && (
            <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
              {serverError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Uploading...' : 'Save to wardrobe'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
