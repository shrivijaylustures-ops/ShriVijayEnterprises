import type { ImageMetadata } from 'astro';

// Every product photo under src/assets/resources, keyed by the path used in the data files ("resources/Ceramic/3589.jpeg").
const files = import.meta.glob<{ default: ImageMetadata }>('/src/assets/resources/**/*.{jpg,jpeg,png,JPG,JPEG,PNG}', { eager: true });

export const productImage = (path?: string | null) => (path ? files[`/src/assets/${path}`]?.default : undefined);
