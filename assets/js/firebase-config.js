// =====================================================================
//  Firebase configuration  —  REPLACE the placeholder values below.
//  Get these from: Firebase Console > Project settings > "Your apps" > Web app
//  (See README.md, Step 3 for exact instructions.)
// =====================================================================

export const firebaseConfig = {
  apiKey:            "REPLACE_WITH_YOUR_API_KEY",
  authDomain:        "REPLACE_WITH_YOUR_PROJECT.firebaseapp.com",
  projectId:         "REPLACE_WITH_YOUR_PROJECT_ID",
  storageBucket:     "REPLACE_WITH_YOUR_PROJECT.appspot.com",
  messagingSenderId: "REPLACE_WITH_YOUR_SENDER_ID",
  appId:             "REPLACE_WITH_YOUR_APP_ID"
};

// Firestore collection where contact submissions are stored.
export const CONTACT_COLLECTION = "contact_submissions";
