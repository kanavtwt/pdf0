import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import { encryptPDF as encryptPDFBytes } from "@pdfsmaller/pdf-encrypt-lite";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

export async function mergePDFs(files: File[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return await mergedPdf.save();
}

export async function extractPages(
  file: File,
  pageIndices: number[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  const newPdf = await PDFDocument.create();

  const pages = await newPdf.copyPages(pdf, pageIndices);
  pages.forEach((page) => newPdf.addPage(page));

  return await newPdf.save();
}

export async function rotatePDF(
  file: File,
  rotation: 90 | 180 | 270,
  pageIndices?: number[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  const pages = pdf.getPages();

  const indicesToRotate = pageIndices || pages.map((_, i) => i);

  indicesToRotate.forEach((index) => {
    if (index >= 0 && index < pages.length) {
      const page = pages[index];
      // Add rotation to existing page rotation
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + rotation));
    }
  });

  return await pdf.save();
}

export async function compressPDF(file: File): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);

  // Remove metadata to reduce size
  pdf.setTitle("");
  pdf.setAuthor("");
  pdf.setSubject("");
  pdf.setKeywords([]);
  pdf.setProducer("");
  pdf.setCreator("");

  return await pdf.save({
    useObjectStreams: true,
    addDefaultPage: false,
  });
}

export async function addWatermark(
  file: File,
  text: string,
  options?: {
    fontSize?: number;
    opacity?: number;
    rotation?: number;
  }
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  const pages = pdf.getPages();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);

  const fontSize = options?.fontSize || 48;
  const opacity = options?.opacity || 0.3;
  const rotation = options?.rotation || -45;

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      opacity,
      rotate: degrees(rotation),
    });
  });

  return await pdf.save();
}

export async function organizePDF(
  file: File,
  pageOrder: {
    originalIndex: number;
    rotation: 0 | 90 | 180 | 270;
  }[]
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await PDFDocument.load(arrayBuffer);
  const newPdf = await PDFDocument.create();

  // Copy pages in the specified order
  for (const { originalIndex, rotation } of pageOrder) {
    const [copiedPage] = await newPdf.copyPages(pdf, [originalIndex]);
    
    if (rotation !== 0) {
      // Add rotation to existing page rotation
      const currentRotation = copiedPage.getRotation().angle;
      copiedPage.setRotation(degrees(currentRotation + rotation));
    }
    
    newPdf.addPage(copiedPage);
  }

  return await newPdf.save();
}

export async function imagesToPDF(files: File[]): Promise<{ pdf: Uint8Array; skippedFiles: string[] }> {
  const pdf = await PDFDocument.create();
  const skippedFiles: string[] = [];

  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    let image;

    if (file.type === "image/png") {
      image = await pdf.embedPng(arrayBuffer);
    } else if (file.type === "image/jpeg" || file.type === "image/jpg") {
      image = await pdf.embedJpg(arrayBuffer);
    } else {
      skippedFiles.push(file.name);
      continue;
    }

    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  return { pdf: await pdf.save(), skippedFiles };
}

