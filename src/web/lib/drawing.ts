// Turns an uploaded floor drawing (PDF page or image) into a JPEG that fits the
// photo size limit, so it syncs and works offline like any other photo.
import { MAX_PHOTO_BYTES } from '../../core/sync.ts';

export interface Drawing {
  blob: Blob;
  width: number;
  height: number;
  /** Pages in the PDF (1 for images). */
  pages: number;
}

const MAX_SIDE = 4000;

export function drawingKind(file: File): 'pdf' | 'image' | 'cad' | 'other' {
  const n = file.name.toLowerCase();
  if (file.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type) || /\.(png|jpe?g|webp|gif|bmp)$/.test(n)) return 'image';
  if (/\.(dwg|dxf|dwf)$/.test(n)) return 'cad';
  return 'other';
}

/** Encode a canvas as JPEG, stepping quality and size down until it fits the limit. */
async function fit(canvas: HTMLCanvasElement): Promise<{ blob: Blob; width: number; height: number }> {
  let c = canvas;
  for (let round = 0; round < 6; round++) {
    for (const q of [0.82, 0.7, 0.6]) {
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= MAX_PHOTO_BYTES) return { blob, width: c.width, height: c.height };
    }
    // Still too big: shrink by 20% and try again.
    const next = document.createElement('canvas');
    next.width = Math.round(c.width * 0.8);
    next.height = Math.round(c.height * 0.8);
    const g = next.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, 0, 0, next.width, next.height);
    c = next;
  }
  throw new Error('Чертежът е твърде голям дори след смаляване.');
}

function whiteCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  return { c, g };
}

export async function loadDrawing(file: File, page = 1): Promise<Drawing> {
  const kind = drawingKind(file);
  if (kind === 'cad') throw new Error('DWG/DXF не може да се отвори в браузъра. Запиши чертежа като PDF (в AutoCAD или безплатния DWG TrueView: Print → PDF) и качи PDF-а.');
  if (kind === 'other') throw new Error('Поддържат се PDF и снимки (PNG, JPG).');
  if (kind === 'image') {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const { c, g } = whiteCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
    g.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    return { ...(await fit(c)), pages: 1 };
  }
  // PDF: pdf.js is loaded only here, the first time a PDF is opened.
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const p = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
    const base = p.getViewport({ scale: 1 });
    const scale = Math.min(6, MAX_SIDE / Math.max(base.width, base.height));
    const vp = p.getViewport({ scale });
    const { c, g } = whiteCanvas(Math.floor(vp.width), Math.floor(vp.height));
    await p.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
    return { ...(await fit(c)), pages: doc.numPages };
  } finally {
    await task.destroy();
  }
}
