import type { CatalogEntry } from './clothing.types';

/**
 * Bundled sample garments. The images in assets/catalog are simple vector illustrations generated
 * by `npm run generate:catalog` (see scripts/generate-catalog.ts). They are placeholders for demo
 * purposes, not photographs of real products.
 */
export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'tee-classic-white',
    name: 'Classic Crew T-shirt',
    category: 'tops',
    description: 'Plain short-sleeve cotton tee in white.',
  },
  {
    id: 'tee-graphite',
    name: 'Graphite T-shirt',
    category: 'tops',
    description: 'Relaxed short-sleeve tee in graphite grey.',
  },
  {
    id: 'shirt-oxford-blue',
    name: 'Oxford Button Shirt',
    category: 'tops',
    description: 'Long-sleeve collared shirt in sky blue.',
  },
  {
    id: 'shirt-linen-sand',
    name: 'Linen Shirt',
    category: 'tops',
    description: 'Lightweight collared shirt in sand.',
  },
  {
    id: 'jacket-denim',
    name: 'Denim Jacket',
    category: 'outerwear',
    description: 'Classic indigo denim jacket.',
  },
  {
    id: 'jacket-bomber-olive',
    name: 'Bomber Jacket',
    category: 'outerwear',
    description: 'Olive bomber jacket with ribbed hem.',
  },
  {
    id: 'trousers-chino-khaki',
    name: 'Chino Trousers',
    category: 'bottoms',
    description: 'Straight-fit chinos in khaki.',
  },
  {
    id: 'trousers-tailored-charcoal',
    name: 'Tailored Trousers',
    category: 'bottoms',
    description: 'Charcoal tailored trousers.',
  },
  {
    id: 'dress-midi-indigo',
    name: 'Midi Dress',
    category: 'dresses',
    description: 'Sleeveless midi dress in indigo.',
  },
  {
    id: 'dress-summer-rose',
    name: 'Summer Dress',
    category: 'dresses',
    description: 'Short-sleeve flared dress in dusty rose.',
  },
];

export const findCatalogEntry = (id: string) => CATALOG.find((c) => c.id === id);