export async function htmlToPDF(
  htmlContent: string,
  options?: {
    filename?: string;
    format?: "a4" | "letter";
    orientation?: "portrait" | "landscape";
    maxHeightPerPage?: number; // Maximum height per page in PDF units (mm or inches)
  }
): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new Error("HTML to PDF conversion must be performed in a browser environment");
  }

  // Create an isolated iframe to prevent HTML content from affecting the main page
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.left = "-9999px";
  iframe.style.top = "0";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "none";
  iframe.style.visibility = "hidden";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    document.body.removeChild(iframe);
    throw new Error("Failed to create iframe for HTML rendering");
  }

  try {
    // Set up iframe document
    const isLetter = options?.format === "letter";
    const margin = 0; // No margin by default
    // A4: 210mm = 794px at 96dpi (210 / 25.4 * 96 = 794.33)
    // Letter: 8.5in = 816px at 96dpi
    const pageWidthPx = isLetter ? 816 : 794; // Exact A4 width at 96dpi
    const pageHeightPx = isLetter ? 1056 : 1123; // A4 height at 96dpi (297 / 25.4 * 96 = 1122.52)
    
    // Check if HTML content already has <html> or <body> tags
    const hasHtmlTags = /<html[\s>]|<body[\s>]/i.test(htmlContent);
    
    if (hasHtmlTags) {
      // If HTML already has structure, inject it directly but ensure proper sizing
      iframeDoc.open();
      iframeDoc.write(htmlContent);
      iframeDoc.close();
      
      // Wait for content to load
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      // Inject additional styles to ensure proper rendering
      // Don't force width if HTML already has A4 dimensions defined
      const style = iframeDoc.createElement("style");
      style.textContent = `
        html {
          width: ${pageWidthPx}px;
          max-width: ${pageWidthPx}px;
        }
        body {
          width: ${pageWidthPx}px;
          max-width: ${pageWidthPx}px;
          min-width: ${pageWidthPx}px;
          padding: ${margin}px !important;
          margin: 0 !important;
          background: #ffffff !important;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
          line-height: 1.5 !important;
          box-sizing: border-box;
        }
        * {
          box-sizing: border-box;
        }
        p, div, span, h1, h2, h3, h4, h5, h6 {
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
      `;
      iframeDoc.head.appendChild(style);
    } else {
      // If just HTML fragment, wrap it properly
      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              * {
                box-sizing: border-box;
              }
              body {
                width: ${pageWidthPx}px;
                max-width: ${pageWidthPx}px;
                min-height: ${pageHeightPx}px;
                padding: ${margin}px;
                margin: 0;
                background: #ffffff;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                font-size: 16px;
                line-height: 1.5;
                color: #000000;
              }
              p, div, span, h1, h2, h3, h4, h5, h6, li, td, th {
                word-wrap: break-word;
                overflow-wrap: break-word;
                white-space: normal;
              }
              p {
                margin: 1em 0;
              }
              h1, h2, h3, h4, h5, h6 {
                margin: 0.5em 0;
              }
              br {
                line-height: 1.5;
              }
              img {
                max-width: 100%;
                height: auto;
              }
            </style>
          </head>
          <body>
            ${htmlContent}
          </body>
        </html>
      `);
      iframeDoc.close();
    }

    // Wait for fonts and images to load
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    // Wait for any external resources
    if (iframeDoc.readyState === "loading") {
      await new Promise((resolve) => {
        iframeDoc.addEventListener("DOMContentLoaded", resolve, { once: true });
        setTimeout(resolve, 1000); // Fallback timeout
      });
    }

    // Get the body element from iframe
    const bodyElement = iframeDoc.body;
    if (!bodyElement) {
      throw new Error("Failed to access iframe body");
    }

    // Use html2canvas to capture the HTML as an image
    // Scale 2 means 2x resolution, so canvas will be 2x the size
    const html2canvasScale = 2;
    const canvas = await html2canvas(bodyElement, {
      useCORS: true,
      logging: false,
      background: "#ffffff",
      allowTaint: false,
      width: pageWidthPx,
      height: bodyElement.scrollHeight || pageHeightPx,
      letterRendering: true, // Better text rendering
    });

    // Get dimensions in mm (for A4) or inches (for Letter)
    const marginInUnit = isLetter ? margin / 96 : margin * 0.264583; // Convert px to mm
    const pageWidth = isLetter ? 8.5 : 210; // inches or mm
    const pageHeight = isLetter ? 11 : 297; // inches or mm
    const availableWidth = pageWidth - marginInUnit * 2;
    const availableHeight = pageHeight - marginInUnit * 2;

    // Create PDF using jsPDF
    const pdf = new jsPDF({
      orientation: options?.orientation === "landscape" ? "landscape" : "portrait",
      unit: isLetter ? "in" : "mm",
      format: isLetter ? "letter" : "a4",
    });

    // Convert canvas dimensions to PDF units
    // IMPORTANT: canvas is scaled by html2canvasScale (2x), so we need to divide by it
    // to get the actual HTML pixel dimensions, then convert to PDF units
    const actualHtmlWidthPx = canvas.width / html2canvasScale;
    const actualHtmlHeightPx = canvas.height / html2canvasScale;
    
    // Convert actual HTML pixels to PDF units (mm or inches)
    // At 96 DPI: 1px = 0.264583mm (1 inch = 25.4mm, 1 inch = 96px, so 1px = 25.4/96 = 0.264583mm)
    const canvasWidthInUnit = isLetter 
      ? actualHtmlWidthPx / 96  // Convert px to inches (1px = 1/96 inch at 96dpi)
      : actualHtmlWidthPx * 0.264583; // Convert px to mm
    const canvasHeightInUnit = isLetter
      ? actualHtmlHeightPx / 96
      : actualHtmlHeightPx * 0.264583;

    // For A4 HTML designed at 210mm, canvasWidthInUnit should be ~210mm
    // Scale to fit FULL width (no centering, fill entire width)
    const widthScale = availableWidth / canvasWidthInUnit;
    const scale = widthScale; // Use full width scale

    const imgWidth = availableWidth; // Always full width
    const imgHeight = canvasHeightInUnit * scale; // Height scales proportionally

    // Use user-defined maxHeightPerPage or default to availableHeight
    // maxHeightPerPage is already in PDF units (mm or inches)
    const maxContentHeight = options?.maxHeightPerPage && options.maxHeightPerPage > 0
      ? Math.min(options.maxHeightPerPage, availableHeight)
      : availableHeight;

    // Calculate how many pages we need
    const totalPages = Math.ceil(imgHeight / maxContentHeight);

    if (totalPages === 1) {
      // Single page - add image at full width
      const imgData = canvas.toDataURL("image/png", 0.95);
      pdf.addImage(imgData, "PNG", marginInUnit, marginInUnit, imgWidth, imgHeight, undefined, "FAST");
    } else {
      // Multi-page - split content across pages
      // Calculate how much source height corresponds to maxContentHeight
      const sourceHeightForMaxContent = (maxContentHeight / imgHeight) * canvas.height;

      for (let page = 0; page < totalPages; page++) {
        if (page > 0) {
          pdf.addPage();
        }

        // Calculate the slice for this page
        const sourceY = page * sourceHeightForMaxContent;
        const sourceHeight = Math.min(sourceHeightForMaxContent, canvas.height - sourceY);
        const actualImgHeight = Math.min(maxContentHeight, imgHeight - page * maxContentHeight);

        // Create a canvas for this page slice
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sourceHeight;
        const ctx = pageCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(
            canvas,
            0,
            sourceY,
            canvas.width,
            sourceHeight,
            0,
            0,
            canvas.width,
            sourceHeight
          );
        }

        const pageImgData = pageCanvas.toDataURL("image/png", 0.95);
        pdf.addImage(pageImgData, "PNG", marginInUnit, marginInUnit, imgWidth, actualImgHeight, undefined, "FAST");
      }
    }

    // Clean up
    if (iframe.parentNode) {
      document.body.removeChild(iframe);
    }

    // Convert to Uint8Array
    const pdfBlob = pdf.output("arraybuffer");
    return new Uint8Array(pdfBlob);
  } catch (error: any) {
    // Clean up on error
    if (iframe.parentNode) {
      document.body.removeChild(iframe);
    }
    throw new Error(`Failed to convert HTML to PDF: ${error.message || "Unknown error"}`);
  }
}

export function downloadPDF(data: Uint8Array, filename: string) {
  const blob = new Blob([data as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadImage(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export interface EncryptionOptions {
  userPassword: string;
  ownerPassword?: string;
  permissions?: {
    printing?: "lowResolution" | "highResolution" | "none";
    modifying?: boolean;
    copying?: boolean;
    annotating?: boolean;
    fillingForms?: boolean;
    contentAccessibility?: boolean;
    documentAssembly?: boolean;
  };
}

export async function encryptPDF(
  file: File,
  options: EncryptionOptions
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfBytes = new Uint8Array(arrayBuffer);
  
  // Use @pdfsmaller/pdf-encrypt-lite for encryption
  // This library preserves all PDF content including metadata automatically
  // API: encryptPDF(pdfBytes, userPassword, ownerPassword?)
  const ownerPwd = options.ownerPassword || options.userPassword;
  
  try {
    const encryptedBytes = await encryptPDFBytes(
      pdfBytes,
      options.userPassword,
      ownerPwd
    );
    
    // Verify encryption worked
    if (encryptedBytes.length === 0) {
      throw new Error("Encryption failed - empty result");
    }
    
    return encryptedBytes;
  } catch (error: any) {
    throw new Error(`Failed to encrypt PDF: ${error.message || "Unknown error"}`);
  }
}

export async function decryptPDF(
  file: File,
  password: string
): Promise<Uint8Array> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Use PDF.js to decrypt and read the encrypted PDF
  // PDF.js properly supports password-protected PDFs
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
  
  let pdfDoc: any;
  try {
    // Load encrypted PDF with password using PDF.js
    pdfDoc = await pdfjsLib.getDocument({ 
      data: arrayBuffer,
      password: password 
    }).promise;
  } catch (error: any) {
    const errorMsg = (error?.message || String(error)).toLowerCase();
    if (errorMsg.includes("password") || errorMsg.includes("incorrect") || errorMsg.includes("authentication") || errorMsg.includes("encrypted")) {
      throw new Error("Incorrect password. Please verify the password and try again.");
    }
    throw new Error(`Failed to decrypt PDF: ${error?.message || "Unknown error"}`);
  }

  // Now use pdf-lib to rebuild the PDF without encryption
  // Render each page and recreate to preserve content
  const newPdf = await PDFDocument.create();
  const numPages = pdfDoc.numPages;

  // Copy pages by rendering and recreating
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 });

    // Render page to canvas
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) continue;

    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Convert canvas to image and embed in new PDF
    const imageData = canvas.toDataURL("image/png");
    const imageBytes = await fetch(imageData).then(res => res.arrayBuffer());
    const image = await newPdf.embedPng(imageBytes);
    
    const pdfPage = newPdf.addPage([viewport.width, viewport.height]);
    pdfPage.drawImage(image, {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
  }

  // Save without encryption
  return await newPdf.save({
    useObjectStreams: true,
  });
}