// ─── PDF parser (Phase 15 Track K) ───
//
// Thin wrapper over `pdf-parse` (optional peer dep). Activates when
// the package is installed in the deployment image. Absent → throws
// MultimodalError{code:'not_installed'} so callers can fall back to
// a manual upload flow.

export interface PdfParseResult {
  /** Extracted plain-text content of every page concatenated. */
  text: string;
  /** Total page count. */
  pageCount: number;
  /** PDF metadata dictionary (Title / Author / Creator / Producer). */
  info: {
    title?: string;
    author?: string;
    creator?: string;
    producer?: string;
  };
  /** First N characters preview for display in the agent context. */
  preview: string;
}

export class MultimodalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_installed'
      | 'invalid_input'
      | 'parse_failed'
      | 'vision_failed' = 'parse_failed',
  ) {
    super(message);
    this.name = 'MultimodalError';
  }
}

interface PdfParseModule {
  default?: (data: Buffer | Uint8Array) => Promise<{
    text?: string;
    numpages?: number;
    info?: Record<string, unknown>;
  }>;
}

let cachedModule: PdfParseModule | null | undefined;

async function loadPdfParseModule(): Promise<PdfParseModule | null> {
  if (cachedModule !== undefined) return cachedModule;
  try {
    cachedModule =
      ((await import('pdf-parse' as string).catch(
        () => null,
      )) as PdfParseModule | null) ?? null;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * Parse a PDF buffer into plain text + metadata.
 *
 * @param bytes       Raw PDF bytes (Uint8Array preferred — also accepts Buffer).
 * @param previewChars Cap on the preview field (default 2000).
 */
export async function parsePdf(
  bytes: Uint8Array | Buffer,
  opts?: { previewChars?: number },
): Promise<PdfParseResult> {
  if (!bytes || bytes.byteLength === 0) {
    throw new MultimodalError('Empty PDF input', 'invalid_input');
  }
  const mod = await loadPdfParseModule();
  if (!mod?.default) {
    throw new MultimodalError(
      '`pdf-parse` is not installed in this deployment. Install it to enable PDF ingestion.',
      'not_installed',
    );
  }
  let raw: { text?: string; numpages?: number; info?: Record<string, unknown> };
  try {
    raw = await mod.default(bytes instanceof Buffer ? bytes : Buffer.from(bytes));
  } catch (err) {
    throw new MultimodalError(
      `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`,
      'parse_failed',
    );
  }
  const text = String(raw.text ?? '');
  const previewChars = Math.max(1, opts?.previewChars ?? 2000);
  const info = (raw.info ?? {}) as Record<string, unknown>;
  return {
    text,
    pageCount: Number(raw.numpages ?? 0),
    info: {
      title: info['Title'] != null ? String(info['Title']) : undefined,
      author: info['Author'] != null ? String(info['Author']) : undefined,
      creator: info['Creator'] != null ? String(info['Creator']) : undefined,
      producer: info['Producer'] != null ? String(info['Producer']) : undefined,
    },
    preview: text.slice(0, previewChars),
  };
}

/**
 * Decode a base64-encoded PDF and parse it. Convenience wrapper for
 * the `parse_pdf` tool whose input arrives as a base64 string.
 */
export async function parsePdfBase64(
  base64: string,
  opts?: { previewChars?: number },
): Promise<PdfParseResult> {
  if (typeof base64 !== 'string' || base64.length === 0) {
    throw new MultimodalError('base64 PDF input required', 'invalid_input');
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch (err) {
    throw new MultimodalError(
      `Invalid base64: ${err instanceof Error ? err.message : String(err)}`,
      'invalid_input',
    );
  }
  return parsePdf(bytes, opts);
}
