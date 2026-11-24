"use client";

import {
  collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import {
  onAuthStateChanged, signInAnonymously, signInWithEmailAndPassword, signOut,
  type User,
} from "firebase/auth";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown,
  CircleHelp, ClipboardList, DoorOpen, Edit3, FilePlus2, Flower2, KeyRound,
  LogOut, Mail, MapPin, Menu, Plus, Snowflake, Sparkles, Trash2, UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import locations from "@/data/locations.json";
import { auth, db, type AttendeeRecord, type AttendeeSummary, type ProgramFlowItem, type ProgramRecord, type RoomAssignment, type RoomRecord } from "@/lib/firebase";

type View = "home" | "program" | "rooms" | "programs" | "room-management";
type Role = "guest" | "admin" | null;
type GeoCity = { name: string; barangays: string[] };
type GeoProvince = { name: string; cities: GeoCity[] };
type AttendeeFormValues = {
  firstName: string; middleName: string; lastName: string; suffix: string;
  sexAtBirth: "Male" | "Female"; province: string; municipality: string;
  barangay: string; office: string; position: string; contactNo: string;
  email: string; billeting: "Yes" | "No"; hasAllergy: "Yes" | "No"; foodAllergy: string;
};

const PASSCODE = "fod";
const ACCESS_STORAGE_KEY = "fod-secretariat-access";
const allProvinceData = locations as GeoProvince[];
const caragaProvinceNames = new Set([
  "Agusan del Norte", "Agusan del Sur", "Dinagat Islands", "Surigao del Norte", "Surigao del Sur",
]);
const butuanCity = allProvinceData.find((entry) => entry.name === "City of Butuan")?.cities ?? [];
const provinceData = allProvinceData
  .filter((entry) => caragaProvinceNames.has(entry.name))
  .map((entry) => entry.name === "Agusan del Norte"
    ? { ...entry, cities: [...entry.cities, ...butuanCity].sort((a, b) => a.name.localeCompare(b.name)) }
    : entry);
const suffixes = ["Jr.", "Sr.", "II", "III", "IV"];
const emptyAttendee: AttendeeFormValues = {
  firstName: "", middleName: "", lastName: "", suffix: "", sexAtBirth: "Male",
  province: "", municipality: "", barangay: "", office: "", position: "",
  contactNo: "", email: "", billeting: "Yes", hasAllergy: "No", foodAllergy: "",
};

function displayName(person: Pick<AttendeeFormValues, "firstName" | "middleName" | "lastName" | "suffix">) {
  return [person.firstName, person.middleName, person.lastName, person.suffix].filter(Boolean).join(" ");
}

function dateLabel(value: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "Date to be announced";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-PH", options).format(date);
}

function formatTime(value: string) {
  if (!value) return "";
  const [hours = "0", minutes = "00"] = value.split(":");
  const date = new Date();
  date.setHours(Number(hours), Number(minutes));
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" }).format(date);
}

function eventRange(program: ProgramRecord) {
  if (!program.dateFrom) return "Dates to be announced";
  if (!program.dateTo || program.dateFrom === program.dateTo) return dateLabel(program.dateFrom);
  const start = new Date(`${program.dateFrom}T12:00:00`);
  const end = new Date(`${program.dateTo}T12:00:00`);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${new Intl.DateTimeFormat("en-PH", { month: "long" }).format(start)} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${dateLabel(program.dateFrom)} – ${dateLabel(program.dateTo)}`;
}

function friendlyError(error: unknown) {
  const code = (error as { code?: string })?.code;
  if (code === "auth/invalid-credential" || code === "auth/user-not-found" || code === "auth/wrong-password") return "That email and password combination did not work.";
  if (code === "auth/operation-not-allowed") return "Anonymous sign-in is not enabled in Firebase Authentication yet.";
  if (code === "permission-denied" || code === "firestore/permission-denied") return "Firebase blocked this action. Check the project’s Firestore rules and admin setup.";
  if (code === "auth/network-request-failed") return "Could not reach Firebase. Check your internet connection and try again.";
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authView, setAuthView] = useState<"access" | "admin">("access");
  const [accessCode, setAccessCode] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; kind: "success" | "error" } | null>(null);
  const [programs, setPrograms] = useState<ProgramRecord[]>([]);
  const [summaries, setSummaries] = useState<AttendeeSummary[]>([]);
  const [attendees, setAttendees] = useState<AttendeeRecord[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [assignments, setAssignments] = useState<RoomAssignment[]>([]);
  const [selectedProgramId, setSelectedProgramId] = useState("");
  const [view, setView] = useState<View>("home");
  const [selectedDay, setSelectedDay] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const [programModal, setProgramModal] = useState<ProgramRecord | "new" | null>(null);
  const [roomModal, setRoomModal] = useState<RoomRecord | "new" | null>(null);
  const [deleteRoomTarget, setDeleteRoomTarget] = useState<RoomRecord | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [attendeeSending, setAttendeeSending] = useState(false);

  const notice = useCallback((text: string, kind: "success" | "error" = "success") => {
    setToast({ text, kind });
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null);
        setAuthLoading(false);
        return;
      }
      if (nextUser.isAnonymous) {
        const hasAccess = window.localStorage.getItem(ACCESS_STORAGE_KEY) === "active";
        if (hasAccess) {
          setRole("guest");
        } else {
          await signOut(auth);
          setRole(null);
        }
        setAuthLoading(false);
        return;
      }
      try {
        const adminSnapshot = await getDoc(doc(db, "admins", nextUser.uid));
        if (adminSnapshot.exists() && adminSnapshot.data().enabled === true) setRole("admin");
        else {
          setRole(null);
          if (auth.currentUser?.uid === nextUser.uid) await signOut(auth);
        }
      } catch {
        setRole(null);
      } finally {
        setAuthLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (role !== "guest" && role !== "admin") return;
    const stopPrograms = onSnapshot(query(collection(db, "programs"), orderBy("dateFrom", "asc")), (snapshot) => {
      setPrograms(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as ProgramRecord)));
    }, (error) => notice(friendlyError(error), "error"));
    const stopSummaries = onSnapshot(collection(db, "attendeeSummaries"), (snapshot) => {
      setSummaries(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as AttendeeSummary)));
    }, (error) => notice(friendlyError(error), "error"));
    const stopAssignments = onSnapshot(collection(db, "roomAssignments"), (snapshot) => {
      setAssignments(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as RoomAssignment)));
    }, (error) => notice(friendlyError(error), "error"));
    return () => { stopPrograms(); stopSummaries(); stopAssignments(); };
  }, [role, notice]);

  useEffect(() => {
    if (role !== "admin") {
      setAttendees([]);
      setRooms([]);
      return;
    }
    const stopAttendees = onSnapshot(collection(db, "attendees"), (snapshot) => {
      setAttendees(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as AttendeeRecord)));
    }, (error) => notice(friendlyError(error), "error"));
    const stopRooms = onSnapshot(collection(db, "rooms"), (snapshot) => {
      setRooms(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as RoomRecord)));
    }, (error) => notice(friendlyError(error), "error"));
    return () => { stopAttendees(); stopRooms(); };
  }, [role, notice]);

  useEffect(() => {
    if (!programs.length) {
      setSelectedProgramId("");
      return;
    }
    if (!programs.some((program) => program.id === selectedProgramId)) setSelectedProgramId(programs[0].id);
  }, [programs, selectedProgramId]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedProgram = programs.find((program) => program.id === selectedProgramId) ?? null;
  const selectedFlow = useMemo(() => [...(selectedProgram?.flow ?? [])].sort((a, b) => `${a.date}-${a.startTime}`.localeCompare(`${b.date}-${b.startTime}`)), [selectedProgram]);
  const flowDays = useMemo(() => [...new Set(selectedFlow.map((entry) => entry.date).filter(Boolean))], [selectedFlow]);
  const day = flowDays.includes(selectedDay) ? selectedDay : flowDays[0] ?? "";
  const visibleFlow = selectedFlow.filter((entry) => !day || entry.date === day);
  const selectedSummaries = summaries.filter((entry) => entry.programId === selectedProgramId);
  const counts = useMemo(() => {
    const all = selectedSummaries;
    const sexCount = (list: AttendeeSummary[], sex: "Male" | "Female") => list.filter((item) => item.sexAtBirth === sex).length;
    const billeted = all.filter((item) => item.billeting === "Yes");
    const noBilleting = all.filter((item) => item.billeting === "No");
    return {
      confirmed: { male: sexCount(all, "Male"), female: sexCount(all, "Female"), total: all.length },
      billeted: { male: sexCount(billeted, "Male"), female: sexCount(billeted, "Female"), total: billeted.length },
      noBilleting: { male: sexCount(noBilleting, "Male"), female: sexCount(noBilleting, "Female"), total: noBilleting.length },
    };
  }, [selectedSummaries]);
  const programRooms = rooms.filter((room) => room.programId === selectedProgramId);
  const programAssignments = assignments.filter((assignment) => assignment.programId === selectedProgramId);
  const unassignedCount = attendees.filter((attendee) => attendee.programId === selectedProgramId && attendee.billeting === "Yes" && !programAssignments.some((entry) => entry.attendeeId === attendee.id)).length;

  async function enterGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accessCode.trim().toLowerCase() !== PASSCODE) {
      notice("That access code is not valid. Please try again.", "error");
      return;
    }
    setBusy(true);
    try {
      window.localStorage.setItem(ACCESS_STORAGE_KEY, "active");
      await signInAnonymously(auth);
      setAccessCode("");
    } catch (error) {
      window.localStorage.removeItem(ACCESS_STORAGE_KEY);
      notice(friendlyError(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function enterAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, adminEmail.trim(), adminPassword);
      const adminSnapshot = await getDoc(doc(db, "admins", credential.user.uid));
      if (!adminSnapshot.exists() || adminSnapshot.data().enabled !== true) {
        await signOut(auth);
        throw new Error("This account does not have Secretariat admin access yet.");
      }
      setRole("admin");
      setAdminPassword("");
    } catch (error) {
      notice(friendlyError(error), "error");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    window.localStorage.removeItem(ACCESS_STORAGE_KEY);
    await signOut(auth);
    setView("home");
    setMobileNavOpen(false);
    setPrograms([]); setSummaries([]); setAssignments([]); setAttendees([]); setRooms([]);
  }

  async function saveProgram(values: Omit<ProgramRecord, "id">, id?: string) {
    setBusy(true);
    try {
      const programId = id ?? doc(collection(db, "programs")).id;
      await setDoc(doc(db, "programs", programId), {
        ...values,
        updatedAt: serverTimestamp(),
        ...(id ? {} : { createdAt: serverTimestamp() }),
      }, { merge: true });
      setSelectedProgramId(programId);
      setProgramModal(null);
      setView("programs");
      notice(id ? "Program details updated." : "Program added to the list.");
    } catch (error) {
      notice(friendlyError(error), "error");
    } finally { setBusy(false); }
  }

  async function removeProgram(program: ProgramRecord) {
    if (!window.confirm(`Delete “${program.title}”? This does not remove its attendance records.`)) return;
    try {
      await deleteDoc(doc(db, "programs", program.id));
      notice("Program removed.");
    } catch (error) { notice(friendlyError(error), "error"); }
  }

  async function saveRoom(values: Omit<RoomRecord, "id" | "finalized">, id?: string) {
    setBusy(true);
    try {
      const roomId = id ?? doc(collection(db, "rooms")).id;
      await setDoc(doc(db, "rooms", roomId), { ...values, finalized: false, updatedAt: serverTimestamp() }, { merge: true });
      const priorAssignments = assignments.filter((assignment) => assignment.programId === values.programId);
      for (let start = 0; start < priorAssignments.length; start += 450) {
        const batch = writeBatch(db);
        priorAssignments.slice(start, start + 450).forEach((assignment) => batch.delete(doc(db, "roomAssignments", assignment.id)));
        await batch.commit();
      }
      for (const savedRoom of rooms.filter((entry) => entry.programId === values.programId)) await updateDoc(doc(db, "rooms", savedRoom.id), { finalized: false });
      setRoomModal(null);
      notice(id ? "Room updated. Finalize room assignments again to apply the new capacity." : "Room added.");
    } catch (error) { notice(friendlyError(error), "error"); }
    finally { setBusy(false); }
  }

  async function removeRoom(room: RoomRecord) {
    try {
      const oldAssignments = assignments.filter((entry) => entry.programId === room.programId);
      for (let start = 0; start < oldAssignments.length; start += 450) {
        const batch = writeBatch(db);
        oldAssignments.slice(start, start + 450).forEach((entry) => batch.delete(doc(db, "roomAssignments", entry.id)));
        await batch.commit();
      }
      await deleteDoc(doc(db, "rooms", room.id));
      for (const other of rooms.filter((entry) => entry.programId === room.programId && entry.id !== room.id)) {
        await updateDoc(doc(db, "rooms", other.id), { finalized: false });
      }
      setDeleteRoomTarget(null);
      notice("Room removed. Finalize assignments again when the room list is ready.");
    } catch (error) { notice(friendlyError(error), "error"); }
  }

  async function finalizeRoomAssignments() {
    const roomsToFill = [...programRooms].sort((a, b) => `${a.building}-${a.roomNo}`.localeCompare(`${b.building}-${b.roomNo}`));
    const people = attendees
      .filter((attendee) => attendee.programId === selectedProgramId && attendee.billeting === "Yes")
      .sort((a, b) => `${a.sexAtBirth}-${a.lastName}-${a.firstName}`.localeCompare(`${b.sexAtBirth}-${b.lastName}-${b.firstName}`));
    const remaining = new Map(roomsToFill.map((room) => [room.id, Math.max(0, room.capacity)]));
    const created: RoomAssignment[] = [];
    for (const person of people) {
      const room = roomsToFill.find((candidate) => candidate.sexScope === person.sexAtBirth && (remaining.get(candidate.id) ?? 0) > 0);
      if (!room) continue;
      remaining.set(room.id, (remaining.get(room.id) ?? 1) - 1);
      created.push({
        id: person.id, programId: selectedProgramId, attendeeId: person.id,
        attendeeName: displayName(person), sexAtBirth: person.sexAtBirth,
        building: room.building, roomNo: room.roomNo, sexScope: room.sexScope,
      });
    }
    setBusy(true);
    try {
      for (let start = 0; start < programAssignments.length; start += 450) {
        const batch = writeBatch(db);
        programAssignments.slice(start, start + 450).forEach((entry) => batch.delete(doc(db, "roomAssignments", entry.id)));
        await batch.commit();
      }
      for (let start = 0; start < created.length; start += 400) {
        const batch = writeBatch(db);
        created.slice(start, start + 400).forEach((entry) => batch.set(doc(db, "roomAssignments", entry.id), { ...entry, updatedAt: serverTimestamp() }));
        await batch.commit();
      }
      for (let start = 0; start < roomsToFill.length; start += 450) {
        const batch = writeBatch(db);
        roomsToFill.slice(start, start + 450).forEach((room) => batch.update(doc(db, "rooms", room.id), { finalized: true, finalizedAt: serverTimestamp() }));
        await batch.commit();
      }
      setFinalizeOpen(false);
      notice(`${created.length} attendee${created.length === 1 ? "" : "s"} assigned. ${people.length - created.length} still need a room.`);
    } catch (error) { notice(friendlyError(error), "error"); }
    finally { setBusy(false); }
  }

  async function submitAttendance(values: AttendeeFormValues) {
    if (!user || !selectedProgram) return;
    setAttendeeSending(true);
    try {
      const attendeeRef = doc(collection(db, "attendees"));
      const name = displayName(values);
      const data: Omit<AttendeeRecord, "id"> = {
        programId: selectedProgram.id,
        firstName: values.firstName.trim(), middleName: values.middleName.trim(), lastName: values.lastName.trim(), suffix: values.suffix,
        sexAtBirth: values.sexAtBirth, province: values.province, municipality: values.municipality, barangay: values.barangay,
        office: values.office.trim(), position: values.position.trim(), contactNo: values.contactNo.trim(), email: values.email.trim().toLowerCase(),
        billeting: values.billeting, foodAllergy: values.hasAllergy === "Yes" ? values.foodAllergy.trim() : "None", createdBy: user.uid,
      };
      const batch = writeBatch(db);
      batch.set(attendeeRef, { ...data, createdAt: serverTimestamp() });
      batch.set(doc(db, "attendeeSummaries", attendeeRef.id), {
        programId: selectedProgram.id, name, sexAtBirth: values.sexAtBirth,
        billeting: values.billeting, createdAt: serverTimestamp(),
      });
      await batch.commit();
      setAttendanceOpen(false);
      notice("Your attendance has been confirmed. We’ll see you there!");
    } catch (error) { notice(friendlyError(error), "error"); }
    finally { setAttendeeSending(false); }
  }

  function goTo(nextView: View) {
    setView(nextView);
    setMobileNavOpen(false);
    if (nextView === "program" && !selectedProgramId && programs[0]) setSelectedProgramId(programs[0].id);
  }

  const signedIn = role !== null;

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" /><div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <button className="brand" type="button" onClick={() => signedIn && goTo("home")} aria-label="The Secretariat home">
          <span className="brand-mark"><Flower2 size={22} strokeWidth={1.6} /><span className="brand-dot" /></span>
          <span className="brand-copy"><strong>THE SECRETARIAT</strong><small>PROGRAMS · PEOPLE · PLACE</small></span>
        </button>
        {signedIn ? <>
          <button className="mobile-menu" type="button" aria-label="Toggle navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? <X /> : <Menu />}</button>
          <nav className={`main-nav ${mobileNavOpen ? "nav-open" : ""}`} aria-label="Main navigation">
            {role === "guest" ? <>
              <NavButton active={view === "program"} onClick={() => goTo("program")} icon={<CalendarDays size={16} />}>Program</NavButton>
              <NavButton active={view === "rooms"} onClick={() => goTo("rooms")} icon={<DoorOpen size={16} />}>Room Assignment</NavButton>
            </> : <>
              <NavButton active={view === "programs"} onClick={() => goTo("programs")} icon={<CalendarDays size={16} />}>Program List</NavButton>
              <NavButton active={view === "room-management"} onClick={() => goTo("room-management")} icon={<DoorOpen size={16} />}>Room Management</NavButton>
            </>}
            <button className="logout-button" type="button" onClick={logout} aria-label="Log out" title="Log out"><LogOut size={17} /></button>
          </nav>
        </> : <div className="topbar-kicker"><Snowflake size={15} /> A little order for the season</div>}
      </header>

      {authLoading ? <div className="loading-screen"><div className="loading-snow"><Snowflake size={25} /></div><p>Opening the doors…</p></div> : !signedIn ? (
        <section className="login-page">
          <div className="login-decoration ornament-left">✳</div><div className="login-decoration ornament-right">✧</div>
          <div className="login-intro"><span className="eyebrow"><span className="eyebrow-line" /> WELCOME TO THE SECRETARIAT</span><h1>Gather well.<br /><em>Everything in place.</em></h1><p>Your event desk for the program, attendance, and a good night’s rest.</p></div>
          <div className="login-card clay-card">
            <div className="login-card-top"><span className="small-mark"><Flower2 size={19} /></span><span className="login-season">THE EVENT DESK <span>✳</span></span></div>
            <h2>{authView === "access" ? "Welcome in." : "Admin sign in."}</h2>
            <p>{authView === "access" ? "Enter the access code to view your program and confirm attendance." : "Use your Secretariat admin account to manage the event."}</p>
            {authView === "access" ? <form className="auth-form" onSubmit={enterGuest}>
              <label className="field"><span>Access code</span><div className="input-wrap"><KeyRound size={17} /><input autoComplete="off" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} type="password" placeholder="Enter your access code" required /></div></label>
              <button className="button button-primary button-full" disabled={busy}>{busy ? <><span className="button-spinner" /> Opening…</> : <>Enter the event desk <ArrowRight size={17} /></>}</button>
            </form> : <form className="auth-form" onSubmit={enterAdmin}>
              <label className="field"><span>Email address</span><div className="input-wrap"><Mail size={17} /><input autoComplete="username" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} type="email" placeholder="name@office.gov.ph" required /></div></label>
              <label className="field"><span>Password</span><div className="input-wrap"><KeyRound size={17} /><input autoComplete="current-password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} type="password" placeholder="Enter your password" required /></div></label>
              <button className="button button-primary button-full" disabled={busy}>{busy ? <><span className="button-spinner" /> Signing in…</> : <>Sign in <ArrowRight size={17} /></>}</button>
            </form>}
            <div className="login-divider"><span /> <small>OR</small> <span /></div>
            <button className="text-link" type="button" onClick={() => setAuthView(authView === "access" ? "admin" : "access")}>{authView === "access" ? "Admin sign in" : "Back to access code"}<ArrowRight size={15} /></button>
            <div className="login-card-foot"><span><span className="status-dot" /> SECURE EVENT ACCESS</span><span>✳ CARAGA · PH</span></div>
          </div>
          <div className="login-footnote"><Sparkles size={13} /> A thoughtful gathering starts with a thoughtful plan.</div>
        </section>
      ) : <>
        <section className="page-wrap">
          <div className="welcome-row">
            <div><span className="eyebrow"><span className="eyebrow-line" /> {role === "admin" ? "ADMIN WORKSPACE" : "YOUR EVENT DESK"}</span><h1>{view === "home" ? <>A warm welcome,<br /><em>let’s get organized.</em></> : view === "program" ? <>The program,<br /><em>at a glance.</em></> : view === "rooms" ? <>Your place to stay,<br /><em>all sorted.</em></> : view === "programs" ? <>Programs, plans<br /><em>& all the details.</em></> : <>A room for everyone,<br /><em>thoughtfully placed.</em></>}</h1></div>
            <div className="welcome-decoration"><div className="decoration-ring"><Flower2 size={43} strokeWidth={1.1} /><span>✳</span></div><span className="decoration-caption">CARAGA REGION XIII</span></div>
          </div>

          {view === "home" && <>
            <ProgramChooser programs={programs} selectedId={selectedProgramId} onChange={setSelectedProgramId} />
            <StatsPanel counts={counts} programTitle={selectedProgram?.title ?? "Select a program"} />
            <section className="dashboard-lower">
              <div className="clay-card home-feature">
                <div className="feature-icon"><CalendarDays size={21} /></div><div className="feature-copy"><span className="eyebrow">UP NEXT</span><h2>{selectedProgram?.title ?? "Your program is taking shape"}</h2><p>{selectedProgram ? `${eventRange(selectedProgram)} · ${selectedProgram.venue || "Venue to be announced"}` : "Once a program is published, its schedule and attendee counts will appear here."}</p></div>
                <button className="icon-arrow" onClick={() => goTo(role === "admin" ? "programs" : "program")} aria-label="Open program"><ArrowRight size={19} /></button>
              </div>
              <div className="clay-card home-note"><div className="note-top"><span className="note-star">✳</span><span className="eyebrow">A SMALL REMINDER</span></div><p>Good plans leave room for good moments. Take a look around and make yourself at home.</p><span className="note-script">With care, The Secretariat</span></div>
            </section>
          </>}

          {view === "program" && <ProgramPage programs={programs} program={selectedProgram} onSelect={setSelectedProgramId} selectedId={selectedProgramId} flow={visibleFlow} days={flowDays} activeDay={day} onDayChange={setSelectedDay} onConfirm={() => selectedProgram && setAttendanceOpen(true)} summaries={selectedSummaries} />}
          {view === "rooms" && <RoomAssignmentPage assignments={programAssignments} programs={programs} selectedId={selectedProgramId} onSelect={setSelectedProgramId} />}
          {view === "programs" && <ProgramManagement programs={programs} onCreate={() => setProgramModal("new")} onEdit={(program) => setProgramModal(program)} onDelete={removeProgram} />}
          {view === "room-management" && <RoomManagement programs={programs} program={selectedProgram} rooms={programRooms} assignments={programAssignments} attendees={attendees.filter((entry) => entry.programId === selectedProgramId)} unassignedCount={unassignedCount} onSelect={setSelectedProgramId} onCreate={() => setRoomModal("new")} onEdit={(room) => setRoomModal(room)} onDelete={setDeleteRoomTarget} onFinalize={() => setFinalizeOpen(true)} />}

          <footer className="page-footer"><span>THE SECRETARIAT <span>✳</span> MADE WITH CARE</span><span>PROGRAMS · PEOPLE · PLACE</span></footer>
        </section>
      </>}

      {attendanceOpen && selectedProgram && <AttendanceModal program={selectedProgram} busy={attendeeSending} existingNames={selectedSummaries.map((entry) => entry.name.toLowerCase())} onClose={() => !attendeeSending && setAttendanceOpen(false)} onSubmit={submitAttendance} />}
      {programModal !== null && <ProgramModal key={programModal === "new" ? "new" : programModal.id} program={programModal === "new" ? null : programModal} busy={busy} onClose={() => setProgramModal(null)} onSave={saveProgram} />}
      {roomModal !== null && <RoomModal key={roomModal === "new" ? `new-${selectedProgramId}` : roomModal.id} programId={selectedProgramId} room={roomModal === "new" ? null : roomModal} busy={busy} onClose={() => setRoomModal(null)} onSave={saveRoom} />}
      {deleteRoomTarget && <ConfirmDialog title="Remove this room?" copy={`Building ${deleteRoomTarget.building}, room ${deleteRoomTarget.roomNo} will be removed. Existing assignments for this program will be cleared.`} confirmLabel="Remove room" onCancel={() => setDeleteRoomTarget(null)} onConfirm={() => removeRoom(deleteRoomTarget)} />}
      {finalizeOpen && <ConfirmDialog title="Finalize room assignment?" copy={`This will assign attendees who requested billeting to the available rooms by sex and capacity. ${unassignedCount ? `${unassignedCount} current attendee(s) are unassigned.` : "You can edit rooms and finalize again later."}`} confirmLabel={busy ? "Assigning…" : "Finalize assignments"} busy={busy} onCancel={() => !busy && setFinalizeOpen(false)} onConfirm={finalizeRoomAssignments} />}
      {toast && <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-icon">{toast.kind === "success" ? <CheckCircle2 size={18} /> : <CircleHelp size={18} />}</span>{toast.text}<button type="button" onClick={() => setToast(null)} aria-label="Dismiss message"><X size={15} /></button></div>}
    </main>
  );
}

function NavButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return <button className={`nav-button ${active ? "nav-active" : ""}`} type="button" onClick={onClick}>{icon}<span>{children}</span></button>;
}

function ProgramChooser({ programs, selectedId, onChange }: { programs: ProgramRecord[]; selectedId: string; onChange: (value: string) => void }) {
  return <div className="program-chooser"><div className="chooser-label"><span className="chooser-icon"><CalendarDays size={17} /></span><span><small>SHOWING ATTENDANCE FOR</small><strong>{programs.find((program) => program.id === selectedId)?.title ?? "No program selected"}</strong></span></div><label className="select-shell"><span className="sr-only">Select program</span><select value={selectedId} onChange={(event) => onChange(event.target.value)} disabled={!programs.length}><option value="">Choose a program</option>{programs.map((program) => <option key={program.id} value={program.id}>{program.title}</option>)}</select><ChevronDown size={16} /></label></div>;
}

function StatsPanel({ counts, programTitle }: { counts: { confirmed: { male: number; female: number; total: number }; billeted: { male: number; female: number; total: number }; noBilleting: { male: number; female: number; total: number } }; programTitle: string }) {
  const cards = [
    { label: "CONFIRMED ATTENDEES", details: counts.confirmed, color: "berry", icon: <UsersRound size={19} />, note: "Everyone coming together" },
    { label: "WITH BILLETING", details: counts.billeted, color: "pine", icon: <DoorOpen size={19} />, note: "A room for the night" },
    { label: "WITHOUT BILLETING", details: counts.noBilleting, color: "gold", icon: <Flower2 size={19} />, note: "Making their own way" },
  ];
  return <section className="stats-section"><div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> THE GATHERING</span><h2>Here’s who’s coming.</h2><p>{programTitle} <span>·</span> Live attendance counts</p></div><span className="live-pill"><span className="status-dot" /> LIVE</span></div><div className="stats-grid">{cards.map((card) => <article key={card.label} className={`clay-card stat-card stat-${card.color}`}><div className="stat-top"><span className="stat-icon">{card.icon}</span><span className="stat-label">{card.label}</span><span className="stat-sparkle">✳</span></div><div className="stat-main"><strong>{card.details.total}</strong><span>people</span></div><div className="stat-divider" /><div className="gender-counts"><div><span className="gender-label"><i className="gender-dot male-dot" />Male</span><strong>{card.details.male}</strong></div><div><span className="gender-label"><i className="gender-dot female-dot" />Female</span><strong>{card.details.female}</strong></div><div className="gender-total"><span>Total</span><strong>{card.details.total}</strong></div></div><p className="stat-note">{card.note}</p></article>)}</div></section>;
}

function ProgramPage({ programs, program, selectedId, onSelect, flow, days, activeDay, onDayChange, onConfirm, summaries }: { programs: ProgramRecord[]; program: ProgramRecord | null; selectedId: string; onSelect: (id: string) => void; flow: ProgramFlowItem[]; days: string[]; activeDay: string; onDayChange: (day: string) => void; onConfirm: () => void; summaries: AttendeeSummary[] }) {
  return <section className="content-section program-page">
    <div className="program-toolbar"><ProgramChooser programs={programs} selectedId={selectedId} onChange={onSelect} /><button type="button" className="button button-primary attendance-cta" disabled={!program} onClick={onConfirm}><CheckCircle2 size={17} /> Attendance confirmation</button></div>
    {program ? <>
      <div className="program-hero clay-card"><div className="program-hero-flower">✳</div><span className="eyebrow">THE PROGRAM FLOW</span><h2>{program.title}</h2>{program.theme && <p className="program-theme">“{program.theme}”</p>}<p className="program-description">{program.description || "A thoughtful program, planned for a good gathering."}</p><div className="program-meta"><span><CalendarDays size={16} />{eventRange(program)}</span><span><MapPin size={16} />{program.venue || "Venue to be announced"}</span></div></div>
      <div className="flow-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> THE DAY, AT A GLANCE</span><h2>Program flow <span>✳</span></h2></div><span className="flow-count">{flow.length} {flow.length === 1 ? "SESSION" : "SESSIONS"}</span></div>
      {days.length > 1 && <div className="day-tabs" role="tablist">{days.map((flowDay, index) => <button role="tab" aria-selected={activeDay === flowDay} className={activeDay === flowDay ? "day-tab day-tab-active" : "day-tab"} key={flowDay} onClick={() => onDayChange(flowDay)}><small>DAY {index + 1}</small><strong>{dateLabel(flowDay, { month: "short", day: "numeric" })}</strong></button>)}</div>}
      <div className="timeline">{flow.length ? flow.map((entry, index) => <article className="timeline-item" key={entry.id}><div className="timeline-rail"><span className="timeline-dot">{index === 0 ? <Flower2 size={13} /> : <span />}</span></div><div className="timeline-card clay-card"><div className="timeline-time">{entry.startTime ? formatTime(entry.startTime) : "Time TBA"}{entry.endTime && <> <span>–</span> {formatTime(entry.endTime)}</>}</div><div className="timeline-copy"><h3>{entry.title}</h3>{entry.description && <p>{entry.description}</p>}{entry.speaker && <span className="timeline-speaker">{entry.speaker}</span>}</div></div></article>) : <div className="empty-state clay-card"><div className="empty-icon"><CalendarDays size={22} /></div><h3>Program flow is on its way.</h3><p>The daily schedule will appear here as soon as it is shared.</p></div>}</div>
      <div className="attendance-prompt clay-card"><span className="prompt-icon"><ClipboardList size={22} /></span><div><span className="eyebrow">SAVE YOUR SEAT</span><h3>Are you joining us?</h3><p>{summaries.length} {summaries.length === 1 ? "person has" : "people have"} confirmed so far.</p></div><button type="button" className="button button-outline" onClick={onConfirm}>Confirm attendance <ArrowRight size={16} /></button></div>
    </> : <div className="empty-state clay-card"><div className="empty-icon"><CalendarDays size={22} /></div><h3>The program is getting ready.</h3><p>There are no programs to show just yet. Check back soon.</p></div>}
  </section>;
}

function RoomAssignmentPage({ assignments, programs, selectedId, onSelect }: { assignments: RoomAssignment[]; programs: ProgramRecord[]; selectedId: string; onSelect: (id: string) => void }) {
  const sorted = [...assignments].sort((a, b) => `${a.building}-${a.roomNo}-${a.sexScope}-${a.attendeeName}`.localeCompare(`${b.building}-${b.roomNo}-${b.sexScope}-${b.attendeeName}`));
  const groups = sorted.reduce<Record<string, RoomAssignment[]>>((result, item) => {
    const key = `${item.building}__${item.roomNo}__${item.sexScope}`;
    (result[key] ??= []).push(item);
    return result;
  }, {});
  return <section className="content-section room-page"><div className="room-toolbar"><ProgramChooser programs={programs} selectedId={selectedId} onChange={onSelect} /><div className="room-legend"><span><i className="gender-dot male-dot" /> Male rooms</span><span><i className="gender-dot female-dot" /> Female rooms</span></div></div><div className="table-card clay-card"><div className="table-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR BILLETING</span><h2>Room assignments</h2><p>Find your name and settle in.</p></div><span className="table-total"><strong>{assignments.length}</strong> {assignments.length === 1 ? "PERSON" : "PEOPLE"}</span></div><div className="assignment-table-wrap"><table className="assignment-table"><thead><tr><th>Building</th><th>Room no.</th><th>Sex scope</th><th>Name</th></tr></thead><tbody>{Object.entries(groups).length ? Object.entries(groups).map(([key, people]) => people.map((person, index) => <tr key={`${key}-${person.id}`}><td>{index === 0 ? <strong>{person.building}</strong> : null}</td><td>{index === 0 ? <span className="room-number-pill">{person.roomNo}</span> : null}</td><td>{index === 0 ? <span className={`sex-tag ${person.sexScope.toLowerCase()}`}>{person.sexScope}</span> : null}</td><td><span className="attendee-name-cell">{person.attendeeName}</span></td></tr>)) : <tr><td colSpan={4}><div className="table-empty"><span className="table-empty-icon"><DoorOpen size={22} /></span><strong>Room assignments are being prepared.</strong><span>Once rooms are assigned, you’ll find your details here.</span></div></td></tr>}</tbody></table></div><div className="privacy-note"><CheckCircle2 size={15} /> Room assignments are grouped by building, room, and sex-at-birth scope.</div></div></section>;
}

function ProgramManagement({ programs, onCreate, onEdit, onDelete }: { programs: ProgramRecord[]; onCreate: () => void; onEdit: (program: ProgramRecord) => void; onDelete: (program: ProgramRecord) => void }) {
  return <section className="content-section manage-section"><div className="manage-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> YOUR EVENT CALENDAR</span><h2>Program list</h2><p>Create a program, add its flow, and keep everything current.</p></div><button className="button button-primary" onClick={onCreate}><Plus size={17} /> New program</button></div>{programs.length ? <div className="program-list">{programs.map((program) => <article className="program-list-card clay-card" key={program.id}><span className="program-list-icon"><CalendarDays size={20} /></span><div className="program-list-copy"><span className="list-date">{eventRange(program)}</span><h3>{program.title}</h3><p>{program.venue || "Venue to be announced"}{program.theme ? ` · ${program.theme}` : ""}</p><span className="list-flow-count"><ClipboardList size={14} /> {program.flow?.length ?? 0} flow sessions</span></div><div className="program-list-actions"><button className="soft-icon-button" aria-label={`Edit ${program.title}`} title="Edit program" onClick={() => onEdit(program)}><Edit3 size={17} /></button><button className="soft-icon-button soft-icon-danger" aria-label={`Delete ${program.title}`} title="Delete program" onClick={() => onDelete(program)}><Trash2 size={17} /></button></div></article>)}</div> : <div className="empty-state clay-card"><div className="empty-icon"><CalendarDays size={22} /></div><h3>Let’s add the first program.</h3><p>Start with the event details, then build out each day’s flow.</p><button className="button button-outline" onClick={onCreate}><Plus size={16} /> Create a program</button></div>}</section>;
}

function RoomManagement({ programs, program, rooms, assignments, attendees, unassignedCount, onSelect, onCreate, onEdit, onDelete, onFinalize }: { programs: ProgramRecord[]; program: ProgramRecord | null; rooms: RoomRecord[]; assignments: RoomAssignment[]; attendees: AttendeeRecord[]; unassignedCount: number; onSelect: (id: string) => void; onCreate: () => void; onEdit: (room: RoomRecord) => void; onDelete: (room: RoomRecord) => void; onFinalize: () => void }) {
  const allocated = new Set(assignments.map((entry) => entry.attendeeId));
  const roomUse = (room: RoomRecord) => assignments.filter((entry) => entry.building === room.building && entry.roomNo === room.roomNo && entry.sexScope === room.sexScope).length;
  return <section className="content-section manage-section"><div className="room-manage-top"><ProgramChooser programs={programs} selectedId={program?.id ?? ""} onChange={onSelect} /><button className="button button-outline" onClick={onCreate} disabled={!program}><Plus size={16} /> Add room</button></div><div className="room-summary-strip"><div><span>REGISTERED</span><strong>{attendees.length}</strong></div><div><span>REQUESTED BILLETING</span><strong>{attendees.filter((entry) => entry.billeting === "Yes").length}</strong></div><div><span>ASSIGNED</span><strong>{assignments.length}</strong></div><div className={unassignedCount ? "summary-alert" : ""}><span>NEED A ROOM</span><strong>{unassignedCount}</strong></div></div><div className="manage-heading room-manage-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> ROOM MANAGEMENT</span><h2>{program?.title ?? "Choose a program"}</h2><p>Add rooms with capacity and matching sex scope, then finalize assignments.</p></div><button className="button button-primary" onClick={onFinalize} disabled={!program || !rooms.length}><Check size={17} /> Finalize room assignment</button></div><div className="room-card-grid">{rooms.length ? [...rooms].sort((a, b) => `${a.building}-${a.roomNo}`.localeCompare(`${b.building}-${b.roomNo}`)).map((room) => <article className="room-manage-card clay-card" key={room.id}><div className="room-card-top"><span className={`room-type-icon ${room.sexScope.toLowerCase()}`}><DoorOpen size={18} /></span><span className={room.finalized ? "finalized-tag" : "draft-tag"}><span /> {room.finalized ? "FINALIZED" : "READY TO ASSIGN"}</span></div><span className="room-building-label">{room.building}</span><div className="room-number-heading">Room {room.roomNo}</div><div className="room-card-meta"><span className={`sex-tag ${room.sexScope.toLowerCase()}`}>{room.sexScope} only</span><span>{roomUse(room)} / {room.capacity} beds</span></div><div className="room-capacity-track"><span style={{ width: `${Math.min(100, room.capacity ? roomUse(room) / room.capacity * 100 : 0)}%` }} /></div><div className="room-card-actions"><button type="button" onClick={() => onEdit(room)}><Edit3 size={14} /> Edit</button><button type="button" onClick={() => onDelete(room)}><Trash2 size={14} /> Remove</button></div></article>) : <div className="room-empty-card clay-card"><span className="empty-icon"><DoorOpen size={22} /></span><strong>No rooms added yet</strong><span>Rooms are set up separately for each program.</span><button className="button button-outline" onClick={onCreate} disabled={!program}><Plus size={15} /> Add a room</button></div>}</div><div className="assignment-footnote"><span className="footnote-flower">✳</span><span><strong>Automatic placement</strong>Attendees are assigned in name order to a room with matching sex scope and available capacity. Edit rooms anytime and finalize again to refresh the placements.</span><span className="assigned-badge"><CheckCircle2 size={15} /> {allocated.size} placed</span></div></section>;
}

function ModalFrame({ title, eyebrow, children, onClose, className = "" }: { title: string; eyebrow?: string; children: React.ReactNode; onClose: () => void; className?: string }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal-card clay-card ${className}`} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div><button className="modal-close" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>{children}</section></div>;
}

