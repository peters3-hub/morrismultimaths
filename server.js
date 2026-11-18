#!/usr/bin/env node
/**
 * MMM — Morris Multi Maths — class server
 * ---------------------------------------------------------------------------
 * Zero dependencies. Node 18 or newer. Nothing to npm install.
 *
 *   node server.js                 HTTPS if certs/ exists, otherwise HTTP
 *   node server.js --port 8443     choose the port
 *   node server.js --http          force plain HTTP (localhost testing only)
 *   node server.js --data ./x.json choose where accounts are stored
 *
 * What it does
 *   - serves index.html and the API to every device on the network
 *   - holds the one set of accounts, so a student's progress follows them
 *   - scopes every response: a student only ever receives their own record,
 *     a teacher only the students in their year levels
 *   - enforces the one-test-per-lock-period rule server side, so it cannot be
 *     bypassed by clearing browser storage
 *   - enforces the overnight curfew on ITS OWN clock, so changing the time on
 *     a device achieves nothing
 *   - pushes live updates to teacher dashboards over Server-Sent Events
 *
 * Data is a single JSON file (data.json by default), written atomically.
 * Copy that file to back up; replace it to restore.
 */
"use strict";

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const crypto= require("crypto");
const url   = require("url");

/* ------------------------------------------------------------------ config */
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i+1] ? args[i+1] : fallback;
};
const FORCE_HTTP = args.includes("--http");
const DATA_FILE  = path.resolve(argOf("--data", path.join(__dirname, "data.json")));
const CERT_DIR   = path.resolve(argOf("--certs", path.join(__dirname, "certs")));
const CLIENT     = path.join(__dirname, "index.html");

const MAX_TEACHERS = 10;
const MAX_STUDENTS = 120;
const MAX_PER_YEAR = 40;
const SESSION_HOURS = 12;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;   // PIN attempt window
const LOGIN_MAX_TRIES = 8;                // per account per window

const DEFAULT_CONFIG = {
  testLength: 30,
  requiredStreak: 5,
  testSeconds: 5,
  testLockHours: 24,
  mixRatio: 0.3,
  testIncludesRevision: true,
  lang: "en-AU",
  adaptive: true,
  licenceWindowDays: 183,
  licenceTargetDays: 60,
  yearLevels: [3, 4, 5],
  pinMaxAgeDays: 90,
  curfew: {
    enabled: true,
    startHour: 20,
    endHour: 7,
    teachersExempt: true,
    graceForTestInProgress: true,
    graceMinutes: 5
  }
};

/* The curfew runs on Sydney time, full stop. Not the device's zone, not the
   server's zone, not a setting — a child in another country is shut out at
   8pm Sydney, and so is a laptop whose own clock is set to Honolulu. */
const CURFEW_TZ = "Australia/Sydney";

/* ------------------------------------------------------------------ curfew */
function zonedMinutes(date, timezone){
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: timezone, hour12:false, hour:"2-digit", minute:"2-digit"
    }).formatToParts(date);
    const got = {};
    for(const p of parts) got[p.type] = p.value;
    const h = parseInt(got.hour, 10) % 24, m = parseInt(got.minute, 10);
    if(isNaN(h) || isNaN(m)) return null;
    return h*60 + m;
  } catch(e){ return null; }
}
/* Australia/Sydney's published rules, as a backstop. A machine with no
   timezone database would otherwise make zonedMinutes return null, and a
   curfew that fails open is not a curfew. AEDT (UTC+11) runs from 2am on the
   first Sunday in October to 3am on the first Sunday in April; AEST (UTC+10)
   the rest of the year. */
