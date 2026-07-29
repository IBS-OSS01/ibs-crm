import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Hardcoded for production - uipl-erp project
const firebaseConfig = {
  apiKey: "AIzaSyAIuHxHqKVbmBBUlaNk-MBrrv-A9StwsGk",
  authDomain: "uipl-erp.firebaseapp.com",
  projectId: "uipl-erp",
  storageBucket: "uipl-erp.firebasestorage.app",
  messagingSenderId: "740948541037",
  appId: "1:740948541037:web:5e6db70b7b825ef918c964",
  measurementId: "G-F4WM8MLZW2"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export { firebaseConfig }
export default app