function AttendanceModal({ program, busy, existingNames, onClose, onSubmit }: { program: ProgramRecord; busy: boolean; existingNames: string[]; onClose: () => void; onSubmit: (values: AttendeeFormValues) => Promise<void> }) {
  const [values, setValues] = useState(emptyAttendee);
  const [reviewing, setReviewing] = useState(false);
  const [duplicateName, setDuplicateName] = useState(false);
  const province = provinceData.find((entry) => entry.name === values.province);
  const city = province?.cities.find((entry) => entry.name === values.municipality);
  const setField = <K extends keyof AttendeeFormValues>(key: K, value: AttendeeFormValues[K]) => setValues((previous) => ({ ...previous, [key]: value }));
  async function reviewForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const duplicate = existingNames.includes(displayName(values).trim().toLowerCase());
    setDuplicateName(duplicate);
    setReviewing(true);
  }
  return <ModalFrame title={reviewing ? "Please check your details." : "Confirm your attendance."} eyebrow={reviewing ? "ONE LAST LOOK" : "WE’RE SAVING YOU A SEAT"} onClose={onClose} className="attendance-modal">
    {!reviewing ? <form onSubmit={reviewForm} className="modal-form"><div className="form-event-line"><span><CalendarDays size={15} /> {program.title}</span><span>{eventRange(program)}</span></div><div className="form-section-title"><span>01</span><strong>Your name</strong></div><div className="form-grid form-grid-name"><Field label="First name"><input autoFocus autoComplete="given-name" value={values.firstName} onChange={(event) => setField("firstName", event.target.value)} required /></Field><Field label="Middle name" optional><input autoComplete="additional-name" value={values.middleName} onChange={(event) => setField("middleName", event.target.value)} /></Field><Field label="Last name"><input autoComplete="family-name" value={values.lastName} onChange={(event) => setField("lastName", event.target.value)} required /></Field><Field label="Suffix" optional><select value={values.suffix} onChange={(event) => setField("suffix", event.target.value)}><option value="">None</option>{suffixes.map((suffix) => <option key={suffix}>{suffix}</option>)}</select></Field></div><div className="form-grid form-grid-three"><Field label="Sex at birth"><select value={values.sexAtBirth} onChange={(event) => setField("sexAtBirth", event.target.value as "Male" | "Female")}><option>Male</option><option>Female</option></select></Field><Field label="Office"><input value={values.office} onChange={(event) => setField("office", event.target.value)} required /></Field><Field label="Position"><input value={values.position} onChange={(event) => setField("position", event.target.value)} required /></Field></div><div className="form-section-title"><span>02</span><strong>Where you’re from</strong><span className="form-section-note">Philippine Standard Geographic Code</span></div><div className="form-grid form-grid-three"><Field label="Province"><select value={values.province} onChange={(event) => { setField("province", event.target.value); setField("municipality", ""); setField("barangay", ""); }} required><option value="">Select province</option>{provinceData.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></Field><Field label="Municipality / city"><select value={values.municipality} onChange={(event) => { setField("municipality", event.target.value); setField("barangay", ""); }} disabled={!province} required><option value="">{province ? "Select municipality" : "Choose a province first"}</option>{province?.cities.map((entry) => <option key={entry.name}>{entry.name}</option>)}</select></Field><Field label="Barangay"><select value={values.barangay} onChange={(event) => setField("barangay", event.target.value)} disabled={!city} required><option value="">{city ? "Select barangay" : "Choose a municipality first"}</option>{city?.barangays.map((entry) => <option key={entry}>{entry}</option>)}</select></Field></div><div className="form-section-title"><span>03</span><strong>How to reach you</strong></div><div className="form-grid form-grid-two"><Field label="Contact number"><input autoComplete="tel" type="tel" value={values.contactNo} onChange={(event) => setField("contactNo", event.target.value)} placeholder="09xx xxx xxxx" required /></Field><Field label="Email address"><input autoComplete="email" type="email" value={values.email} onChange={(event) => setField("email", event.target.value)} placeholder="you@example.com" required /></Field></div><div className="form-section-title"><span>04</span><strong>Stay & food</strong></div><div className="form-grid form-grid-two"><Field label="Billeting"><select value={values.billeting} onChange={(event) => setField("billeting", event.target.value as "Yes" | "No")}><option>Yes</option><option>No</option></select></Field><Field label="Food allergy"><select value={values.hasAllergy} onChange={(event) => setField("hasAllergy", event.target.value as "Yes" | "No")}><option>No</option><option>Yes</option></select></Field></div>{values.hasAllergy === "Yes" && <Field label="Please tell us about the allergy"><input value={values.foodAllergy} onChange={(event) => setField("foodAllergy", event.target.value)} placeholder="e.g. peanuts, shellfish" required /></Field>}<p className="form-privacy"><CheckCircle2 size={15} /> Your contact and food details are only available to the Secretariat administrators.</p><div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">Review details <ArrowRight size={16} /></button></div></form> : <div className="review-panel"><div className="review-hero"><span className="review-check"><Check size={21} /></span><div><strong>{displayName(values)}</strong><span>{program.title}</span></div></div>{duplicateName && <div className="duplicate-note">A confirmation under this name already exists. Please review your details before submitting.</div>}<div className="review-grid"><div><small>SEX AT BIRTH</small><strong>{values.sexAtBirth}</strong></div><div><small>OFFICE & POSITION</small><strong>{values.office} · {values.position}</strong></div><div><small>LOCATION</small><strong>{values.barangay}, {values.municipality}, {values.province}</strong></div><div><small>CONTACT</small><strong>{values.contactNo}<br />{values.email}</strong></div><div><small>BILLETING</small><strong>{values.billeting}</strong></div><div><small>FOOD ALLERGY</small><strong>{values.hasAllergy === "Yes" ? values.foodAllergy : "None"}</strong></div></div><div className="review-consent"><CheckCircle2 size={16} /><span>Please make sure these details are right. Once confirmed, the Secretariat will use them for event coordination and room assignments.</span></div><div className="modal-actions"><button type="button" className="button button-quiet" disabled={busy} onClick={() => setReviewing(false)}><ArrowLeft size={16} /> Edit details</button><button type="button" className="button button-primary" disabled={busy} onClick={() => onSubmit(values)}>{busy ? <><span className="button-spinner" /> Saving…</> : <>Confirm attendance <Check size={16} /></>}</button></div></div>}
  </ModalFrame>;
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return <label className="field"><span>{label}{optional && <small>OPTIONAL</small>}</span>{children}</label>;
}

function ProgramModal({ program, busy, onClose, onSave }: { program: ProgramRecord | null; busy: boolean; onClose: () => void; onSave: (values: Omit<ProgramRecord, "id">, id?: string) => Promise<void> }) {
  const [title, setTitle] = useState(program?.title ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [theme, setTheme] = useState(program?.theme ?? "");
  const [dateFrom, setDateFrom] = useState(program?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(program?.dateTo ?? "");
  const [venue, setVenue] = useState(program?.venue ?? "");
  const [flow, setFlow] = useState<ProgramFlowItem[]>(program?.flow ?? []);
  function addFlow() { setFlow((current) => [...current, { id: crypto.randomUUID(), date: dateFrom || dateTo, startTime: "", endTime: "", title: "", description: "", speaker: "" }]); }
  function patchFlow(index: number, key: keyof ProgramFlowItem, value: string) { setFlow((current) => current.map((entry, i) => i === index ? { ...entry, [key]: value } : entry)); }
  function removeFlow(index: number) { setFlow((current) => current.filter((_, i) => i !== index)); }
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); await onSave({ title: title.trim(), description: description.trim(), theme: theme.trim(), dateFrom, dateTo, venue: venue.trim(), flow: flow.filter((entry) => entry.title.trim()).map((entry) => ({ ...entry, title: entry.title.trim(), description: entry.description.trim(), speaker: entry.speaker.trim() })) }, program?.id); }
  return <ModalFrame title={program ? "Edit your program" : "Create a program"} eyebrow="PROGRAM DETAILS" onClose={onClose} className="program-modal"><form className="modal-form" onSubmit={submit}><div className="form-grid form-grid-two"><Field label="Program name"><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Secretariat Year-End Gathering" required /></Field><Field label="Theme" optional><input value={theme} onChange={(event) => setTheme(event.target.value)} placeholder="A theme for the gathering" /></Field></div><Field label="Description"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short introduction to the event" /></Field><div className="form-grid form-grid-three"><Field label="Date from"><input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); if (!dateTo) setDateTo(event.target.value); }} required /></Field><Field label="Date to"><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} min={dateFrom} required /></Field><Field label="Venue"><input value={venue} onChange={(event) => setVenue(event.target.value)} placeholder="Event venue" required /></Field></div><div className="form-section-title flow-form-heading"><span>✳</span><strong>Daily program flow</strong><button type="button" className="small-add-button" onClick={addFlow}><Plus size={14} /> Add session</button></div>{flow.length ? <div className="flow-editor-list">{flow.map((entry, index) => <div className="flow-editor-card" key={entry.id}><div className="flow-editor-top"><span>SESSION {String(index + 1).padStart(2, "0")}</span><button type="button" onClick={() => removeFlow(index)} aria-label="Remove session"><Trash2 size={14} /></button></div><div className="form-grid form-grid-four"><Field label="Date"><input type="date" min={dateFrom || undefined} max={dateTo || undefined} value={entry.date} onChange={(event) => patchFlow(index, "date", event.target.value)} /></Field><Field label="Starts"><input type="time" value={entry.startTime} onChange={(event) => patchFlow(index, "startTime", event.target.value)} /></Field><Field label="Ends"><input type="time" value={entry.endTime} onChange={(event) => patchFlow(index, "endTime", event.target.value)} /></Field><Field label="Session title"><input value={entry.title} onChange={(event) => patchFlow(index, "title", event.target.value)} placeholder="Opening remarks" /></Field></div><div className="form-grid form-grid-two"><Field label="Description" optional><input value={entry.description} onChange={(event) => patchFlow(index, "description", event.target.value)} /></Field><Field label="Speaker / lead" optional><input value={entry.speaker} onChange={(event) => patchFlow(index, "speaker", event.target.value)} /></Field></div></div>)}</div> : <div className="flow-empty"><ClipboardList size={18} /><span>No sessions added. You can add the daily flow now or later.</span><button type="button" onClick={addFlow}>Add the first session</button></div>}<div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : program ? "Save changes" : "Create program"}<Check size={16} /></button></div></form></ModalFrame>;
}

