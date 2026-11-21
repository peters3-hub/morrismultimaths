# MMM — Morris Multi Maths

Voice-driven times tables practice with medal levels, timed mastery tests, and a
teacher dashboard. Runs two ways:

- **On its own** — open `index.html` in a browser. Everything works, but accounts
  live in that one browser.
- **As a class server** — run `node server.js` on a laptop. Every device on the
  wifi signs in against the same accounts, and the teacher dashboard updates live.

The only personal detail stored about anyone is a **first name**.

---

## Putting it on the web

**[DEPLOY.md](DEPLOY.md)** walks through publishing the standalone version on
GitHub Pages with your own domain, assuming no prior GitHub knowledge, and what
changes when you move to the class server.

In short: GitHub Pages can serve `index.html`, which gives a working practice
site where each browser keeps its own medals. It cannot run `server.js`, so
shared accounts and the teacher dashboard need a host that runs Node.

---

## Quick start (class server)

You need [Node.js](https://nodejs.org) 18 or newer. There is nothing to install
beyond that — the server has no dependencies.

```bash
./make-cert.sh          # Windows: powershell -ExecutionPolicy Bypass -File make-cert.ps1
node server.js
```

The server prints something like:

```
  On this computer:   https://localhost:8443
  For the class:      https://192.168.1.24:8443
  Curfew:             closed 8:00 pm to 7:00 am, Australia/Sydney (teachers exempt)
  Right now:          open
```

Give students the second address. Open it yourself first to create the
administrator account.

Stop the server with `Ctrl+C`. Progress is saved continuously to `data.json`.

### Options

| Command | What it does |
|---|---|
| `node server.js` | HTTPS on port 8443 (HTTP if no certificate exists) |
| `node server.js --port 9000` | different port |
| `node server.js --http` | plain HTTP — **microphones will not work** except on localhost |
| `node server.js --data /path/class.json` | store accounts somewhere else |

---

## The overnight curfew

The site closes to students between **8:00 pm and 7:00 am**, and this is on by
default. Everything is adjustable under **Policy & data**: the hours, the time
zone, whether teachers are exempt, and whether a test already running is allowed
to finish.

Practice stops dead at closing time. **A mastery test already running gets five
more minutes** — enough to finish — and if the clock beats them, the test ends
and the day's attempt is *not* used up, so nothing is lost. Both the grace and
its length are adjustable.

**Where it is enforced decides whether it works.**

| Running as | What enforces it | Can a child get around it? |
|---|---|---|
| Class server | The server's own clock | **No.** Changing the time on an iPad does nothing — the server refuses the sign-in, and it closes student sessions still open at 8pm. |
| Standalone file / hosted page | The device's clock | **Yes.** There is no server to ask, so it reads the device. A useful fence, not a lock. |

**The clock is Sydney's, everywhere, and it is not a setting.** A child opening
the site in London, Dubai or Los Angeles is shut out at 8pm Sydney time, whatever
their own clock says and whether it is day or night where they are. The zone is
stored as a name rather than a fixed offset, so 8pm stays 8pm on the wall clock
when daylight saving starts and ends — pinning it to AEST would make the curfew
begin at 9pm every summer.

If the browser or server has no timezone database at all, the app falls back to
Sydney's published daylight-saving rules rather than giving up. A curfew that
fails open is not a curfew.

What a student sees after 8pm is a "closed for the night" screen telling them
when it opens again and that their streak and medals are safe. Teachers can still
sign in — there's a button on that screen for it.

**A test already running at 8pm is allowed to finish** (about four more minutes
at most) so the curfew never burns a child's one daily attempt. The moment they
see their result, the site closes. Turn that off in Policy & data if you'd rather
it stopped dead.

---

## Why the certificate is not optional

Browsers only allow microphone access on a **secure origin**. `https://` and
`http://localhost` count. **`http://192.168.1.24` does not** — the microphone is
blocked outright, no prompt, no error the student can act on.

So a plain HTTP server on a LAN IP gives every student the keypad and nothing
else. That is the single most common reason this kind of app "doesn't work on the
other computers".

`make-cert.sh` creates two things:

- **`certs/ca.crt`** — a small certificate authority for your school. **This is
  the file to give IT.** They install it as a trusted root on student devices
  (Intune, Jamf, Group Policy, or by hand). Once installed, students see no
  warnings at all.
- **`certs/server.crt`** and **`certs/server.key`** — the server's own
  certificate, signed by that authority. The server picks these up
  automatically. Never share `server.key`.

Because the server certificate is *signed by* the CA, you can re-run
`make-cert.sh` whenever the laptop's IP changes and restart the server —
students need nothing reinstalled.

**Until IT installs `ca.crt`,** students will see a "Your connection is not
private" warning. They can click **Advanced → Proceed** once per device and voice
will work, but the warning teaches exactly the wrong habit, so it is worth
getting the certificate pushed properly.

### What to send IT

> Please install the attached `ca.crt` as a **trusted root certificate authority**
> on student devices in Years 3–5. It is a locally generated CA used by a
> classroom maths app (Morris Multi Maths) served from a staff laptop over HTTPS
> on the school network. It signs one certificate, for that laptop only, and is
> required because browsers block microphone access on non-HTTPS origins.

---

## Browser support

Voice recognition uses the Web Speech API, which is **not** supported everywhere.
Global support sits around 88%, and one common browser reports support it does
not actually deliver.

| Browser | Voice practice | Notes |
|---|---|---|
| **Chrome** (desktop) | ✅ Works | The reference implementation. Best choice. |
| **Chrome** (Android) | ✅ Works | |
| **Safari** (macOS 14.1+) | ✅ Works | |
| **Safari** (iOS/iPadOS 14.5+) | ✅ Works | **Siri must be enabled** in Settings — Apple's recognition is Siri's engine, and managed school iPads often have it off. Repeat answers need a pause between them; see below. |
| **Samsung Internet** | ✅ Works | |
| **Edge** | ❌ **Do not use** | Exposes `webkitSpeechRecognition`, starts listening, and never returns a result. No error is thrown, so it just appears frozen. |
| **Firefox** | ❌ No support | Never shipped; disabled by default since version 22. |
| **Opera** | ❌ No support | |

The app detects all of these. Edge, Firefox and Opera get a banner naming the
problem and the keypad opens automatically — and there is a watchdog that catches
any *other* browser that starts listening and silently returns nothing.

**Recommendation: standardise the class on Chrome, or Safari on iPads.**

### Answering question after question on an iPhone or iPad

Apple releases the microphone lazily. Start a new recognition the instant the
previous one ends — or the instant the spoken question ends — and iOS hands back
a session that never opens the microphone and never reports a thing: no result,
no error, no end event. The symptom is unmistakable once you have seen it: the
first answer is heard, and every answer after it is ignored.

So the app serialises access to the engine. Nothing starts listening until the
audio session has had time to unwind (450ms on Apple devices, 80ms elsewhere),
a session that fails to open the microphone is retried once with a longer gap,
and if that fails too the student is asked to tap the microphone for each
question — a tap is user activation, which iOS always honours. The status chip
says so, the button pulses, and nobody is told their browser is broken, because
it isn't.

`voicerepeat.mjs` holds this behaviour in place: it runs the real app against
three fake engines — one that behaves, one that needs 400ms between sessions,
and one that will only start from inside a tap — and requires three answers in a
row from the first two and an honest tap prompt from the third.

Two more things worth knowing:

- In Chrome, recognition is **not on-device** — audio goes to a Google speech
  service. The laptop and the student devices need internet access for voice to
  work, even though the app itself is served locally. The keypad works offline.
- Each device asks for microphone permission once, per site. On a fresh device
  the student must click **Allow**.

---

## How the rules work

**Levels.** Bronze (×2 ×5 ×10) → Silver (×3 ×4) → Gold (×6 ×8) → Platinum
(×7 ×9) → Diamond (×11 ×12).

**Mixed practice.** Untimed, unlimited, no clock. Questions are randomised from
the current level, with about 30% drawn from levels already mastered, so earlier
tables stay fluent. Nothing about response speed is recorded.

**One table.** Drill a single table — pick any of ×1 to ×12 and work through the
twelve facts, shuffled or in order from 1 to 12. A strip along the top shows
which ones you've had right and wrong, and a summary appears at the end of each
full pass. Untimed, and it counts towards both your practice record and test
readiness, so a student can grind the ×7s they keep missing and still make
progress towards the medal.

**Mastery test.** 30 questions, **5 seconds each**, every one must be right.
Running out of time counts as wrong. Five perfect tests in a row earns the medal
and unlocks the next level; one mistake resets the run to zero.

**PIN rotation.** Students and teachers are asked for a new PIN every **90 days**.
On the first sign-in after that, the right PIN still gets them in, but the only
thing they can do is set a new one — on the class server the token issued at that
point can reach nothing else. The last three PINs are remembered, so a forced
change cannot just be a toggle between two favourites. A teacher resetting a
student's PIN restarts that student's 90 days. Set the period to 0 under
**Policy & data** to switch it off.

> Worth knowing: forced rotation is no longer considered good practice for
> passwords — people respond with small predictable changes (1234 → 1235), which
> is weaker than one good PIN left alone. At 90 days the friction is mild and it
> satisfies most school policies; the field accepts any number, and 0 switches it
> off.

**One test per 24 hours.** *Starting* a test uses the attempt, whether or not it
is finished — the student is warned before they begin. The lock is enforced by
the server, so clearing browser data does not reset it. Teachers can change the
period, or set it to 0 for unlimited tests, under **Policy & data**.

**Test suggestion.** The app watches practice and only suggests a test when five
signals are met: enough questions since the last test, 80% fact coverage, 90%
accuracy, a sharp last 15 answers, and no shaky facts left. Students can still
start a test early.

**Practice licence.** Counts distinct practice days in a rolling 183-day window
against a 60-day target, and flags accounts due for review on the dashboard.
Both numbers are configurable.

---

## Accounts

- **10 teacher accounts.** Each has its own first name and PIN, and access to the
  year levels an administrator gives them. The first account created is the
  administrator and manages the others.
- **120 student accounts** — 40 in each of the three year levels.
- Students sign in by tapping their **first name** in their year level and
  entering a **PIN**. First names must be unique within a year level; if you have
  two Avas, call one "Ava B".

PINs are hashed (scrypt on the server, SHA-256 in standalone mode) and are never
sent to any browser. That said, treat this as a **classroom convenience, not real
security**: anyone with the `data.json` file or physical access to the laptop can
reset a PIN.

---

## Backups

`data.json` is the whole school. Copy it anywhere to back up; drop it back in
place to restore. Written atomically, so it is never left half-finished.

**Policy & data → Export everything** downloads the same thing from the browser,
and **Class results (CSV)** exports a spreadsheet of the current dashboard.

---

## Troubleshooting

**"Not secure" warning on student devices.** Expected until IT installs
`ca.crt`. Click Advanced → Proceed to test in the meantime.

**Microphone does nothing, no error.** Almost certainly Edge. Switch to Chrome.

**The site says it's closed when it shouldn't be.** It runs on Sydney time, which
is the point — check the closing hours under Policy & data. The server prints its
curfew state on startup.

**A student is stuck on "time for a new PIN".** They must set one they haven't
used recently. If they can't manage it, a teacher can reset their PIN from the
Students tab, which also restarts their 90 days.

**Voice worked yesterday, not today.** Check the laptop's IP hasn't changed
(`node server.js` prints it). If it has, re-run `make-cert.sh`, restart, and give
out the new address.

**Students can't reach the server.** They must be on the same wifi. School
networks often have "client isolation" turned on, which blocks device-to-device
traffic — IT can make an exception for the laptop.

**Port already in use.** `node server.js --port 8444`.

**A student is locked out of their test by accident.** Set the lock to 0 hours in
Policy & data, have them take the test, then set it back to 24.

---

## Files

```
index.html      the whole app — works standalone or served
server.js       the class server (no dependencies)
DEPLOY.md       putting it on the web, for a first-time GitHub user
make-cert.sh    certificate generator, macOS/Linux
make-cert.ps1   certificate generator, Windows
data.json       created on first run: accounts and progress
certs/          created by make-cert: ca.crt, server.crt, server.key
```

Storage sits behind one `Store` object with a pluggable adapter — `LocalAdapter`
for the standalone page, `ServerAdapter` for the class server. The page picks the
right one at startup by asking `/api/public`; nothing else in the app touches
storage.
