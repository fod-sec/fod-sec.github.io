import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getAnalytics, isSupported } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyB4PQlThqQ9GUX8yFXJHpqYZAhA_wIOhjU",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "fod-sec.firebaseapp.com",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://fod-sec-default-rtdb.firebaseio.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "fod-sec",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "fod-sec.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "779444246014",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:779444246014:web:6bee9caf63857d89721caf",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-81G1ERK82B",
};

export const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

if (typeof window !== "undefined") {
  void isSupported().then((supported) => { if (supported) getAnalytics(firebaseApp); }).catch(() => undefined);
}

export type ProgramFlowItem = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  speaker: string;
};

export type ProgramRecord = {
  id: string;
  title: string;
  description: string;
  theme: string;
  dateFrom: string;
  dateTo: string;
  venue: string;
  flow: ProgramFlowItem[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AttendeeRecord = {
  id: string;
  programId: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  sexAtBirth: "Male" | "Female";
  province: string;
  municipality: string;
  barangay: string;
  office: string;
  position: string;
  contactNo: string;
  email: string;
  billeting: "Yes" | "No";
  foodAllergy: string;
  createdBy: string;
  createdAt?: unknown;
};

export type AttendeeSummary = {
  id: string;
  programId: string;
  name: string;
  sexAtBirth: "Male" | "Female";
  billeting: "Yes" | "No";
  createdAt?: unknown;
};

export type RoomRecord = {
  id: string;
  programId: string;
  building: string;
  roomNo: string;
  sexScope: "Male" | "Female";
  capacity: number;
  finalized: boolean;
};

export type RoomAssignment = {
  id: string;
  programId: string;
  attendeeId: string;
  attendeeName: string;
  sexAtBirth: "Male" | "Female";
  building: string;
  roomNo: string;
  sexScope: "Male" | "Female";
};
