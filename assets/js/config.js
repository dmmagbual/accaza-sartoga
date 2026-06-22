/* =====================================================================
   AKALIKO PNG — site config (plain global, loaded before site.js/inventory.js)
   ===================================================================== */
window.AKALIKO = window.AKALIKO || {};

/* Firebase — live Akaliko PNG project */
window.AKALIKO.firebaseConfig = {
  apiKey: "AIzaSyBGdWKeu3ZczsBxTsf2-aghBS57N5tWOso",
  authDomain: "akaliko-png.firebaseapp.com",
  projectId: "akaliko-png",
  storageBucket: "akaliko-png.firebasestorage.app",
  messagingSenderId: "148580649388",
  appId: "1:148580649388:web:d8c36776dbfaeee99fd209",
  measurementId: "G-JRH5Y2ZTJM"
};

window.AKALIKO.INQUIRY_COLLECTION = "inquiries";
window.AKALIKO.INVENTORY_COLLECTION = "inventory";
window.AKALIKO.FALLBACK_EMAIL = "admin.png@akaliko.global";

/* WhatsApp click-to-chat — digits only, international format, no + or spaces.
   TODO: replace with the dedicated WhatsApp Business number when available. */
window.AKALIKO.WHATSAPP = "67582000055";

/* ---- ADMIN PIN ----
   NOTE: this is client-side only and visible in page source — it deters casual
   edits but is not real security. For production, move inventory writes behind
   Firebase Authentication + Firestore rules (see firestore.rules / README). */
window.AKALIKO.ADMIN_PIN = "akaliko2024";
