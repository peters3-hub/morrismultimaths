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

## Making changes later

Edit a file on GitHub directly: open it, click the pencil icon, change it,
click **Commit changes**. GitHub Pages rebuilds within a minute or two.

For bigger changes, upload a new copy the same way as Part 2. GitHub keeps
every version, so nothing is lost.

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

**Microphone does nothing.** Wrong browser (use Chrome or Safari), or the site
is not on HTTPS, or permission was denied — in Chrome, click the icon at the
left of the address bar to reset it.

**The site says it's closed.** It closes 8pm–7am Sydney time, deliberately,
for everyone in the world. A teacher can change the hours under Policy & data
once a school is set up.
