// Shared single-photo upload: canvas thumbnail + multipart POST to an owner
// endpoint (/items/:id/photos or /logs/:id/photos). Server falls back to
// copying the original when the thumb part is missing.
import { api } from '../api/client';
import type { Photo } from '../api/types';
import { makeThumbnail } from './image';

export async function uploadPhotoFile(path: string, file: File, caption?: string): Promise<Photo> {
  const form = new FormData();
  form.append('photo', file, file.name);
  try {
    const { thumb, width, height } = await makeThumbnail(file);
    form.append('thumb', thumb, 'thumb.jpg');
    form.append('width', String(width));
    form.append('height', String(height));
  } catch {
    // thumbnail generation failed — server copies the original
  }
  if (caption?.trim()) form.append('caption', caption.trim());
  return api.upload<Photo>(path, form);
}
