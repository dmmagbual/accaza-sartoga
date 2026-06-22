// =====================================================================
//  Contact form -> Firebase Firestore
//  Saves each submission as a document in the "contact_submissions"
//  collection. Uses Firebase v10 modular SDK loaded from the CDN.
// =====================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig, CONTACT_COLLECTION } from "./firebase-config.js";

const form   = document.getElementById("contact-form");
const status = document.getElementById("form-status");

function setStatus(msg, type) {
  if (!status) return;
  status.textContent = msg;
  status.className = "form-status " + (type || "");
}

// Only initialise Firebase if the config has been filled in.
const configured = !String(firebaseConfig.projectId).startsWith("REPLACE_");
let db = null;
if (configured) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
  } catch (e) {
    console.error("Firebase init failed:", e);
  }
}

if (form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const btn = form.querySelector("button[type=submit]");

    const data = {
      name:    form.name.value.trim(),
      email:   form.email.value.trim(),
      company: form.company.value.trim(),
      phone:   form.phone.value.trim(),
      service: form.service.value,
      message: form.message.value.trim(),
      createdAt: configured ? serverTimestamp() : new Date().toISOString(),
      source: "akaliko-png-website"
    };

    if (!data.name || !data.email || !data.message) {
      setStatus("Please fill in your name, email and message.", "err");
      return;
    }

    if (!db) {
      // Firebase not configured yet — fail gracefully so the form is still usable.
      setStatus("Form not yet connected to the database. Add your Firebase keys (see README Step 3).", "err");
      console.warn("Submission captured but Firebase is not configured:", data);
      return;
    }

    btn.disabled = true;
    setStatus("Sending…", "");
    try {
      await addDoc(collection(db, CONTACT_COLLECTION), data);
      form.reset();
      setStatus("Thank you — your message has been received. Our team will respond within 24 hours.", "ok");
    } catch (err) {
      console.error(err);
      setStatus("Something went wrong sending your message. Please email us directly.", "err");
    } finally {
      btn.disabled = false;
    }
  });
}