function sydneyOffsetHours(date){
  const y = date.getUTCFullYear();
  const firstSunday = (year, monthIndex) => {
    const first = new Date(Date.UTC(year, monthIndex, 1));
    return 1 + ((7 - first.getUTCDay()) % 7);
  };
  const dstStart = Date.UTC(y, 9, firstSunday(y, 9), 2 - 10, 0, 0);   // 2am AEST
  const dstEnd   = Date.UTC(y, 3, firstSunday(y, 3), 3 - 11, 0, 0);   // 3am AEDT
  const t = date.getTime();
  return (t >= dstStart || t < dstEnd) ? 11 : 10;
}
function sydneyMinutes(date){
  const d = date || new Date();
  const viaIcu = zonedMinutes(d, CURFEW_TZ);
  if(viaIcu !== null) return viaIcu;
  const utc = d.getUTCHours()*60 + d.getUTCMinutes();
  return ((utc + sydneyOffsetHours(d)*60) % 1440 + 1440) % 1440;
}
function hourLabel(h){
  h = ((h|0) % 24 + 24) % 24;
  const suffix = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return display + ":00 " + suffix;
}
function curfewState(date){
  const c = db.config.curfew || DEFAULT_CONFIG.curfew;
  const now = date || new Date();
  if(!c.enabled) return { closed:false, enabled:false };
  const mins = sydneyMinutes(now);
  const start = c.startHour * 60, end = c.endHour * 60;
  const closed = start === end ? false
               : start > end ? (mins >= start || mins < end)
               : (mins >= start && mins < end);
  let minutesLeft = 0;
  if(closed){
    minutesLeft = (end - mins + 1440) % 1440;
    if(minutesLeft === 0) minutesLeft = 1440;
  }
  return {
    closed, enabled:true, minutesLeft,
    opensAt: hourLabel(c.endHour), closesAt: hourLabel(c.startHour),
    timezone: CURFEW_TZ, teachersExempt: !!c.teachersExempt,
    graceForTestInProgress: !!c.graceForTestInProgress,
    graceMinutes: c.graceMinutes
  };
}
function curfewBlocks(role){
  const state = curfewState();
  if(!state.closed) return null;
  const c = db.config.curfew;
  if(role === "teacher" && c.teachersExempt) return null;
  return state;
}

/* -------------------------------------------------------------- persistence */
let db = { version: 3, config: JSON.parse(JSON.stringify(DEFAULT_CONFIG)), teachers: [], students: [] };

function loadDb(){
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    db.config   = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG)), parsed.config || {});
    db.config.curfew = Object.assign(JSON.parse(JSON.stringify(DEFAULT_CONFIG.curfew)), (parsed.config && parsed.config.curfew) || {});
    db.teachers = Array.isArray(parsed.teachers) ? parsed.teachers : [];
    db.students = Array.isArray(parsed.students) ? parsed.students : [];
    // accounts from before PIN rotation: date their PIN from when they were made
    [...db.teachers, ...db.students].forEach(a => {
      if(!a.pinSetAt) a.pinSetAt = a.createdAt || Date.now();
      if(!Array.isArray(a.pinHistory)) a.pinHistory = [];
    });
    console.log(`Loaded ${db.students.length} students and ${db.teachers.length} teachers from ${DATA_FILE}`);
  } catch(e){
    if(e.code !== "ENOENT") console.error("Could not read data file:", e.message);
    console.log("Starting with an empty school. The first person to open the page sets up the administrator account.");
  }
}
let writeQueued = false;
function saveDb(){
  if(writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    writeQueued = false;
    const tmp = DATA_FILE + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DATA_FILE);            // atomic: never a half-written file
    } catch(e){ console.error("Could not save data:", e.message); }
  });
}

