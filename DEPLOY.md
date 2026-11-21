# Putting Morris Multi Maths on your domain

A walkthrough for someone who has never used GitHub. Nothing here needs a
terminal. Budget about an hour, most of which is waiting for DNS.

---

## First, what each piece actually does

Four separate things, and it helps to keep them straight:

| Piece | What it is | What it does here |
|---|---|---|
| **The code** | `index.html` and friends | The app itself |
| **GitHub** | A website that stores code | Keeps your files and their history |
| **GitHub Pages** | A free service attached to GitHub | Serves `index.html` to the public |
| **Your domain** | The name you bought | Points at GitHub Pages so people type your name, not GitHub's |

The one thing that trips people up: **GitHub stores files, it does not run
programs.** GitHub Pages can hand `index.html` to a browser, but it cannot run
`server.js`. That is why this guide puts the standalone version up first, and
why the class server needs a different kind of host later (Part 6).

---

## Part 1 — Make a GitHub account

1. Go to **github.com** and click **Sign up**.
2. Use an email you'll keep. Pick a username — it becomes part of your web
   address, so something plain is better than something clever.
3. Verify the email they send you.
4. Choose the **Free** plan. Everything here works on it.

---

## Part 2 — Put the files on GitHub

You already have a repository at
`github.com/peters3-hub/morrismultimaths`. If you are starting fresh instead:
click the **+** at the top right of GitHub → **New repository** → name it
`morrismultimaths` → **Public** → **Create repository**.

Now upload the files. No software needed:

1. Open your repository page.
2. Click **Add file** → **Upload files**.
3. Unzip `morris-multi-maths.zip` on your computer. You'll see `index.html`,
   `server.js`, `README.md`, `DEPLOY.md`, `make-cert.sh`, `make-cert.ps1`.
4. Drag **all of them** into the browser window.
5. In the **Commit changes** box at the bottom, type something like
   `First upload`, then click **Commit changes**.

A "commit" is just a save with a note attached. GitHub keeps every one, so you
can always see what changed and go back.

> **Nothing secret goes in here.** The repository is public — anyone can read
> it. Never upload `data.json` (your accounts and PIN hashes) or the `certs/`
> folder (a private key). The included `.gitignore` already excludes both, but
> when you drag files in by hand, you are the one choosing. Just don't select
> them.

---

## Part 3 — Turn on GitHub Pages

1. In your repository, click **Settings** (top right of the repo, not your
   account settings).
2. In the left sidebar, click **Pages**.
3. Under **Build and deployment** → **Source**, choose **Deploy from a branch**.
4. Under **Branch**, choose **main** and folder **/ (root)**. Click **Save**.
5. Wait two or three minutes, then reload the page. A green banner appears with
   an address like `https://peters3-hub.github.io/morrismultimaths/`.

Click it. The app should load. **If it works here, the hard part is done** —
everything after this is just pointing your name at it.

---

## Part 4 — Point your domain at it

Two halves: tell GitHub your domain, and tell your domain about GitHub.

### 4a. Tell GitHub

1. Still in **Settings → Pages**, find **Custom domain**.
2. Type your domain. Use the `www` form — `www.yourdomain.com` — it is more
   reliable than the bare name and easier to move later.
3. Click **Save**. GitHub adds a file called `CNAME` to your repository. That
   is expected; leave it alone.

### 4b. Tell your domain registrar

Sign in wherever you bought the domain and find **DNS**, **DNS settings** or
**Manage DNS**. You are adding records. Each has a type, a name and a value.

**For `www.yourdomain.com`** — one record:

| Type | Name | Value |
|---|---|---|
| CNAME | `www` | `peters3-hub.github.io` |

Note the value has **no repository name** on the end, and a trailing dot may be
added automatically. That's fine.

**If you also want the bare `yourdomain.com` to work**, add four A records, all
with the name `@` (which means "the domain itself"):

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

Some registrars offer **ALIAS** or **ANAME** instead, in which case one record
pointing `@` at `peters3-hub.github.io` does the same job.

Delete any existing records for `@` or `www` that point somewhere else, such as
a registrar's parking page. Two records fighting is the usual reason this
doesn't work.

### 4b-Porkbun. If you bought the domain at Porkbun

Porkbun has a one-click setup for exactly this.

**Before you click it:** Quick DNS Config *reconfigures* your records. If this
domain already handles **email** — an MX record, or Porkbun's email forwarding
— write those records down first, because you may need to put them back. If the
domain only has Porkbun's parking page on it, there is nothing to lose.

1. Log in at **porkbun.com**. You land on **Domain Management** (if not, click
   **ACCOUNT** at the top right → **Domain Management**).
2. Find your domain and click the **DNS** button beneath it. (The long way:
   **Details** on the right → **DNS Records** → the edit icon.)
3. In the **Manage DNS Records** panel, scroll to **Quick DNS Config**.
4. Click **Github**, then **OK** in the confirmation box. This puts GitHub's
   apex records in for you — the four A records from the table above.
