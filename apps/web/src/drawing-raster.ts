export interface DrawingRaster {
  readonly source_name: string;
  readonly page_number: number | null;
  readonly pixel_width: number;
  readonly pixel_height: number;
  readonly image_data_url: string;
  readonly image: HTMLImageElement;
}

/** Read only local bytes. PDF actions, annotations, links and XFA are not executed. */
export async function rasterizeDrawing(file: File, pageNumber: number, signal: AbortSignal): Promise<DrawingRaster> {
  const pdf = /\.pdf$/i.test(file.name), bitmap = /\.(png|jpe?g)$/i.test(file.name);
  if ((!pdf && !bitmap) || !file.size || file.size > (pdf ? 50 : 10) * 1024 * 1024) throw new Error("Použijte PDF do 50 MB nebo PNG/JPEG do 10 MB.");
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 1000) throw new Error("Číslo stránky musí být 1 až 1000.");
  const canvas = document.createElement("canvas");
  const drawing = canvas.getContext("2d", { alpha: false });
  if (!drawing) throw new Error("Náhled výkresu není dostupný.");
  if (pdf) {
    const pdfjs = await import("pdfjs-dist");
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const data = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    const task = pdfjs.getDocument({ data, enableXfa: false, stopAtErrors: true });
    const cancel = () => { void task.destroy(); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const document = await task.promise;
      if (pageNumber > document.numPages) throw new Error(`PDF má pouze ${document.numPages} stran.`);
      const page = await document.getPage(pageNumber);
      const original = page.getViewport({ scale: 1 });
      if (![original.width, original.height].every((n) => Number.isFinite(n) && n > 0)) throw new Error("PDF má neplatné rozměry.");
      const viewport = page.getViewport({ scale: 2048 / Math.max(original.width, original.height) });
      canvas.width = Math.min(2048, Math.ceil(viewport.width)); canvas.height = Math.min(2048, Math.ceil(viewport.height));
      await page.render({ canvas, canvasContext: drawing, viewport }).promise;
    } finally { signal.removeEventListener("abort", cancel); await task.destroy(); }
  } else {
    const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    const png = bytes.join(",") === "137,80,78,71,13,10,26,10";
    if (!jpeg && !png) throw new Error("Soubor není skutečný PNG ani JPEG.");
    const url = URL.createObjectURL(new Blob([file], { type: jpeg ? "image/jpeg" : "image/png" }));
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (image.width * image.height > 40_000_000) throw new Error("Obrázek smí mít nejvýše 40 milionů pixelů.");
      const scale = Math.min(1, 2048 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      drawing.fillStyle = "white"; drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    } finally { URL.revokeObjectURL(url); }
  }
  signal.throwIfAborted();
  if (canvas.width < 16 || canvas.height < 16) throw new Error("Podklad je příliš malý nebo úzký.");
  let image_data_url = canvas.toDataURL("image/jpeg", 0.9);
  if (image_data_url.length > 2_000_000) image_data_url = canvas.toDataURL("image/jpeg", 0.75);
  if (image_data_url.length > 2_000_000) throw new Error("Podklad je příliš podrobný pro uložení; vyberte menší výřez.");
  const image = new Image(); image.src = image_data_url; await image.decode();
  signal.throwIfAborted();
  return { source_name: file.name.normalize("NFC").replace(/[<>/\\\u0000-\u001f\u007f]/g, "_").slice(0, 180),
    page_number: pdf ? pageNumber : null, pixel_width: canvas.width, pixel_height: canvas.height, image_data_url, image };
}
