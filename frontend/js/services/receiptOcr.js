// ============================================================
// Receipt OCR Service — Local-First Client-Side Receipt Extraction
// ============================================================
// Uses Tesseract.js (loaded via CDN) and HTML5 Canvas preprocessing.
// ALL processing runs locally in browser Web Workers. No receipt
// images or financial data leave the device.
// ============================================================

/**
 * Common merchant keyword lookup for auto-categorization
 */
const MERCHANT_CAT_MAP = [
  { regex: /supermarket|grocery|mart|hypermarket|fresh|kirana|provisions|nilgiris|dmart|bigbasket|blinkit|zepto|spencer|reliance fresh|more retail/i, cat: 'grocery' },
  { regex: /restaurant|cafe|coffee|bistro|kitchen|bakery|hotel|dhaba|biryani|pizza|burger|swiggy|zomato|starbucks|mcdonald|kfc|domino|subway|chai/i, cat: 'food' },
  { regex: /pharmacy|medical|chemist|health|hospital|clinic|diagnostics|apollo|medplus|netmeds|1mg/i, cat: 'health' },
  { regex: /fuel|petrol|diesel|gas|hpcl|bpcl|iocl|shell|indian oil|uber|ola|rapido|metro|railway|irctc|parking|toll/i, cat: 'transport' },
  { regex: /electricity|water|broadband|airtel|jio|vi|bescom|tneb|gas bill|recharge|dth/i, cat: 'bills' },
  { regex: /clothing|apparel|fashion|footwear|mall|zara|h&m|trends|max|westside|lifestyle|myntra|amazon|flipkart/i, cat: 'shopping' },
  { regex: /cinema|theatre|movies|pvr|inox|cinepolis|game|entertainment|bookmyshow/i, cat: 'entertainment' },
  { regex: /salon|spa|parlour|beauty|grooming|gym|fitness/i, cat: 'personal' },
];

/**
 * Preprocess image with HTML5 Canvas to optimize Tesseract OCR accuracy.
 * Enhances contrast, converts to grayscale, and downscales if excessively large.
 * @param {Blob|File} file
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function preprocessReceiptImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        // Maintain high resolution for receipt clarity, max dimension 1600px
        const maxDim = 1600;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;

        // Draw original
        ctx.drawImage(img, 0, 0, width, height);

        // Get image pixel data for contrast enhancement & binarization/grayscale
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;

        // Contrast boost factor
        const contrast = 1.25;
        const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

        for (let i = 0; i < data.length; i += 4) {
          // Grayscale luminance conversion (Rec 709)
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          let gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;

          // Apply contrast
          gray = factor * (gray - 128) + 128;
          gray = Math.max(0, Math.min(255, gray));

          data[i] = gray;
          data[i + 1] = gray;
          data[i + 2] = gray;
        }

        ctx.putImageData(imgData, 0, 0);
        resolve(canvas);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for OCR'));
    };

    img.src = url;
  });
}

/**
 * Execute client-side OCR on canvas or image using Tesseract.js.
 * @param {HTMLCanvasElement|Blob|File} imageSource
 * @param {function({status: string, progress: number}): void} [onProgress]
 * @returns {Promise<string>}
 */
export async function runOcr(imageSource, onProgress = null) {
  if (!window.Tesseract) {
    throw new Error('OCR engine (Tesseract.js) is not loaded');
  }

  const { data } = await window.Tesseract.recognize(
    imageSource,
    'eng',
    {
      logger: m => {
        if (onProgress && m.status) {
          onProgress({
            status: m.status,
            progress: typeof m.progress === 'number' ? Math.round(m.progress * 100) : 0,
          });
        }
      },
    }
  );

  return data.text || '';
}

/**
 * Parse raw OCR text into structured financial transaction fields.
 * Deterministic heuristics tuned for Indian retail & restaurant receipts.
 * @param {string} text
 * @returns {{
 *   merchant: string,
 *   amount: number,
 *   date: string,
 *   paymentMethod: string,
 *   category: string,
 *   gstin: string|null,
 *   rawText: string
 * }}
 */
