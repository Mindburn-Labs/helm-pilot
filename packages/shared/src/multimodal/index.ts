// ─── Multimodal public surface (Phase 15 Track K) ───
//
// Import example:
//   import { parsePdfBase64, analyzeImage, MultimodalError } from '@helm-pilot/shared/multimodal';

export {
  parsePdf,
  parsePdfBase64,
  MultimodalError,
  type PdfParseResult,
} from './pdf.js';

export {
  analyzeImage,
  type ImageAnalysis,
  type AnalyzeImageParams,
  type ImageMediaType,
} from './vision.js';
