// ============================================================
// Tamil & Unicode Font Loader for jsPDF
// ============================================================
// Loads and registers Noto Sans Tamil / Unicode font with jsPDF
// to enable rendering of Tamil glyphs and currency symbols (₹).
// Caches the font array buffer in IndexedDB/memory for fast offline use.
// ============================================================

let _cachedFontBase64 = null;

const NOTO_TAMIL_URL = 'https://fonts.gstatic.com/s/notosanstamil/v28/SZc23FDEmgRB7Piz6yUdlnxWEeXmqqtk.ttf';

/**
 * Fetch font TTF binary and convert to base64 for jsPDF virtual file system.
 * @returns {Promise<string|null>} Base64 font string
 */
export async function loadTamilFontBase64() {
  if (_cachedFontBase64) return _cachedFontBase64;

  // Try retrieving from localStorage cache
  try {
    const stored = localStorage.getItem('cf_noto_tamil_b64');
    if (stored && stored.length > 5000) {
      _cachedFontBase64 = stored;
      return _cachedFontBase64;
    }
  } catch (_) {}

  // Fetch online if available
  try {
    const res = await fetch(NOTO_TAMIL_URL, { mode: 'cors' });
    if (res.ok) {
      const blob = await res.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          const b64 = result.split(',')[1];
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      if (base64) {
        _cachedFontBase64 = base64;
        try {
          localStorage.setItem('cf_noto_tamil_b64', base64);
        } catch (_) {}
        return _cachedFontBase64;
      }
    }
  } catch (err) {
    console.warn('[PDF] Could not load Noto Sans Tamil font online:', err);
  }

  return null;
}

/**
 * Register Unicode/Tamil font with a jsPDF document instance.
 * @param {jsPDF} doc
 * @returns {Promise<boolean>} true if custom font was successfully registered
 */
export async function registerTamilFont(doc) {
  try {
    const fontB64 = await loadTamilFontBase64();
    if (fontB64) {
      doc.addFileToVFS('NotoSansTamil.ttf', fontB64);
      doc.addFont('NotoSansTamil.ttf', 'NotoSansTamil', 'normal');
      doc.addFont('NotoSansTamil.ttf', 'NotoSansTamil', 'bold');
      return true;
    }
  } catch (e) {
    console.warn('[PDF] Failed to register NotoSansTamil font:', e);
  }
  return false;
}