function RoomModal({ programId, room, busy, onClose, onSave }: { programId: string; room: RoomRecord | null; busy: boolean; onClose: () => void; onSave: (values: Omit<RoomRecord, "id" | "finalized">, id?: string) => Promise<void> }) {
  const [building, setBuilding] = useState(room?.building ?? "");
  const [roomNo, setRoomNo] = useState(room?.roomNo ?? "");
  const [sexScope, setSexScope] = useState<"Male" | "Female">(room?.sexScope ?? "Male");
  const [capacity, setCapacity] = useState(room?.capacity ?? 1);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void onSave({ programId, building: building.trim(), roomNo: roomNo.trim(), sexScope, capacity: Number(capacity) }, room?.id); }
  return <ModalFrame title={room ? "Update this room" : "Add a room"} eyebrow="ROOM DETAILS" onClose={onClose} className="room-modal"><form className="modal-form" onSubmit={submit}><div className="room-modal-intro"><DoorOpen size={20} /><span>Set the room scope and capacity. Attendees are placed automatically by matching sex at birth.</span></div><div className="form-grid form-grid-two"><Field label="Building"><input autoFocus value={building} onChange={(event) => setBuilding(event.target.value)} placeholder="e.g. Main building" required /></Field><Field label="Room number"><input value={roomNo} onChange={(event) => setRoomNo(event.target.value)} placeholder="e.g. 101" required /></Field></div><div className="form-grid form-grid-two"><Field label="Sex at birth scope"><select value={sexScope} onChange={(event) => setSexScope(event.target.value as "Male" | "Female")}><option>Male</option><option>Female</option></select></Field><Field label="Capacity"><input type="number" min="1" max="1000" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} required /></Field></div><div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : room ? "Save room" : "Add room"}<Check size={16} /></button></div></form></ModalFrame>;
}

function ConfirmDialog({ title, copy, confirmLabel, busy, onCancel, onConfirm }: { title: string; copy: string; confirmLabel: string; busy?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <ModalFrame title={title} eyebrow="PLEASE CONFIRM" onClose={onCancel} className="confirm-dialog"><div className="confirm-dialog-copy"><span className="confirm-dialog-icon"><CircleHelp size={21} /></span><p>{copy}</p></div><div className="modal-actions"><button type="button" className="button button-quiet" onClick={onCancel}>Go back</button><button type="button" className="button button-primary" disabled={busy} onClick={onConfirm}>{confirmLabel}<ArrowRight size={16} /></button></div></ModalFrame>;
}
