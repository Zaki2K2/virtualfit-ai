import type { ClothingCategory, ClothingItem } from '@virtualfit/shared';

export type Intent = 'outfit' | 'category' | 'clarify' | 'unsupported' | 'advice';
export interface Slot {
  category?: ClothingCategory;
  garment?: string;
  colors: string[];
}
export interface Preferences {
  intent: Intent;
  slots: Slot[];
  excludedCategories: ClothingCategory[];
  excludedColors: string[];
  occasion: string;
  season: string;
  unsupported: string[];
  excludedSlots?: Slot[];
}
export interface Attributes {
  colors: string[];
  garment: string;
  occasions: string[];
  seasons: string[];
  source: 'catalog' | 'text';
}

const nouns: Record<string, [ClothingCategory, string | undefined]> = {
  top: ['tops', undefined],
  tops: ['tops', undefined],
  tee: ['tops', 'tee'],
  tees: ['tops', 'tee'],
  't-shirt': ['tops', 'tee'],
  't-shirts': ['tops', 'tee'],
  shirt: ['tops', 'shirt'],
  shirts: ['tops', 'shirt'],
  trousers: ['bottoms', undefined],
  pants: ['bottoms', undefined],
  chinos: ['bottoms', 'chinos'],
  shorts: ['bottoms', 'shorts'],
  jeans: ['bottoms', 'jeans'],
  bottoms: ['bottoms', undefined],
  jacket: ['outerwear', undefined],
  jackets: ['outerwear', undefined],
  coat: ['outerwear', 'coat'],
  dress: ['dresses', undefined],
  dresses: ['dresses', undefined],
  denim: ['outerwear', 'denim'],
  bomber: ['outerwear', 'bomber'],
  kurta: ['tops', 'kurta'],
  kameez: ['tops', 'kameez'],
  shalwar: ['bottoms', 'shalwar'],
  dupatta: ['outerwear', 'dupatta'],
  sherwani: ['outerwear', 'sherwani'],
};
const colorWords = [
  'white',
  'black',
  'blue',
  'indigo',
  'navy',
  'red',
  'rose',
  'pink',
  'green',
  'olive',
  'khaki',
  'charcoal',
  'graphite',
  'gray',
  'grey',
  'sand',
  'beige',
  'yellow',
  'purple',
  'orange',
  'brown',
];
const canonicalColor = (s: string) => (s === 'grey' ? 'gray' : s);
const wordsIn = (text: string, words: string[]) =>
  words.filter((word) => new RegExp(`\\b${word}\\b`).test(text));
const colorMatch = (wanted: string, got: string[]) =>
  got.includes(wanted) ||
  (wanted === 'blue' && got.some((c) => ['indigo', 'navy'].includes(c))) ||
  (wanted === 'gray' && got.some((c) => ['charcoal', 'graphite'].includes(c))) ||
  (wanted === 'green' && got.includes('olive')) ||
  (wanted === 'beige' && got.includes('sand'));

