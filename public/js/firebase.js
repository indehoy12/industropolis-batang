// Inisialisasi Firebase (Firestore + Auth). Nilai firebaseConfig memang boleh publik;
// keamanan data diatur oleh firestore.rules.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore, collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc,
  writeBatch, increment, serverTimestamp, getDoc, getDocs, query, orderBy, where, deleteField,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDI5Byt23-OHzq_wosnGzqRmPaOCaOsXVc",
  authDomain: "industropolis-futsal.firebaseapp.com",
  projectId: "industropolis-futsal",
  storageBucket: "industropolis-futsal.firebasestorage.app",
  messagingSenderId: "967411487080",
  appId: "1:967411487080:web:eed26c2a64660b308146dd",
  measurementId: "G-6DEJP2BZRE",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

export {
  collection, doc, onSnapshot, addDoc, setDoc, updateDoc, deleteDoc, writeBatch, increment,
  serverTimestamp, getDoc, getDocs, query, orderBy, where, deleteField,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
};
