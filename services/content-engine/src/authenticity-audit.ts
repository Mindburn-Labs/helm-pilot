import type {
  AuthenticityScore,
  AuthenticitySignal,
  AuthenticitySignalName,
  AuthenticityVerdict,
} from './types.js';

interface SignalRule {
  readonly name: AuthenticitySignalName;
  readonly detect: (text: string) => boolean;
  readonly note: string;
}

const AI_PHRASES =
  /\b(in today's fast-paced|leverage|leveraging|synergy|delve into|navigate the landscape|it's important to note|in conclusion|furthermore|moreover|embark on a journey|unlock the potential|tapestry|realm of|at the forefront)\b/i;

const BUZZWORDS =
  /\b(disruptive|revolutionary|cutting-edge|best-in-class|world-class|next-generation|paradigm shift|game-changer|holistic|scalable solution|robust|seamless|turnkey|end-to-end|mission-critical)\b/i;

const CLICHES =
  /\b(at the end of the day|think outside the box|move the needle|boil the ocean|low-hanging fruit|drink the kool-aid|circle back|bandwidth|drill down|touch base)\b/i;

const EMPTY_ADJECTIVES =
  /\b(amazing|incredible|awesome|great|wonderful|fantastic|excellent|outstanding|remarkable|extraordinary|exceptional|phenomenal)\b/i;

const FAKE_URGENCY =
  /\b(act now|limited time|don't miss out|hurry|last chance|while supplies last|exclusive offer|today only|ends soon|before it's too late)\b/i;

const STOCK_OPENERS =
  /^(in today's|as we all know|it's no secret|let's face it|picture this|imagine a world|have you ever wondered|did you know)/i;

const VAGUE_CLAIMS =
  /\b(many people|studies show|experts say|research suggests|some say|it is said|generally speaking|most of the time|typically|often)\b/i;

const PASSIVE_VOICE_G = /\b(?:was|were|been|being|is|are)\s+\w+(?:ed|en)\b/gi;

const PERSONAL_VOICE = /\b(I|my|me|we|our|us)\b/;

const SPECIFIC_EXAMPLES =
  /(\d+(?:\.\d+)?%|\$\d|\d{2,}|\b\d+\s+(users|customers|days|weeks|months|years|companies|hours)\b)/i;

const EVIDENCE_MARKERS =
  /\b(according to|data from|report by|published in|survey of|case study|benchmark|measured|tracked|observed|documented)\b/i;

const RULES: readonly SignalRule[] = [
  {
    name: 'ai_phrases',
    detect: (t) => AI_PHRASES.test(t),
    note: 'Contains phrases characteristic of AI-generated text.',
  },
  {
    name: 'buzzwords',
    detect: (t) => BUZZWORDS.test(t),
    note: 'Uses marketing buzzwords that signal generic content.',
  },
  {
    name: 'clichés',
    detect: (t) => CLICHES.test(t),
    note: 'Contains overused business clichés.',
  },
  {
    name: 'empty_adjectives',
    detect: (t) => EMPTY_ADJECTIVES.test(t),
    note: 'Uses vague superlatives that carry no information.',
  },
  {
    name: 'fake_urgency',
    detect: (t) => FAKE_URGENCY.test(t),
    note: 'Uses manufactured urgency phrases typical of sales copy.',
  },
  {
    name: 'stock_opener',
    detect: (t) => STOCK_OPENERS.test(t.trim()),
    note: 'Opens with a stock/boilerplate phrase.',
  },
  {
    name: 'vague_claims',
    detect: (t) => VAGUE_CLAIMS.test(t),
    note: 'Makes vague claims without sourcing.',
  },
  {
    name: 'passive_voice',
    detect: (t) => (t.match(PASSIVE_VOICE_G)?.length ?? 0) >= 3,
    note: 'Heavy use of passive voice (3+ instances).',
  },
  {
    name: 'long_sentences',
    detect: (t) => {
      const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 0);
      return sentences.some((s) => s.trim().split(/\s+/).length > 35);
    },
    note: 'Contains sentences over 35 words.',
  },
  {
    name: 'missing_evidence',
    detect: (t) =>
      t.trim().length > 80 && !SPECIFIC_EXAMPLES.test(t) && !EVIDENCE_MARKERS.test(t),
    note: 'No concrete numbers, data, or sources.',
  },
  {
    name: 'specific_examples',
    detect: (t) => t.trim().length > 40 && !SPECIFIC_EXAMPLES.test(t),
    note: 'No specific numbers, metrics, or named entities.',
  },
  {
    name: 'personal_voice',
    detect: (t) => t.trim().length > 40 && !PERSONAL_VOICE.test(t),
    note: 'No first-person voice — reads detached.',
  },
];

const DEDUCTION_PER_SIGNAL = 8;

export class AuthenticityAudit {
  audit(text: string): AuthenticityScore {
    const signals: AuthenticitySignal[] = RULES.map((rule) => {
      const detected = rule.detect(text);
      return {
        name: rule.name,
        detected,
        notes: detected ? rule.note : undefined,
      };
    });

    const detectedCount = signals.filter((s) => s.detected).length;
    const overall = Math.max(0, 100 - detectedCount * DEDUCTION_PER_SIGNAL);

    return {
      overall,
      signals,
      verdict: verdictFor(overall, signals),
    };
  }
}

function verdictFor(
  overall: number,
  signals: readonly AuthenticitySignal[],
): AuthenticityVerdict {
  const hits = new Set(signals.filter((s) => s.detected).map((s) => s.name));

  if (hits.has('ai_phrases') && overall < 75) return 'ai_tell';
  if (hits.has('fake_urgency') || (hits.has('buzzwords') && hits.has('empty_adjectives'))) {
    return 'salesy';
  }
  if (overall >= 80) return 'authentic';
  return 'generic';
}