/** Conservative text parsing. Unknown constraints are not evidence that a garment matches. */
export function parsePreferences(message: string): Preferences {
  const text = message.toLowerCase().replace(/\b(gray|grey)\b/g, 'gray');
  const result: Preferences = {
    intent: 'outfit',
    slots: [],
    excludedCategories: [],
    excludedColors: [],
    occasion: '',
    season: '',
    unsupported: [],
  };
  result.occasion = /\b(formal|office|business|smart)\b/.test(text)
    ? 'formal'
    : /\b(casual|relaxed|weekend)\b/.test(text)
      ? 'casual'
      : /\bdinner\b/.test(text)
        ? 'dinner'
        : '';
  result.season = /\b(summer|hot weather|warm weather)\b/.test(text)
    ? 'summer'
    : /\b(winter|cold weather)\b/.test(text)
      ? 'winter'
      : /\b(autumn|fall)\b/.test(text)
        ? 'autumn'
        : /\bspring\b/.test(text)
          ? 'spring'
          : '';
  const categoryQuestion = /\b(category|classify|classification|what type)\b/.test(text);
  const unsupportedNouns = [
    'scarf',
    'scarves',
    'shoes',
    'sneakers',
    'boots',
    'hat',
    'hats',
    'socks',
    'jewelry',
    'handbag',
    'suit',
    'saree',
  ];
  let negative = false;
  for (let part of text.split(/[,;.!]|\b(?:and|with|plus|over|paired with|but)\b/)) {
    if (!part.trim()) continue;
    const negated =
      /\b(no|avoid|without|exclude|not|don't want)\b/.test(part) && !/without picking/.test(part);
    const colors = wordsIn(part, colorWords).map(canonicalColor);
    if (negated) negative = true;
    else if (colors.length || /\b(choose|wear|add|want|pick|suggest|find)\b/.test(part))
      negative = false;
    if (negative) {
      const excludedNouns = wordsIn(part, Object.keys(nouns));
      if (colors.length && excludedNouns.length) {
        result.excludedSlots ??= [];
        for (const word of excludedNouns)
          result.excludedSlots.push({
            category: nouns[word]![0],
            garment: nouns[word]![1],
            colors,
          });
      } else {
        result.excludedColors.push(...colors);
        for (const word of excludedNouns) result.excludedCategories.push(nouns[word]![0]);
      }
      continue;
    }
    result.unsupported.push(...wordsIn(part, unsupportedNouns));
    if (/shalwar\s+kameez/.test(part))
      part = part.replace(/shalwar\s+kameez/, 'kameez and shalwar');
    const mentions = wordsIn(part, Object.keys(nouns));
    const slots = new Map<string, Slot>();
    for (const word of mentions) {
      const [category, garment] = nouns[word]!;
      const current = slots.get(category);
      // A specific garment term refines a generic category mention in the same clause.
      if (!current || (garment && !current.garment))
        slots.set(category, { category, garment, colors });
    }
    if (slots.size) result.slots.push(...slots.values());
    else if (colors.length) result.slots.push({ colors });
  }
  result.excludedCategories = [...new Set(result.excludedCategories)];
  result.excludedColors = [...new Set(result.excludedColors)];
  result.slots = result.slots.filter(
    (slot, i, all) => all.findIndex((s) => JSON.stringify(s) === JSON.stringify(slot)) === i,
  );
  if (categoryQuestion) result.intent = 'category';
  else if (
    /\b(?:what|which) colou?rs?\b.*\b(?:match|go|work|pair)|\bcolou?r matching\b|\bstyling tips\b|\bhow (?:do|can|should) (?:i|you) (?:match|combine|style)\b/.test(
      text,
    )
  )
    result.intent = 'advice';
  else if (result.unsupported.length) result.intent = 'unsupported';
  else if (!result.slots.length && /\b(traditional|pakistani)\b/.test(text))
    result.slots = [
      { category: 'tops', garment: 'kurta', colors: [] },
      { category: 'bottoms', garment: 'shalwar', colors: [] },
    ];
  else if (!result.slots.length && (result.occasion || result.season)) {
    result.slots = [
      { category: 'tops', colors: [] },
      { category: 'bottoms', colors: [] },
    ];
    if (result.season === 'winter') result.slots.push({ category: 'outerwear', colors: [] });
  } else if (!result.slots.length) result.intent = 'clarify';
  return result;
}

const catalogStyle: Record<string, [string[], string[]]> = {
  'tee-classic-white': [['casual'], ['summer', 'spring']],
  'tee-graphite': [['casual'], ['summer', 'spring']],
  'shirt-oxford-blue': [
    ['formal', 'casual', 'dinner'],
    ['spring', 'autumn', 'winter'],
  ],
  'shirt-linen-sand': [
    ['casual', 'formal'],
    ['summer', 'spring'],
  ],
  'jacket-denim': [['casual'], ['spring', 'autumn']],
  'jacket-bomber-olive': [['casual'], ['winter', 'autumn']],
  'trousers-chino-khaki': [['casual'], ['summer', 'spring', 'autumn', 'winter']],
  'trousers-tailored-charcoal': [
    ['formal', 'dinner'],
    ['summer', 'spring', 'autumn', 'winter'],
  ],
  'dress-midi-indigo': [
    ['casual', 'dinner'],
    ['summer', 'spring'],
  ],
  'dress-summer-rose': [['casual'], ['summer', 'spring']],
};

export function attributes(item: ClothingItem): Attributes {
  const text = `${item.name} ${item.description}`.toLowerCase();
  const style = item.source === 'catalog' ? catalogStyle[item.id] : undefined;
  const specific = [
    'sherwani',
    'dupatta',
    'shalwar',
    'kameez',
    'kurta',
    'denim',
    'bomber',
    'chinos',
    'coat',
    'tee',
    't-shirt',
    'shirt',
  ].find((w) => new RegExp(`\\b${w}\\b`).test(text));
  return {
    colors: [...new Set(wordsIn(text, colorWords).map(canonicalColor))],
    garment: specific === 't-shirt' ? 'tee' : (specific ?? item.category),
    occasions: style?.[0] ?? wordsIn(text, ['casual', 'formal', 'dinner']),
    seasons: style?.[1] ?? wordsIn(text, ['summer', 'winter', 'spring', 'autumn']),
    source: style ? 'catalog' : 'text',
  };
}

export function ground(
  items: ClothingItem[],
  preferences: Preferences,
  preferredCategories: ClothingCategory[] = [],
) {
  const visible = items.filter(
    (item) =>
      !preferences.excludedCategories.includes(item.category) &&
      !preferences.excludedColors.some((c) => colorMatch(c, attributes(item).colors)) &&
      !(preferences.excludedSlots ?? []).some(
        (slot) =>
          (!slot.category || slot.category === item.category) &&
          (!slot.garment || slot.garment === attributes(item).garment) &&
          slot.colors.some((c) => colorMatch(c, attributes(item).colors)),
      ),
  );
  const groups = preferences.slots.map((slot) =>
    visible
      .filter((item) => {
        const a = attributes(item);
        return (
          (!slot.category || item.category === slot.category) &&
          (!slot.garment || a.garment === slot.garment) &&
          (!slot.colors.length || slot.colors.some((color) => colorMatch(color, a.colors))) &&
          (!preferences.occasion || a.occasions.includes(preferences.occasion)) &&
          (!preferences.season || a.seasons.includes(preferences.season))
        );
      })
      .sort((a, b) => {
        const rank = (item: ClothingItem) =>
          Number(preferredCategories.includes(item.category)) + Number(item.source === 'user') * 2;
        return rank(b) - rank(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      })
      .slice(0, 3),
  );
  const plan: ClothingItem[] = [];
  for (const group of groups) {
    const item = group.find((i) => !plan.some((p) => p.id === i.id));
    if (item) plan.push(item);
  }
  const complete = groups.length > 0 && plan.length === groups.length && plan.length <= 4;
  const candidates = [...new Map(groups.flat().map((i) => [i.id, i])).values()].slice(0, 12);
  return { groups, plan, candidates, complete };
}

export function validSelection(ids: string[], groups: ClothingItem[][]): boolean {
  if (ids.length !== groups.length || new Set(ids).size !== ids.length) return false;
  const assign = (at: number, remaining: string[]): boolean =>
    at === groups.length ||
    remaining.some(
      (id, i) =>
        groups[at]!.some((item) => item.id === id) &&
        assign(
          at + 1,
          remaining.filter((_id, j) => i !== j),
        ),
    );
  return assign(0, ids);
}

/** Explicit follow-ups inherit clothing constraints, never another guest's inventory. */
export function conversationPreferences(message: string, history: string[] = []): Preferences {
  const current = parsePreferences(message);
  if (
    !history.length ||
    !/^(?:and\b|also\b|what about\b|how about\b|instead\b|make\b|change\b|same\b|that\b|it\b|those\b|try\b|why\b|can you explain\b|what colors\b)/i.test(
      message.trim(),
    )
  )
    return current;
  const previous = conversationPreferences(history[history.length - 1]!, history.slice(0, -1));
  // Category/advice questions must not inherit a prior outfit selection.
  if (
    current.intent === 'category' ||
    current.intent === 'unsupported' ||
    current.intent === 'advice'
  )
    return current;
  let slots = current.slots;
  if (
    !slots.length ||
    (!wordsIn(message.toLowerCase(), Object.keys(nouns)).length &&
      (current.occasion || current.season))
  )
    slots = previous.slots;
  else if (slots.every((s) => !s.category && s.colors.length))
    slots = previous.slots.map((s) => ({ ...s, colors: slots.flatMap((c) => c.colors) }));
  else {
    const categories = new Set(slots.map((s) => s.category));
    slots = [...previous.slots.filter((s) => !categories.has(s.category)), ...slots];
  }
  return {
    ...current,
    intent: slots.length ? 'outfit' : current.intent,
    slots,
    occasion: current.occasion || previous.occasion,
    season: current.season || previous.season,
    excludedCategories: [
      ...new Set([...previous.excludedCategories, ...current.excludedCategories]),
    ],
    excludedColors: [...new Set([...previous.excludedColors, ...current.excludedColors])],
    excludedSlots: [...(previous.excludedSlots ?? []), ...(current.excludedSlots ?? [])],
  };
}
