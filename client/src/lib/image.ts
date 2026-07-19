// Client-side canvas thumbnail generation (no sharp dep; works on iPad camera).
// Downscale to <=400px long edge, JPEG. Returns a Blob to upload as `thumb`.

const MAX_THUMB = 400;

export interface ProcessedImage {
  thumb: Blob;
  width: number;
  height: number;
}

export async function makeThumbnail(file: File): Promise<ProcessedImage> {
  const bitmap = await loadImage(file);
  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_THUMB / Math.max(width, height));
  const tw = Math.max(1, Math.round(width * scale));
  const th = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, tw, th);
  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const thumb = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Thumbnail encode failed'))),
      'image/jpeg',
      0.82,
    );
  });

  return { thumb, width, height };
}

async function loadImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file);
    } catch {
      // fall through to <img> path (e.g. some HEIC/edge cases)
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}