5. An **Additional DNS Requirements** box appears, asking for the subdomain
   record. Fill it in:
   - **Type:** CNAME
   - **Host:** `www`
   - **Answer:** replace `USERNAME` with your GitHub username, giving
     `peters3-hub.github.io`
   - Click **Submit**.
6. Check **Current Records** below. You should see four A records for the bare
   domain and one CNAME for `www`.

**Doing it by hand instead**, if you would rather see every record: click
**Add Record** and use these fields —

- **Type** — A or CNAME
- **Host** — `www` for the subdomain, **leave it blank** for the bare domain
  (Porkbun treats empty as the root; there is no `@` to type)
- **Answer** — the IP address, or `peters3-hub.github.io` for the CNAME
- **TTL** — leave the default

Add the four A records with a blank Host, and one CNAME with Host `www`. Delete
any pre-existing A, CNAME or ALIAS record for the same names first — Porkbun
ships new domains with records pointing at its own parking page, and two records
for one name is the usual reason this silently fails.

> Porkbun also offers **ALIAS**, which is their answer for hosts that give you
> a name rather than an IP address. You do not need it here: GitHub publishes
> real IP addresses, so plain A records are the simpler choice.

### 4c. Wait

DNS changes take anywhere from ten minutes to a few hours. Make a cup of tea.

Back in **Settings → Pages**, GitHub shows a green tick once it sees your
records. Then tick **Enforce HTTPS**. It may be greyed out for up to 24 hours
while a certificate is issued — that is normal, and you must wait for it.

**Do not hand the address out before HTTPS is on.** Without it, browsers block
the microphone and the whole point of the app is gone.

---

## Part 5 — Check it properly

Open your domain on a phone and on a laptop, in **Chrome or Safari**:

- [ ] The address bar shows a padlock (HTTPS is working)
- [ ] You see **"Welcome to Morris Multi Maths"** with two buttons
- [ ] Tap **Practise on this device**, type a name, and a question appears
- [ ] Tap the microphone, allow access when asked, and say an answer
- [ ] Close the tab, reopen the site — it goes straight back to practice

If the microphone does nothing, check you are not in Edge or Firefox. Neither
can do speech recognition; the app will say so and open the keypad.

---

## Part 5b — Phones, tablets and the microphone

The layout works on phones: the page opens on the question with the
microphone in reach, down to a 320px screen. On a narrow screen the level
cards become one row you swipe sideways, and the mode tabs shorten.

The **microphone** is the part that depends on the browser, and it is worth
getting right before you hand the address out.

| Device | Use | Not this |
|---|---|---|
| Windows / Mac laptop | **Chrome** | Edge, Firefox, Opera |
| Android phone or tablet | **Chrome** or Samsung Internet | Firefox |
| iPhone / iPad | **Safari** | Chrome, Edge and Firefox for iOS |

The iPhone row surprises people. Every browser on iOS is Safari underneath,
but third-party iOS browsers don't expose speech recognition — so "just use
Chrome", which is right everywhere else, is wrong on an iPad.

### iPads: Siri has to be on

Apple shipped speech recognition in Safari 14.1 / **iOS and iPadOS 14.5**, and
WebKit's own announcement is explicit about what it runs on: *"Safari supports
speech recognition powered by the same speech engine as Siri… users will need
Siri enabled in System Preferences on macOS or Settings in iOS or iPadOS for
the API to be available to be used."*

**That is the thing to check on school iPads.** Managed devices very often have
Siri switched off by policy, and when it is off the microphone simply isn't
available — on an iPad that is otherwise perfectly capable. If your iPads are
managed by IT, ask for **Settings → Siri & Search** to be left on, or for
Siri to be allowed in the device profile.

The app now says this itself: an iPad with no speech recognition is told to
turn Siri on, and an iPad running Chrome is told to open the page in Safari.
Neither is sent chasing a browser that cannot help.

Still worth borrowing one iPad and trying it before you buy a set.

### iPhones and iPads: answer after answer

Apple hands the microphone back slowly. If the next question starts listening
the instant the last answer finished — or the instant the spoken question
finished — iOS opens a session that never hears anything and never reports a
problem. That looks exactly like one answer working and every answer after it
being ignored.

The app now waits for the audio to clear before listening again, and if the
device still refuses to listen hands-free, it stops pretending: the microphone
button pulses and the student taps it once per question. On an iPhone or iPad
that is the normal way in, because a tap is something iOS always honours.

Nothing to configure, and nothing changes on Chrome or Android.

Three more things that decide whether the microphone works:

1. **HTTPS.** No padlock, no microphone. This is why Part 4 matters.
2. **Permission.** Each device asks once. The student taps **Allow**. If they
   tap Block by accident, it is reset from the icon at the left of the address
   bar.
3. **Internet.** Chrome does the recognition on Google's servers, not on the
   device, so voice needs a connection even though the page is yours. The
   keypad works offline.

**Nothing here breaks the app.** On a browser that cannot listen, the site says
so plainly and opens the keypad — and there is a watchdog for browsers that
claim support and then return nothing, which is exactly what Edge does.

## Part 6 — What this version can and cannot do

