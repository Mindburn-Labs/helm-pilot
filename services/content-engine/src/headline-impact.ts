import type { HeadlineDimensions, HeadlineScore } from './types.js';

const NUMERAL = /\d+/g;
const NAMED_ENTITY = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;
const PRODUCT_TOKEN = /\b[A-Z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)+\b/g;

const BENEFIT_MARKERS =
  /\b(how to|in \d+ (?:days|hours|weeks|minutes|months)|without|get|stop|learn|build|ship|save|earn|grow)\b/gi;

const CURIOSITY_MARKERS =
  /\b(why|secret|nobody|everyone|actually|truth|mistake|wrong|surprising|behind|hidden|unexpected|what happens|never|finally)\b/gi;

const POWER_WORDS = [
  'proven',
  'instant',
  'bold',
  'simple',
  'powerful',
  'ultimate',
  'essential',
  'guaranteed',
  'exclusive',
  'brutal',
  'honest',
  'shocking',
  'surprising',
  'effortless',
  'rapid',
  'free',
  'new',
  'raw',
  'dangerous',
  'painful',
  'quiet',
  'loud',
] as const;

const POWER_WORDS_RE = new RegExp(`\\b(${POWER_WORDS.join('|')})\\b`, 'gi');

export class HeadlineImpactScorer {
  score(headline: string): HeadlineScore {
    const trimmed = headline.trim();
    const wordCount = trimmed.split(/\s+/).filter((w) => w.length > 0).length;

    const dimensions: HeadlineDimensions = {
      specificity: scoreSpecificity(trimmed),
      benefit_clarity: scoreBenefitClarity(trimmed),
      curiosity: scoreCuriosity(trimmed),
      brevity: scoreBrevity(wordCount),
      power_words: scorePowerWords(trimmed),
    };

    const overall = Math.round(
      (dimensions.specificity +
        dimensions.benefit_clarity +
        dimensions.curiosity +
        dimensions.brevity +
        dimensions.power_words) /
        5,
    );

    return { overall, dimensions };
  }
}

function scoreSpecificity(text: string): number {
  const numerals = text.match(NUMERAL)?.length ?? 0;
  const products = text.match(PRODUCT_TOKEN)?.length ?? 0;
  const entityMatches = text.match(NAMED_ENTITY) ?? [];
  // Discount the first capitalized word (sentence-initial capitalization isn't a named entity signal).
  const entities = entityMatches.length > 0 ? entityMatches.length - 1 : 0;

  const signals = numerals * 2 + products * 2 + entities;
  return Math.min(100, signals * 25);
}

function scoreBenefitClarity(text: string): number {
  const matches = text.match(BENEFIT_MARKERS)?.length ?? 0;
  if (matches === 0) return 20;
  if (matches === 1) return 75;
  return 100;
}

function scoreCuriosity(text: string): number {
  const matches = text.match(CURIOSITY_MARKERS)?.length ?? 0;
  if (matches === 0) return 25;
  if (matches === 1) return 70;
  return 100;
}

function scoreBrevity(wordCount: number): number {
  if (wordCount >= 6 && wordCount <= 12) return 100;
  if (wordCount >= 4 && wordCount <= 15) return 70;
  if (wordCount >= 3 && wordCount <= 18) return 45;
  return 20;
}

function scorePowerWords(text: string): number {
  const matches = text.match(POWER_WORDS_RE)?.length ?? 0;
  if (matches === 0) return 25;
  if (matches === 1) return 70;
  if (matches === 2) return 90;
  return 100;
}
