// Reads an image's text with QVAC OCR on this phone: load, read, unload. The OCR model never stays loaded,
// since the chat model, EmbeddingGemma and Whisper already hold the memory. The caller runs it on the load chain,
// so it never loads at the same time as another model.
import { loadModel, ocr, unloadModel, OCR_LATIN } from '@qvac/sdk';

const OCR_TIMEOUT_MS = 60_000;

// `path` is a plain file path to a JPEG, PNG or BMP (see receiptPath). Blocks come back top to bottom, one line each.
export async function readImageText(path: string): Promise<string> {
  // OCR_LATIN's CRAFT detector (about 83 MB) is derived from the registry with it; the first read downloads both.
  const modelId = await loadModel({ modelSrc: OCR_LATIN, modelConfig: { langList: ['en'] } });
  try {
    // A hung read would hold the load chain, and with it every later model load: give up after 60 s.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blocks = await Promise.race([ocr({ modelId, image: path, options: { paragraph: false } }).blocks,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('the OCR took over 60 s')), OCR_TIMEOUT_MS); })])
      .finally(() => clearTimeout(timer));
    return blocks.map(block => block.text).join('\n');
  } finally {
    // Not caught: an OCR model left loaded is a memory problem the chat must show, even over a read error.
    await unloadModel({ modelId, clearStorage: false });
  }
}
