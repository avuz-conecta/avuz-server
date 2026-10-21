# QA: webmail session after an Avuz Conecta logout

**Where:** staging-3, https://conectahmls3.avuz.app (frames ConectaMail staging https://conectamailhml.avuz.app, stack 64).
**Browser:** one normal (non-private) window unless a step says otherwise. Use the same browser for the whole run.
**You need:** two Avuz Conecta test users with working mailboxes, **User A** and **User B** (different mailboxes).

Record for every step: PASS / FAIL, what you saw, and the time (HH:MM).

---

## T1 — Opening the webmail directly after logout (the known gap)

1. Log in to conectahmls3 as **User A**. Open **Mail** and wait until A's inbox shows.
2. Log out of Avuz Conecta (avatar, top right → **Sair**). Wait until the Avuz Conecta login page shows.
3. In the **same window**, type https://conectamailhml.avuz.app in the address bar and press Enter.

**Expected:** the ConectaMail login screen ("Entre com sua conta de e-mail"). A's inbox must **not** show.
**Today we expect FAIL** (A's inbox shows). This is the bug the fix targets; please confirm it.

4. If A's inbox showed: note whether you can open a message and whether "Sair" is visible at the top right.

## T2 — Another user on the same browser, inside Avuz Conecta

1. Log in as **User A**, open **Mail**, and wait for A's inbox.
2. Log out of Avuz Conecta.
3. Log in as **User B** and open **Mail**.

**Expected:** B's inbox (B's address in the folder-column footer, "Caixa de e-mail"), or B's mailbox login screen. **Never A's inbox, not even for a second.**

## T3 — Same user logs back in (must keep working)

1. Log in as **User A**, open **Mail**, then log out of Avuz Conecta.
2. Log in again as **User A** and open **Mail**.

**Expected:** A's inbox opens by itself, with no webmail login screen (silent SSO).

## T4 — Closing the browser without logging out (must keep working)

1. Log in as **User A**, with "Lembre-se de mim" checked, and open **Mail**.
2. Close the whole browser (quit it, not just the tab). Reopen it and go to https://conectahmls3.avuz.app → **Mail**.

**Expected:** A's inbox, with no extra login.

## T5 — Webmail's own logout, opened directly (must keep working)

1. Go to https://conectamailhml.avuz.app directly and log in with **User A's mailbox** e-mail and password.
2. Click **Sair** (top right).
3. Reload the page.

**Expected:** the ConectaMail login screen after the reload.

## T6 — Two tabs

1. Tab 1: log in as **User A** on conectahmls3 and open **Mail**.
2. Tab 2: open https://conectahmls3.avuz.app and log out there (avatar → Sair).
3. Back in Tab 1, without reloading, click a message or a folder in Mail.

**Expected after the fix:** the webmail stops showing A's mail (login screen or an error asking to sign in again).
**Today:** just record what happens; this is information, not pass/fail.

## T7 — Another browser is not affected

1. Browser 1: log in as **User A** and open **Mail**.
2. Browser 2 (a different browser, or a private window): open https://conectamailhml.avuz.app directly.

**Expected:** the login screen in browser 2.

---

**Report back:** a table T1–T7 with PASS / FAIL / notes, plus screenshots for any FAIL.
