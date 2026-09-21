/**
 * The vocabulary of things people see in things.
 *
 * Recognition here is not general image classification - it is answering "what
 * does this look like?" for someone who already thinks they saw something. So
 * the list is deliberately narrow and weighted towards pareidolia: faces,
 * creatures, figures, and the handful of natural forms that most often carry
 * them.
 *
 * Each entry pairs a stable key with a CLIP prompt and a label in both
 * languages. The prompt wording matters: CLIP responds to natural captions,
 * not bare nouns.
 */

export type Archetype = {
  key: string
  prompt: string
  uk: string
  en: string
}

export const ARCHETYPES: Archetype[] = [
  { key: 'face', prompt: 'a face hidden in an object', uk: 'обличчя', en: 'a face' },
  { key: 'eyes', prompt: 'a pair of eyes looking out', uk: 'очі', en: 'eyes' },
  { key: 'skull', prompt: 'a skull shape', uk: 'череп', en: 'a skull' },
  { key: 'figure', prompt: 'a human figure standing', uk: 'постать', en: 'a figure' },
  { key: 'hand', prompt: 'a hand or reaching fingers', uk: 'рука', en: 'a hand' },
  { key: 'animal', prompt: 'an animal shape', uk: 'тварина', en: 'an animal' },
  { key: 'dog', prompt: 'a dog or wolf head', uk: 'пес', en: 'a dog' },
  { key: 'cat', prompt: 'a cat face', uk: 'кіт', en: 'a cat' },
  { key: 'bird', prompt: 'a bird with wings', uk: 'птах', en: 'a bird' },
  { key: 'fish', prompt: 'a fish shape', uk: 'риба', en: 'a fish' },
  { key: 'horse', prompt: 'a horse shape', uk: 'кінь', en: 'a horse' },
  { key: 'dragon', prompt: 'a dragon or serpent', uk: 'дракон', en: 'a dragon' },
  { key: 'creature', prompt: 'a strange creature or monster', uk: 'істота', en: 'a creature' },
  { key: 'tree', prompt: 'a tree with branches', uk: 'дерево', en: 'a tree' },
  { key: 'cloud', prompt: 'clouds in the sky', uk: 'хмари', en: 'clouds' },
  { key: 'rock', prompt: 'a rock or stone formation', uk: 'камінь', en: 'a rock' },
  { key: 'water', prompt: 'water, waves or reflections', uk: 'вода', en: 'water' },
  { key: 'fire', prompt: 'fire or flames', uk: 'вогонь', en: 'fire' },
  { key: 'wall', prompt: 'a cracked or peeling wall', uk: 'стіна', en: 'a wall' },
  { key: 'wood', prompt: 'wood grain and knots', uk: 'деревина', en: 'wood grain' },
  { key: 'rust', prompt: 'rust and corroded metal', uk: 'іржа', en: 'rust' },
  { key: 'shadow', prompt: 'a shadow cast on a surface', uk: 'тінь', en: 'a shadow' },
  { key: 'fabric', prompt: 'folded fabric or cloth', uk: 'тканина', en: 'fabric' },
  { key: 'plant', prompt: 'leaves and plants', uk: 'рослина', en: 'a plant' },
  { key: 'mountain', prompt: 'a mountain or hillside', uk: 'гора', en: 'a mountain' },
  { key: 'building', prompt: 'a building or architecture', uk: 'будівля', en: 'a building' },
  { key: 'machine', prompt: 'a machine or mechanical parts', uk: 'механізм', en: 'a machine' },
  { key: 'letter', prompt: 'a letter or written symbol', uk: 'символ', en: 'a symbol' },
  { key: 'heart', prompt: 'a heart shape', uk: 'серце', en: 'a heart' },
  {
    key: 'pattern',
    prompt: 'an abstract pattern with no clear subject',
    uk: 'візерунок',
    en: 'a pattern',
  },
]

export const VOCABULARY_VERSION = 1

export function archetypeLabel(key: string, locale: 'uk' | 'en'): string | null {
  const entry = ARCHETYPES.find((item) => item.key === key)
  return entry ? entry[locale] : null
}