export function parseReceiptText(text) {
  const cleanText = text || '';
  const lines = cleanText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  // 1. Extract GSTIN (15-char standard Indian GST identifier)
  let gstin = null;
  const gstinMatch = cleanText.match(/\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}Z[A-Z\d]{1}\b/i);
  if (gstinMatch) {
    gstin = gstinMatch[0].toUpperCase();
  }

  // 2. Extract Merchant Name
  // Heuristic: Scrutinize the first 4 non-trivial lines, ignoring common noise words
  let merchant = '';
  const noiseWords = /^(tax invoice|cash receipt|invoice|bill|receipt|original|duplicate|welcome|retail invoice|date|tel|phone|gstin|gst)/i;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const line = lines[i];
    if (line.length >= 3 && !noiseWords.test(line) && !/^\d+$/.test(line)) {
      merchant = line.replace(/[^a-zA-Z0-9\s&'.,-]/g, '').trim();
      break;
    }
  }
  if (!merchant && lines.length > 0) {
    merchant = lines[0].slice(0, 30);
  }
  if (!merchant) merchant = 'Retail Merchant';

  // 3. Extract Amount
  // Search for labeled totals: "Total", "Grand Total", "Net Amount", "Amount Paid", "Total Payable"
  let amount = 0;
  const totalRegex = /(?:grand\s*total|net\s*amount|total\s*payable|total\s*amount|total|bill\s*amount|amount\s*paid|subtotal|balance|rs\.?|inr|₹)\s*[:=]?\s*(?:rs\.?|inr|₹)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/gi;

  let totalMatches = [];
  let match;
  while ((match = totalRegex.exec(cleanText)) !== null) {
    const rawVal = match[1].replace(/,/g, '');
    const val = parseFloat(rawVal);
    if (Number.isFinite(val) && val > 0 && val < 1000000) {
      totalMatches.push({ line: match[0], val });
    }
  }

  if (totalMatches.length > 0) {
    // Prefer lines containing "Grand Total" or "Total" or pick the maximum labeled amount
    const grand = totalMatches.find(m => /grand\s*total|net\s*amount|total\s*payable/i.test(m.line));
    if (grand) {
      amount = grand.val;
    } else {
      // Pick highest total found
      amount = Math.max(...totalMatches.map(m => m.val));
    }
  } else {
    // Fallback: look for general amounts with currency or decimals
    const numRegex = /(?:₹|rs\.?|inr)?\s*([0-9,]+\.[0-9]{2})\b/gi;
    const allNums = [];
    while ((match = numRegex.exec(cleanText)) !== null) {
      const v = parseFloat(match[1].replace(/,/g, ''));
      if (Number.isFinite(v) && v > 0 && v < 1000000) allNums.push(v);
    }
    if (allNums.length > 0) {
      amount = Math.max(...allNums);
    }
  }

  // 4. Extract Date
  let date = new Date().toISOString().split('T')[0]; // Default to today
  // Date patterns: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD Mon YYYY
  const datePatterns = [
    /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/,
    /\b(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/,
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i,
  ];

  for (const pat of datePatterns) {
    const dMatch = cleanText.match(pat);
    if (dMatch) {
      try {
        let dStr = '';
        if (dMatch[3] && dMatch[3].length === 4 && isNaN(dMatch[2])) {
          // DD Mon YYYY
          const parsed = new Date(`${dMatch[2]} ${dMatch[1]}, ${dMatch[3]}`);
          if (!isNaN(parsed.getTime())) dStr = parsed.toISOString().split('T')[0];
        } else if (dMatch[3] && dMatch[3].length === 4) {
          // DD/MM/YYYY
          const d = parseInt(dMatch[1], 10);
          const m = parseInt(dMatch[2], 10) - 1;
          const y = parseInt(dMatch[3], 10);
          const parsed = new Date(y, m, d);
          if (!isNaN(parsed.getTime())) dStr = parsed.toISOString().split('T')[0];
        } else if (dMatch[1] && dMatch[1].length === 4) {
          // YYYY/MM/DD
          const y = parseInt(dMatch[1], 10);
          const m = parseInt(dMatch[2], 10) - 1;
          const d = parseInt(dMatch[3], 10);
          const parsed = new Date(y, m, d);
          if (!isNaN(parsed.getTime())) dStr = parsed.toISOString().split('T')[0];
        }
        if (dStr) {
          date = dStr;
          break;
        }
      } catch (_) {}
    }
  }

  // 5. Detect Payment Method
  let paymentMethod = 'cash';
  if (/upi|gpay|google pay|phonepe|paytm|bhim|qr code/i.test(cleanText)) {
    paymentMethod = 'upi';
  } else if (/card|visa|mastercard|rupay|amex|pos|swipe|debit card|credit card/i.test(cleanText)) {
    paymentMethod = 'card';
  } else if (/net banking|neft|rtgs|imps/i.test(cleanText)) {
    paymentMethod = 'netBanking';
  }

  // 6. Infer Category from Merchant & Content
  let category = 'grocery';
  const combinedHaystack = `${merchant} ${cleanText}`.toLowerCase();
  for (const item of MERCHANT_CAT_MAP) {
    if (item.regex.test(combinedHaystack)) {
      category = item.cat;
      break;
    }
  }

  return {
    merchant: merchant.slice(0, 40),
    amount: amount > 0 ? amount : 0,
    date,
    paymentMethod,
    category,
    gstin,
    rawText: cleanText,
  };
}

/**
 * End-to-end receipt OCR extraction from image file or blob.
 * @param {Blob|File} file
 * @param {function({status: string, progress: number}): void} [onProgress]
 * @returns {Promise<{merchant: string, amount: number, date: string, paymentMethod: string, category: string, gstin: string|null, rawText: string}>}
 */
export async function extractReceiptData(file, onProgress = null) {
  // Step 1: Preprocess on Canvas
  if (onProgress) onProgress({ status: 'Preprocessing image…', progress: 10 });
  const canvas = await preprocessReceiptImage(file);

  // Step 2: Run Tesseract OCR
  if (onProgress) onProgress({ status: 'Running OCR engine…', progress: 30 });
  const rawText = await runOcr(canvas, onProgress);

  // Step 3: Parse Structured Data
  if (onProgress) onProgress({ status: 'Extracting data…', progress: 95 });
  const parsed = parseReceiptText(rawText);

  if (onProgress) onProgress({ status: 'Complete', progress: 100 });
  return parsed;
}