What you have just published is the **standalone** version. Be clear-eyed about
it before you tell anyone the address:

**It can:** let anyone practise, remember their medals and streaks between
visits, run the one-table drill, run mastery tests, and close overnight.

**It cannot:** share anything between devices. Each browser is its own island.
A child practising on the home iPad and the school laptop has two separate sets
of medals. There is no teacher dashboard, because there is nothing to gather.
The overnight curfew reads the device's clock, so a determined child can change
it.

That makes it genuinely good as a **home practice site** and not yet a
classroom tool.

---

## Part 7 — When you want the real thing

The full version — shared accounts, the teacher dashboard, a curfew and daily
test lock nobody can fiddle with — needs a host that **runs** Node, which
GitHub Pages does not.

The path from here is short, because the code is already written and already on
GitHub:

1. Sign up at a host that runs Node apps from a GitHub repository. Render,
   Railway and Fly.io all do this; check their current free and paid tiers, as
   these change.
2. Point it at your `morrismultimaths` repository.
3. Set the start command to `node server.js` and the port to whatever the host
   provides.
4. Move your domain from GitHub Pages to that host — same registrar screen,
   different value.

Two things change for the better: the host issues HTTPS automatically, so the
certificate scripts and the whole "ask IT to install `ca.crt`" job disappear.
And the curfew, the daily test lock and PIN rotation become enforced by the
server rather than suggested by the browser.

One thing to decide before that step: a public address means 120 children's
accounts are reachable from anywhere, protected by first names and 4-digit
PINs. That is probably fine for times tables practice, and it is worth
deciding on purpose rather than by accident.

---

## Uploading an update

When you get a new copy of the files, updating GitHub is the **same action as
the first upload**. There is no separate "update" button.

1. Unzip the new `morris-multi-maths.zip`.
2. Repository → **Add file** → **Upload files**.
3. Drag **all** the files in, even the ones that haven't changed. GitHub works
   out which are different.
4. Type what changed in the commit box — `Phone layout fixes`, say.
5. **Commit changes**.

Three things people worry about, and shouldn't:

- **It won't delete anything.** Uploading replaces files with the same name and
  leaves every other file alone. Your `CNAME` file (the one GitHub made when you
  set the custom domain) and `.gitignore` both survive.
- **You can't lose the old version.** Every commit is kept. Click **History** on
  any file to see what changed and go back.
- **The live site updates itself.** GitHub Pages rebuilds a minute or two after
  the commit. If you still see the old version, hold Shift and reload.

Only `index.html` changes what visitors see while you are on GitHub Pages.
`server.js` matters later, when you move to a host that runs it.

For a one-line fix you can skip all this: open the file on GitHub, click the
pencil icon, edit it, **Commit changes**.

---

## When something is wrong

**404 on the GitHub address.** `index.html` must be at the top level of the
repository, not inside a folder. Check Settings → Pages shows branch `main`
and folder `/ (root)`.

**404 on your own domain, but GitHub's address works.** DNS hasn't propagated,
or an old record is still pointing elsewhere. Check Settings → Pages for the
error GitHub reports.

**"Not secure" or no padlock.** Enforce HTTPS isn't on yet. Wait for it to
become available, then tick it.

**"This site can't provide a secure connection — uses an unsupported
protocol" / `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`.** Nothing with a certificate
for your name is answering on HTTPS. It is not the app — the browser never got
as far as loading a page. Work through these in order, and stop when one of
them is the answer:

1. **Try `https://peters3-hub.github.io/morrismultimaths/`.** If *that* works,
   the files and Pages are fine and the problem is only the domain. If it 404s,
   Pages isn't serving anything yet — go back to Part 2 and Part 3.
2. **Check GitHub has been told the domain.** Settings → Pages → Custom domain
   must contain your domain, saved, with a green tick. GitHub only requests a
   certificate for the name you put in that box.
3. **Give the certificate time.** GitHub requests it from Let's Encrypt after
   the DNS checks out, which can take an hour. Until it arrives, HTTPS fails
   with this exact error. If it is still failing the next day, clear the Custom
   domain box, Save, re-enter it, Save — that makes GitHub ask again.
4. **Check for a leftover Porkbun record.** Parking pages and URL forwarding
   answer on port 443 with a certificate for someone else's name, which
   produces this error precisely. Delete any default/parking A record, any
   ALIAS, and any URL forwarding, and leave only: four A records on the bare
   name pointing at GitHub, and `www` as a CNAME to `peters3-hub.github.io`.
5. **Both names, not one.** If the apex is set up and `www` is not (or the
   reverse), the one you typed has no certificate. Set up both, since children
   will type `www` out of habit.

While you are sorting it out, the GitHub address works and voice works on it,
so you can keep testing.

**Microphone does nothing.** Wrong browser (use Chrome or Safari), or the site
is not on HTTPS, or permission was denied — in Chrome, click the icon at the
left of the address bar to reset it.

**The site says it's closed.** It closes 8pm–7am Sydney time, deliberately,
for everyone in the world. A teacher can change the hours under Policy & data
once a school is set up.