/* --------------------------------------------------------------- PIN + auth */
function hashPin(pin, salt){
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}
function makeSalt(){ return crypto.randomBytes(12).toString("hex"); }
function newId(prefix){ return prefix + "_" + crypto.randomBytes(6).toString("hex"); }
function pinMatches(account, pin){
  if(!account || !account.salt || !account.pinHash) return false;
  const a = Buffer.from(hashPin(pin, account.salt), "hex");
  const b = Buffer.from(account.pinHash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---- PIN rotation ----
   Accounts must set a new PIN every db.config.pinMaxAgeDays (0 turns it off).
   An account whose PIN is past that gets a token that can do exactly one
   thing: set a new PIN. Everything else refuses it. */
function pinAgeDays(account){
  const set = account.pinSetAt || account.createdAt || 0;
  if(!set) return Infinity;
  return (Date.now() - set) / 86400000;
}
function pinExpired(account){
  const max = db.config.pinMaxAgeDays || 0;
  if(!max) return false;
  return pinAgeDays(account) >= max;
}
function pinDaysLeft(account){
  const max = db.config.pinMaxAgeDays || 0;
  if(!max) return null;
  return Math.max(0, Math.ceil(max - pinAgeDays(account)));
}
/** Remember the last few PINs so a forced change can't just be a toggle. */
function rotatePinHistory(account){
  if(!account.pinHash) return;
  account.pinHistory = (account.pinHistory || []).concat([{ salt: account.salt, hash: account.pinHash }]).slice(-3);
}
function pinReused(account, pin){
  if(pinMatches(account, pin)) return true;
  for(const old of account.pinHistory || []){
    const candidate = hashPin(pin, old.salt);
    const a = Buffer.from(candidate, "hex"), b = Buffer.from(old.hash, "hex");
    if(a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}
function applyNewPin(account, pin){
  rotatePinHistory(account);
  account.salt = makeSalt();
  account.pinHash = hashPin(pin, account.salt);
  account.pinSetAt = Date.now();
}

const sessions = new Map();               // token -> {role, id, expires, scope}
function issueToken(role, id, scope){
  const token = crypto.randomBytes(24).toString("base64url");
  sessions.set(token, { role, id, scope: scope || "full", expires: Date.now() + SESSION_HOURS*3600e3 });
  return token;
}
function sessionOf(req, parsed){
  const header = req.headers.authorization || "";
  let token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if(!token && parsed && parsed.query && parsed.query.token) token = parsed.query.token;
  if(!token) return null;
  const s = sessions.get(token);
  if(!s) return null;
  if(s.expires < Date.now()){ sessions.delete(token); return null; }
  s.token = token;
  return s;
}
setInterval(() => {
  const now = Date.now();
  for(const [t, s] of sessions) if(s.expires < now) sessions.delete(t);
}, 10 * 60 * 1000).unref();

const loginTries = new Map();             // accountId -> {count, since}
function loginAllowed(id){
  const rec = loginTries.get(id);
  if(!rec || Date.now() - rec.since > LOGIN_WINDOW_MS){ loginTries.set(id, { count:0, since:Date.now() }); return true; }
  return rec.count < LOGIN_MAX_TRIES;
}
function noteLoginFailure(id){
  const rec = loginTries.get(id) || { count:0, since:Date.now() };
  rec.count++; loginTries.set(id, rec);
}
function clearLoginFailures(id){ loginTries.delete(id); }

/* ------------------------------------------------------------------ helpers */
const cleanName = n => String(n || "").trim().replace(/\s+/g, " ");
const nameKey   = n => cleanName(n).toLowerCase();
const validName = n => /^[\p{L}][\p{L}\d '.-]{0,23}$/u.test(cleanName(n));
const validPin  = p => /^\d{4,8}$/.test(String(p || "").trim());

const findTeacher = id => db.teachers.find(t => t.id === id);
const findStudent = id => db.students.find(s => s.id === id);
function teacherCanSee(teacher, student){
  if(!teacher || !student) return false;
  return teacher.admin || teacher.yearLevels.includes(student.yearLevel);
}
function blankProgress(){
  const LEVELS = ["bronze","silver","gold","platinum","diamond"];
  const levels = {};
  LEVELS.forEach(id => levels[id] = { mastered:false, streak:0, bestStreak:0, tests:0, perfect:0, lastTestAt:0 });
  return {
    currentLevel:"bronze", levels, facts:{}, practiceLog:[], history:[], practiceDates:[],
    prefs:{ speak:true, autoListen:true, singleTable:5, singleOrder:"shuffle" }, lastTestStartedAt:0,
    createdAt: Date.now(), lastActive: 0
  };
}
/** What a client is allowed to see, by role. */
function stateFor(session){
  if(session.role === "student"){
    const s = findStudent(session.id);
    if(!s) return null;
    return { config: db.config, teachers: [], students: [publicStudent(s, true)] };
  }
  const t = findTeacher(session.id);
  if(!t) return null;
  return {
    config: db.config,
    teachers: t.admin ? db.teachers.map(publicTeacher) : [publicTeacher(t)],
    students: db.students.filter(s => teacherCanSee(t, s)).map(s => publicStudent(s, true))
  };
}
const publicTeacher = t => ({ id:t.id, name:t.name, yearLevels:t.yearLevels, admin:!!t.admin,
  createdAt:t.createdAt, pinSetAt:t.pinSetAt || t.createdAt, pinDaysLeft: pinDaysLeft(t) });
const publicStudent = (s, withProgress) => ({
  id:s.id, name:s.name, yearLevel:s.yearLevel, createdAt:s.createdAt,
  pinSetAt:s.pinSetAt || s.createdAt, pinDaysLeft: pinDaysLeft(s),
  ...(withProgress ? { progress:s.progress } : {})
});

/* ------------------------------------------------- live updates (teachers) */
const listeners = new Set();              // {res, teacherId}
function broadcast(yearLevel){
  for(const l of listeners){
    const t = findTeacher(l.teacherId);
    if(!t) continue;
    if(!t.admin && !t.yearLevels.includes(yearLevel)) continue;
    try { l.res.write(`data: {"changed":${JSON.stringify(yearLevel)}}\n\n`); } catch(e){}
  }
}
setInterval(() => {                       // keep proxies from closing idle streams
  for(const l of listeners){ try { l.res.write(": ping\n\n"); } catch(e){} }
}, 25000).unref();

/* Close student sessions the moment the curfew starts, so a device left open
   at 7:59pm cannot keep working past 8. */
let lastCurfewClosed = false;
setInterval(() => {
  const closed = curfewState().closed;
  if(closed){
    // Sweep on every tick while closed, not only on the transition into it.
    // Edge detection misses a change that happens between two ticks — and a
    // session outliving closing time is exactly what this is here to prevent.
    let dropped = 0;
    for(const [tok, s] of sessions){
      if(s.role === "student"){ sessions.delete(tok); dropped++; }
      else if(!db.config.curfew.teachersExempt){ sessions.delete(tok); dropped++; }
    }
    if(dropped) console.log(`Curfew — ${dropped} session${dropped===1?"":"s"} closed.`);
  } else if(lastCurfewClosed){
    console.log("Curfew lifted — the site is open again.");
  }
  lastCurfewClosed = closed;
}, 30000).unref();

/* --------------------------------------------------------------- API routes */
function send(res, status, body, headers){
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store"
  }, headers || {}));
  res.end(data);
}
const fail = (res, status, error) => send(res, status, { error });

function readBody(req){
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", c => {
      size += c.length;
      if(size > 4 * 1024 * 1024){ reject(new Error("Request too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if(!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch(e){ reject(new Error("Body was not valid JSON")); }
    });
    req.on("error", reject);
  });
}

async function handleApi(req, res, parsed){
  const route = parsed.pathname.replace(/^\/api/, "") || "/";
  const method = req.method;

  /* ---- unauthenticated ---- */
  if(route === "/health") return send(res, 200, { ok:true, app:"morris-multi-maths" });

  if(route === "/public" && method === "GET"){
    return send(res, 200, {
      app: "morris-multi-maths",
      needsSetup: db.teachers.length === 0,
      config: { yearLevels: db.config.yearLevels },
      curfew: curfewState(),                                      // the server's clock, the one that counts
      teachers: db.teachers.map(t => ({ id:t.id, name:t.name }))  // names only, for the sign-in picker
    });
  }
  if(route === "/roster" && method === "GET"){
    const year = parseInt(parsed.query.year, 10);
    if(!db.config.yearLevels.includes(year)) return fail(res, 400, "Unknown year level.");
    return send(res, 200, db.students.filter(s => s.yearLevel === year).map(s => ({ id:s.id, name:s.name })));
  }
  if(route === "/setup" && method === "POST"){
    if(db.teachers.length) return fail(res, 409, "This school is already set up.");
    const body = await readBody(req);
    if(!validName(body.name)) return fail(res, 400, "Enter a first name — letters, up to 24 characters.");
    if(!validPin(body.pin))   return fail(res, 400, "PINs must be 4–8 digits.");
    const years = Array.isArray(body.yearLevels) ? body.yearLevels.map(Number).filter(n => !isNaN(n)) : [];
    if(new Set(years).size !== 3) return fail(res, 400, "Choose three different year levels.");
    db.config.yearLevels = years.sort((a,b) => a-b);
    const salt = makeSalt();
    const t = { id:newId("t"), role:"teacher", name:cleanName(body.name), salt, pinHash:hashPin(body.pin, salt),
                pinSetAt: Date.now(), pinHistory: [],
                yearLevels: db.config.yearLevels.slice(), admin:true, createdAt:Date.now() };
    db.teachers.push(t); saveDb();
    console.log(`Administrator account created for ${t.name}.`);
    return send(res, 200, { token: issueToken("teacher", t.id), id: t.id });
  }
  if(route === "/login" && method === "POST"){
    const body = await readBody(req);
    const role = body.role === "teacher" ? "teacher" : "student";
    const blocked = curfewBlocks(role);
    if(blocked){
      return send(res, 403, {
        error: `Morris Multi Maths is closed until ${blocked.opensAt}.`,
        curfew: blocked
      });
    }
    const account = role === "teacher" ? findTeacher(body.id) : findStudent(body.id);
    if(!account) return fail(res, 401, "Account not found.");
    if(!loginAllowed(account.id)) return fail(res, 429, "Too many PIN attempts. Wait a few minutes, or ask your teacher.");
    if(!pinMatches(account, body.pin)){ noteLoginFailure(account.id); return fail(res, 401, "PIN does not match."); }
    clearLoginFailures(account.id);
    if(pinExpired(account)){
      return send(res, 200, {
        token: issueToken(role, account.id, "pin-change"),
        id: account.id, mustChangePin: true,
        pinAgeDays: Math.floor(pinAgeDays(account)),
        pinMaxAgeDays: db.config.pinMaxAgeDays
      });
    }
    return send(res, 200, { token: issueToken(role, account.id), id: account.id, daysUntilPinChange: pinDaysLeft(account) });
  }

  /* ---- authenticated ---- */
  const session = sessionOf(req, parsed);
  if(!session) return fail(res, 401, "Sign in again — your session has expired.");

  if(route === "/logout" && method === "POST"){
    sessions.delete(session.token);
    return send(res, 200, { ok:true });
  }

  /* Change your own PIN. The only thing a pin-change token can reach. */
  if(route === "/pin/self" && method === "POST"){
    const body = await readBody(req);
    const account = session.role === "teacher" ? findTeacher(session.id) : findStudent(session.id);
    if(!account) return fail(res, 404, "Account not found.");
    if(!validPin(body.pin)) return fail(res, 400, "PINs must be 4–8 digits.");
    if(pinReused(account, body.pin)) return fail(res, 409, "Choose a PIN you haven't used recently.");
    applyNewPin(account, body.pin);
    saveDb();
    sessions.delete(session.token);
    return send(res, 200, {
      ok:true,
      token: issueToken(session.role, account.id),      // a full session, now the PIN is fresh
      id: account.id,
      daysUntilPinChange: pinDaysLeft(account)
    });
  }

  if(session.scope === "pin-change"){
    return send(res, 403, { error:"Set a new PIN before carrying on.", pinChangeRequired:true });
  }
  if(route === "/state" && method === "GET"){
    const state = stateFor(session);
    return state ? send(res, 200, state) : fail(res, 404, "Account no longer exists.");
  }

  /* ---- student's own progress ----
     Deliberately NOT blocked by the curfew: a test finishing inside the grace
     period still has to save, and losing a child's work at 8pm would be worse
     than the few extra seconds it buys them. */
  const progressMatch = route.match(/^\/students\/([^/]+)\/progress$/);
  if(progressMatch && method === "PUT"){
    const id = decodeURIComponent(progressMatch[1]);
    const student = findStudent(id);
    if(!student) return fail(res, 404, "Student not found.");
    if(session.role === "student" && session.id !== id) return fail(res, 403, "You can only save your own progress.");
    if(session.role === "teacher" && !teacherCanSee(findTeacher(session.id), student)) return fail(res, 403, "Not your year level.");
    const body = await readBody(req);
    if(!body || typeof body !== "object") return fail(res, 400, "Progress must be an object.");
    // the lock timestamp is the server's to set, never the client's
    const lockedAt = student.progress.lastTestStartedAt || 0;
    student.progress = Object.assign(blankProgress(), body, { lastTestStartedAt: lockedAt });
    student.progress.lastActive = Date.now();
    saveDb();
    broadcast(student.yearLevel);
    return send(res, 200, { ok:true });
  }

  /* ---- the one-test-per-period rule ---- */
  if(route === "/test/start" && method === "POST"){
    if(session.role !== "student") return fail(res, 403, "Only students take tests.");
    const blocked = curfewBlocks("student");
    if(blocked) return send(res, 403, { error:`Closed until ${blocked.opensAt}.`, curfew: blocked });
    const student = findStudent(session.id);
    if(!student) return fail(res, 404, "Student not found.");
    const hours = db.config.testLockHours || 0;
    const started = student.progress.lastTestStartedAt || 0;
    if(hours && started){
      const until = started + hours*3600e3;
      if(until > Date.now()){
        return send(res, 423, { error:"Today's mastery test has already been used.", until }, {});
      }
    }
    student.progress.lastTestStartedAt = Date.now();
    student.progress.lastActive = Date.now();
    saveDb();
    broadcast(student.yearLevel);
    return send(res, 200, { startedAt: student.progress.lastTestStartedAt });
  }

  /* ---- teacher-only from here ---- */
  if(session.role !== "teacher") return fail(res, 403, "Teachers only.");
  const teacher = findTeacher(session.id);
  if(!teacher) return fail(res, 401, "Sign in again.");

  if(route === "/events" && method === "GET"){
    res.writeHead(200, {
      "Content-Type":"text/event-stream",
      "Cache-Control":"no-cache, no-transform",
      "Connection":"keep-alive",
      "X-Accel-Buffering":"no"
    });
    res.write("retry: 3000\n\n");
    const listener = { res, teacherId: teacher.id };
    listeners.add(listener);
    req.on("close", () => listeners.delete(listener));
    return;
  }

  if(route === "/students" && method === "POST"){
    const body = await readBody(req);
    const year = parseInt(body.yearLevel, 10);
    if(!db.config.yearLevels.includes(year)) return fail(res, 400, "Choose one of this school's year levels.");
    if(!teacher.admin && !teacher.yearLevels.includes(year)) return fail(res, 403, "That year level isn't yours.");
    if(db.students.length >= MAX_STUDENTS) return fail(res, 409, `This site allows ${MAX_STUDENTS} student accounts and all ${MAX_STUDENTS} are in use.`);
    if(db.students.filter(s => s.yearLevel === year).length >= MAX_PER_YEAR)
      return fail(res, 409, `Year ${year} already has its ${MAX_PER_YEAR} student accounts.`);
    if(!validName(body.name)) return fail(res, 400, "Enter a first name — letters, up to 24 characters.");
    if(db.students.some(s => s.yearLevel === year && nameKey(s.name) === nameKey(body.name)))
      return fail(res, 409, `Year ${year} already has a ${cleanName(body.name)}. Add an initial, like “${cleanName(body.name)} B”.`);
    if(!validPin(body.pin)) return fail(res, 400, "PINs must be 4–8 digits.");
    const salt = makeSalt();
    const s = { id:newId("s"), role:"student", name:cleanName(body.name), yearLevel:year,
                salt, pinHash:hashPin(body.pin, salt), pinSetAt: Date.now(), pinHistory: [],
                createdAt:Date.now(), progress: blankProgress() };
    db.students.push(s); saveDb(); broadcast(year);
    return send(res, 200, publicStudent(s, true));
  }

  const studentMatch = route.match(/^\/students\/([^/]+)$/);
  if(studentMatch && method === "DELETE"){
    const s = findStudent(decodeURIComponent(studentMatch[1]));
    if(!s) return fail(res, 404, "Student not found.");
    if(!teacherCanSee(teacher, s)) return fail(res, 403, "Not your year level.");
    db.students = db.students.filter(x => x.id !== s.id);
    for(const [tok, sess] of sessions) if(sess.id === s.id) sessions.delete(tok);
    saveDb(); broadcast(s.yearLevel);
    return send(res, 200, { ok:true });
  }

  if(route === "/teachers" && method === "POST"){
    if(!teacher.admin) return fail(res, 403, "Only administrators manage teacher accounts.");
    const body = await readBody(req);
    if(db.teachers.length >= MAX_TEACHERS) return fail(res, 409, `This site allows ${MAX_TEACHERS} teacher accounts and all ${MAX_TEACHERS} are in use.`);
    if(!validName(body.name)) return fail(res, 400, "Enter a first name — letters, up to 24 characters.");
    if(db.teachers.some(t => nameKey(t.name) === nameKey(body.name)))
      return fail(res, 409, "Another teacher already uses that first name. Add an initial, like “Sam T”.");
    if(!validPin(body.pin)) return fail(res, 400, "PINs must be 4–8 digits.");
    const years = (Array.isArray(body.yearLevels) ? body.yearLevels.map(Number) : []).filter(y => db.config.yearLevels.includes(y));
    if(!years.length && !body.admin) return fail(res, 400, "Select at least one year level for this teacher.");
    const salt = makeSalt();
    const t = { id:newId("t"), role:"teacher", name:cleanName(body.name), salt, pinHash:hashPin(body.pin, salt),
                pinSetAt: Date.now(), pinHistory: [],
                yearLevels: years, admin: !!body.admin, createdAt: Date.now() };
    db.teachers.push(t); saveDb();
    return send(res, 200, publicTeacher(t));
  }

  const teacherMatch = route.match(/^\/teachers\/([^/]+)$/);
  if(teacherMatch && method === "DELETE"){
    if(!teacher.admin) return fail(res, 403, "Only administrators manage teacher accounts.");
    const t = findTeacher(decodeURIComponent(teacherMatch[1]));
    if(!t) return fail(res, 404, "Teacher not found.");
    if(t.admin && db.teachers.filter(x => x.admin).length <= 1) return fail(res, 409, "This is the only administrator account.");
    db.teachers = db.teachers.filter(x => x.id !== t.id);
    for(const [tok, sess] of sessions) if(sess.id === t.id) sessions.delete(tok);
    saveDb();
    return send(res, 200, { ok:true });
  }

  if(route === "/pin" && method === "POST"){
    const body = await readBody(req);
    if(!validPin(body.pin)) return fail(res, 400, "PINs must be 4–8 digits.");
    const target = findStudent(body.id) || findTeacher(body.id);
    if(!target) return fail(res, 404, "Account not found.");
    const isStudent = !!findStudent(body.id);
    if(isStudent && !teacherCanSee(teacher, target)) return fail(res, 403, "Not your year level.");
    if(!isStudent && !teacher.admin && target.id !== teacher.id) return fail(res, 403, "Only administrators change another teacher's PIN.");
    applyNewPin(target, body.pin);                      // resets their 30-day clock too
    saveDb();
    return send(res, 200, { ok:true });
  }

  if(route === "/config" && method === "PUT"){
    const body = await readBody(req);
    const c = db.config;
    const num = (v, lo, hi, dflt) => { const n = parseInt(v, 10); return isNaN(n) ? dflt : Math.max(lo, Math.min(hi, n)); };
    c.testLength        = num(body.testLength, 5, 60, c.testLength);
    c.requiredStreak    = num(body.requiredStreak, 1, 10, c.requiredStreak);
    c.testSeconds       = num(body.testSeconds, 3, 60, c.testSeconds);
    c.testLockHours     = num(body.testLockHours, 0, 168, c.testLockHours);
    c.licenceWindowDays = num(body.licenceWindowDays, 30, 730, c.licenceWindowDays);
    c.licenceTargetDays = num(body.licenceTargetDays, 1, 365, c.licenceTargetDays);
    c.pinMaxAgeDays     = num(body.pinMaxAgeDays, 0, 365, c.pinMaxAgeDays);
    const mix = parseFloat(body.mixRatio);
    if(!isNaN(mix) && mix >= 0 && mix <= 1) c.mixRatio = mix;
    if(typeof body.testIncludesRevision === "boolean") c.testIncludesRevision = body.testIncludesRevision;
    if(typeof body.adaptive === "boolean") c.adaptive = body.adaptive;
    if(/^[a-z]{2}-[A-Z]{2}$/.test(String(body.lang || ""))) c.lang = body.lang;
    if(body.curfew && typeof body.curfew === "object"){
      const cu = c.curfew;
      if(typeof body.curfew.enabled === "boolean") cu.enabled = body.curfew.enabled;
      cu.startHour = num(body.curfew.startHour, 0, 23, cu.startHour);
      cu.endHour   = num(body.curfew.endHour,   0, 23, cu.endHour);
      cu.graceMinutes = num(body.curfew.graceMinutes, 0, 30, cu.graceMinutes);
      if(typeof body.curfew.teachersExempt === "boolean") cu.teachersExempt = body.curfew.teachersExempt;
      if(typeof body.curfew.graceForTestInProgress === "boolean") cu.graceForTestInProgress = body.curfew.graceForTestInProgress;
      delete cu.timezone;                               // the zone is not a setting
    }
    saveDb();
    db.config.yearLevels.forEach(broadcast);
    return send(res, 200, c);
  }

  return fail(res, 404, "Unknown endpoint.");
}

/* ------------------------------------------------------------ static client */
let clientHtml = null, clientMtime = 0;
function serveClient(res){
  try {
    const stat = fs.statSync(CLIENT);
    if(!clientHtml || stat.mtimeMs !== clientMtime){
      clientHtml = fs.readFileSync(CLIENT);
      clientMtime = stat.mtimeMs;
    }
    res.writeHead(200, {
      "Content-Type":"text/html; charset=utf-8",
      "Content-Length": clientHtml.length,
      "Cache-Control":"no-cache",
      "X-Content-Type-Options":"nosniff",
      "Referrer-Policy":"no-referrer",
      "Permissions-Policy":"microphone=(self)"
    });
    res.end(clientHtml);
  } catch(e){
    res.writeHead(500, { "Content-Type":"text/plain" });
    res.end("index.html is missing from the server folder.");
  }
}

/* -------------------------------------------------------------------- serve */
function requestHandler(req, res){
  const parsed = url.parse(req.url, true);
  if(parsed.pathname.startsWith("/api")){
    handleApi(req, res, parsed).catch(err => {
      console.error("API error:", err && err.message);
      if(!res.headersSent) fail(res, 500, "Something went wrong on the server.");
    });
    return;
  }
  if(req.method !== "GET" && req.method !== "HEAD"){
    res.writeHead(405, { Allow:"GET" }); res.end(); return;
  }
  if(parsed.pathname === "/favicon.ico"){ res.writeHead(204); res.end(); return; }
  serveClient(res);                                   // single-page app: everything else is the app
}

function localAddresses(){
  const out = [];
  const nets = os.networkInterfaces();
  for(const name of Object.keys(nets)){
    for(const net of nets[name] || []){
      if(net.family === "IPv4" && !net.internal) out.push(net.address);
    }
  }
  return out;
}

function start(){
  loadDb();
  const port = parseInt(argOf("--port", FORCE_HTTP ? "8080" : "8443"), 10);
  let server, scheme = "http";

  const keyPath = path.join(CERT_DIR, "server.key");
  const crtPath = path.join(CERT_DIR, "server.crt");
  const haveCerts = fs.existsSync(keyPath) && fs.existsSync(crtPath);

  if(!FORCE_HTTP && haveCerts){
    server = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(crtPath) }, requestHandler);
    scheme = "https";
  } else {
    server = http.createServer(requestHandler);
    if(!FORCE_HTTP){
      console.log("\n  No certificate found in " + CERT_DIR);
      console.log("  Running over plain HTTP. Microphones will NOT work for anyone except");
      console.log("  someone browsing to localhost on this machine. Run ./make-cert.sh first.\n");
    }
  }

  server.on("error", err => {
    if(err.code === "EADDRINUSE") console.error(`\nPort ${port} is already in use. Try: node server.js --port ${port+1}\n`);
    else console.error("Server error:", err.message);
    process.exit(1);
  });

  server.listen(port, "0.0.0.0", () => {
    const addrs = localAddresses();
    console.log("\n  MMM — Morris Multi Maths is running.\n");
    console.log(`  On this computer:   ${scheme}://localhost:${port}`);
    addrs.forEach(a => console.log(`  For the class:      ${scheme}://${a}:${port}`));
    if(!addrs.length) console.log("  (no network address found — is wifi on?)");
    console.log(`\n  Accounts file:      ${DATA_FILE}`);
    console.log(`  Students: ${db.students.length}/${MAX_STUDENTS}   Teachers: ${db.teachers.length}/${MAX_TEACHERS}`);
    const cu = db.config.curfew;
    if(cu.enabled){
      const st = curfewState();
      console.log(`  Curfew:             closed ${hourLabel(cu.startHour)} to ${hourLabel(cu.endHour)}, ${CURFEW_TZ}` +
                  (cu.teachersExempt ? " (teachers exempt)" : ""));
      console.log(`  Right now:          ${st.closed ? `CLOSED — opens in ${st.minutesLeft} min` : "open"}`);
      lastCurfewClosed = st.closed;
    } else {
      console.log("  Curfew:             off");
    }
    if(!db.teachers.length) console.log("\n  Nobody has set this up yet — open the address above to create the administrator account.");
    console.log("\n  Press Ctrl+C to stop.\n");
  });

  const shutdown = () => {
    console.log("\nSaving and shutting down…");
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch(e){}
    for(const l of listeners){ try { l.res.end(); } catch(e){} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if(require.main === module) start();
module.exports = { start, hashPin, validName, validPin, curfewState, zonedMinutes,
                   sydneyMinutes, sydneyOffsetHours, hourLabel, CURFEW_TZ, pinAgeDays, pinExpired };
