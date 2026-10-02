/* Optional sign-in, used for one thing: keeping a user's signatures in their
   account so they can reuse them later or on another device.

   Everything else stays account-free and offline-capable. This only switches
   on where the page is served by Firebase Hosting, which publishes the
   project's web config at /__/firebase/init.json; anywhere else (GitHub
   Pages, a local server) that file is missing, the sign-in UI stays hidden
   and the app behaves exactly as before. Documents are never uploaded -- the
   only thing that leaves the machine is a signature the user explicitly
   saves while signed in.

   The Firebase SDK is vendored (vendor/firebase, compat builds) like the
   rest of the app's libraries, and loaded lazily: auth only once the config
   is known to exist, Firestore -- by far the largest piece -- only when a
   signed-in user first opens their saved signatures. */

import { t } from './i18n.js';

const SDK_DIR = 'vendor/firebase/';
const scripts = new Map();
let auth = null;
let db = null;
let user = null;
let ready = false;

function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(el);
    }));
  }
  return scripts.get(src);
}

function emit() {
  document.dispatchEvent(new CustomEvent('accountchange', { detail: user }));
}

// Resolves true once sign-in is available (Firebase Hosting with a web app
// registered), false otherwise. The first `accountchange` follows as soon as
// Firebase has restored -- or ruled out -- a persisted session, so the UI can
// wait for it rather than flashing "Sign in" at someone already signed in.
export async function initAccount() {
  // Hosts known not to be Firebase Hosting: skip the probe outright rather
  // than log a 404 for the missing config on every load -- GitHub Pages, and
  // a plain local server (the README's way to run the app).
  const host = location.hostname;
  if (host.endsWith('.github.io') || host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return false;
  let config;
  try {
    const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
    if (!res.ok) return false;
    config = await res.json();
  } catch {
    return false;
  }
  if (!config || !config.apiKey) return false;
  try {
    await loadScript(SDK_DIR + 'firebase-app-compat.js');
    await loadScript(SDK_DIR + 'firebase-auth-compat.js');
  } catch (err) {
    console.error(err);
    return false;
  }
  firebase.initializeApp(config);
  auth = firebase.auth();
  auth.onAuthStateChanged((u) => {
    user = u;
    ready = true;
    emit();
  });
  return true;
}

export const accountReady = () => ready;
export const currentUser = () => user;

// Interactive: reports failures itself, so callers can just await it. The
// two setup gaps a fresh Firebase project actually hits (this hostname not
// yet an authorized domain, Google sign-in not yet enabled) get messages
// naming the console setting to change, rather than Firebase's raw error.
export async function signIn() {
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await auth.signInWithPopup(provider);
  } catch (err) {
    const code = err && err.code;
    // Closing the popup is a normal way to back out, not a failure.
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    if (code === 'auth/unauthorized-domain') alert(t('signInUnauthorizedDomain', { host: location.hostname }));
    else if (code === 'auth/operation-not-allowed') alert(t('signInProviderDisabled'));
    else if (code === 'auth/popup-blocked') alert(t('signInPopupBlocked'));
    else alert(t('signInFailed', { err: (err && err.message) || err }));
  }
}

export function signOut() {
  return auth.signOut();
}

async function signatureCollection() {
  if (!user) throw new Error('Not signed in');
  if (!db) {
    await loadScript(SDK_DIR + 'firebase-firestore-compat.js');
    db = firebase.firestore();
  }
  return db.collection('users').doc(user.uid).collection('signatures');
}

// Newest first. Each entry: { id, png (data URL), w, h }.
export async function listSignatures() {
  const snap = await (await signatureCollection()).orderBy('createdAt', 'desc').get();
  return snap.docs.map((d) => {
    const { png, w, h } = d.data();
    return { id: d.id, png, w, h };
  });
}

export async function saveSignature({ png, w, h }) {
  const ref = await (await signatureCollection()).add({
    png, w, h,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

export async function deleteSignature(id) {
  await (await signatureCollection()).doc(id).delete();
}
