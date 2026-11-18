import { useEffect, useRef, useState } from "react";
import type { CadUnderlayView, DocumentView } from "@datamine/contracts";

type PdfPageView = Pick<DocumentView, "page_index" | "page_width_pt" | "page_height_pt" | "page_rotation_deg">
  | (Pick<CadUnderlayView, "page_index" | "page_width_pt" | "page_height_pt"> & { readonly page_rotation_deg?: 0 });

interface PdfUnderlayProps {
  readonly documentView: PdfPageView;
  readonly url?: string;
  readonly visible: boolean;
}

type UnderlayState = "unavailable" | "loading" | "ready" | "error";
const MAX_PDF_PIXEL_RATIO = 2;

export function PdfUnderlay({ documentView, url, visible }: PdfUnderlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<UnderlayState>(url ? "loading" : "unavailable");
  const [sheetSize, setSheetSize] = useState({ width: 1, height: 1 });
  const [sourcePageSize, setSourcePageSize] = useState({ width: documentView.page_width_pt, height: documentView.page_height_pt });

  useEffect(() => {
    setSourcePageSize({ width: documentView.page_width_pt, height: documentView.page_height_pt });
  }, [documentView.page_height_pt, documentView.page_width_pt]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const resize = () => {
      const scale = Math.min(
        container.clientWidth / sourcePageSize.width,
        container.clientHeight / sourcePageSize.height,
      );
      setSheetSize({
        width: Math.max(1, Math.floor(sourcePageSize.width * scale)),
        height: Math.max(1, Math.floor(sourcePageSize.height * scale)),
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => observer.disconnect();
  }, [sourcePageSize.height, sourcePageSize.width]);

  useEffect(() => {
    if (!url) {
      setState("unavailable");
      return;
    }
    if (!visible) {
      return;
    }
    const pdfUrl = new URL(url, window.location.href);
    const sameOriginContentRoute = pdfUrl.origin === window.location.origin
      && pdfUrl.pathname.startsWith("/v2/projects/")
      && pdfUrl.pathname.endsWith("/content");
    const verifiedLocalBlob = pdfUrl.protocol === "blob:" && pdfUrl.origin === window.location.origin;
    if (!sameOriginContentRoute && !verifiedLocalBlob) {
      setState("error");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    let cancelled = false;
    let frame = 0;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let loadingTask: { destroy: () => Promise<void> } | undefined;
    let renderPage: (() => void) | undefined;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => renderPage?.());
    });
    observer.observe(canvas.parentElement ?? canvas);
    setState("loading");

    void import("pdfjs-dist")
      .then(async (pdfjs) => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();
        const task = pdfjs.getDocument({
          url: pdfUrl.toString(),
          enableXfa: false,
          stopAtErrors: true,
          useWorkerFetch: true,
        });
        loadingTask = task;
        const loadedPdf = await task.promise;
        const page = await loadedPdf.getPage(documentView.page_index + 1);
        const unitViewport = page.getViewport({
          scale: 1,
          rotation: documentView.page_rotation_deg ?? 0,
        });
        if (!verifiedLocalBlob && (
          Math.abs(unitViewport.width - documentView.page_width_pt) > 0.5
          || Math.abs(unitViewport.height - documentView.page_height_pt) > 0.5
        )) {
          throw new Error("PDF stránka neodpovídá verzované kalibraci.");
        }
        if (verifiedLocalBlob) setSourcePageSize({ width: unitViewport.width, height: unitViewport.height });
        renderPage = () => {
          if (cancelled) {
            return;
          }
          renderTask?.cancel();
          const cssWidth = Math.max(1, canvas.clientWidth);
          const cssScale = cssWidth / unitViewport.width;
          const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PDF_PIXEL_RATIO);
          const viewport = page.getViewport({
            scale: cssScale * pixelRatio,
            rotation: documentView.page_rotation_deg ?? 0,
          });
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) {
            throw new Error("PDF canvas není dostupný.");
          }
          const currentTask = page.render({ canvas, canvasContext: context, viewport });
          renderTask = currentTask;
          void currentTask.promise.then(
            () => { if (!cancelled) setState("ready"); },
            (error: unknown) => {
              if (!cancelled && !(error instanceof Error && error.name === "RenderingCancelledException")) {
                setState("error");
              }
            },
          );
        };
        renderPage();
      })
      .catch(() => {
        if (!cancelled) {
          setState("error");
        }
      });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderTask?.cancel();
      void loadingTask?.destroy();
    };
  }, [documentView, url, visible]);

  return (
    <div ref={containerRef} className="v2-pdf-underlay" hidden={!visible} data-state={state}>
      <canvas ref={canvasRef} className="v2-pdf-canvas" style={sheetSize} aria-label="PDF podklad výkresu" />
      {state !== "ready" ? (
        <p className="v2-pdf-state" role={state === "error" ? "alert" : "status"}>
          {state === "loading" ? "Načítám PDF podklad…" : null}
          {state === "unavailable" ? "PDF podklad není v ukázce připojen." : null}
          {state === "error" ? "PDF podklad se nepodařilo bezpečně načíst." : null}
        </p>
      ) : null}
    </div>
  );
}
