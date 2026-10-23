import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';

// Every product photo under src/assets/resources, keyed by the path used in the data files ("resources/Ceramic/3589.jpeg").
const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/resources/**/*.{jpg,jpeg,png,JPG,JPEG,PNG}', { eager: true });

export const productImage = (path?: string | null) => (path ? files[`/src/assets/${path}`]?.default : undefined);

/** Optimised WebP URL for a data-file image path, or null if the file is missing. */
export async function thumb(path?: string | null, width = 640) {
  const src = productImage(path);
  if (!src) return null;
  const img = await getImage({ src, width: Math.min(width, src.width), format: 'webp', quality: 80 });
  return img.src;
}
