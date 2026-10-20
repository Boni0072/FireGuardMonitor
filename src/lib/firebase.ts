import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Firebase web app configuration
const firebaseConfig = {
  apiKey: 'AIzaSyC7qj3lvZq6XvwJqSkiQIbasOl5vLi8HHs',
  authDomain: 'fireguard-monitor.firebaseapp.com',
  projectId: 'fireguard-monitor',
  storageBucket: 'fireguard-monitor.firebasestorage.app',
  messagingSenderId: '314380182585',
  appId: '1:314380182585:web:026b4aeb44d95a3f8499e8',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
