# Contractor Guide: Editing Client Reports

## I was asked to edit a client's report. What do I do?

Open a terminal, `cd` into this repo, and run `npm run branch-report -- "<Client Name>" <google|meta>`. That command prints the exact file path you need to edit. Make your edits, commit, and push to `main` — your changes go live in 2-3 minutes.

---

## Step-by-step: edit a report

1. Open a terminal and navigate into the dashboard repo:

   ```bash
   cd ~/creekside-dashboard
   ```

2. Pull the latest code so you're not editing a stale copy:

   ```bash
   git pull origin main
   ```

3. Run the branch-report command. Replace `<Client Name>` with the client's name (use quotes if it has spaces) and `<platform>` with either `google` or `meta`:

   ```bash
   npm run branch-report -- "Aura Displays" google
   ```

   The command will either create a new custom report file for that client, or tell you the path of the existing one. Example output:

   ```
   Report file: src/components/reports/custom/AuraDisplaysGoogle.tsx
   ```

4. Open that file in your editor. Edit the text, numbers, or sections the client asked for. **Only edit the file the command told you about.**

5. Commit and push:

   ```bash
   git add src/components/reports/custom/
   git commit -m "Update Aura Displays Google report"
   git push origin main
   ```

6. Wait 2-3 minutes for Railway to redeploy, then reload the client's dashboard to verify your changes.

---

## What NOT to do

Do not search the codebase for file names with "Report" in them (like `LeadGenGoogleReport.tsx`, `EcomMetaReport.tsx`, or `TabbedReport.tsx`) and start editing those. Do not edit any file outside `src/components/reports/custom/`. Those shared files drive the report for every single client — if you change them, every client's report changes at once. GitHub will reject your push if you try. Stick to the file path the `branch-report` command gives you.

---

## My push got rejected with `GH013`

If your push fails with something that looks like this:

```
remote: error: GH013: Repository rule violations found for refs/heads/main.
remote: - Cannot update this protected ref.
remote: - Changes must be made through a pull request.
remote: - File path restriction: changes to 'src/components/reports/LeadGenGoogleReport.tsx' are not allowed
To github.com:creekside-marketing/creekside-dashboard.git
 ! [remote rejected] main -> main (push declined due to repository rule violations)
error: failed to push some refs
```

In plain English: GitHub blocked your push because you edited a file you're not allowed to edit. This is the safety net — it's working as designed.

**What to do:** screenshot the terminal error and message Peterson in Google Chat. Do not try to fix it yourself. Do not force-push. Do not delete files to "work around" it. Peterson will unwind it in a minute — trying to patch it yourself takes longer and can make a bigger mess.

---

## Railway deploy timing

After you push, Railway rebuilds the dashboard automatically. That takes **2-3 minutes**. If you reload the dashboard immediately and don't see your changes, that's normal — wait a couple minutes and try again.

If you push 5 times in a row, Railway queues 5 builds and runs them one after another. That means your last change might not be live for 10+ minutes. Push once, wait, verify. Don't spam pushes.

---

## First-time setup

If this is your first time working on the dashboard, do this once:

1. Clone the repo:

   ```bash
   git clone https://github.com/creekside-marketing/creekside-dashboard.git
   cd creekside-dashboard
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Create a file called `.env.local` in the root of the repo with these two lines:

   ```
   NEXT_PUBLIC_SUPABASE_URL=<ask Peterson>
   SUPABASE_SERVICE_ROLE_KEY=<ask Peterson>
   ```

   Message Peterson in Google Chat for the actual values. Do not commit `.env.local` — it's already in `.gitignore`, but double-check.

4. You're done. You can now run `npm run branch-report` whenever you're assigned a report edit.

---

## Quick reference

| What you want | Command |
|---|---|
| Get latest code | `git pull origin main` |
| Find/create a client's report file | `npm run branch-report -- "<name>" <google\|meta>` |
| Push your edits | `git add . && git commit -m "..." && git push origin main` |
| See your recent commits | `git log --oneline -5` |

If anything feels off — error messages you don't recognize, a path the command prints that doesn't look right, a push that hangs — **stop and message Peterson.** It's always faster to ask than to guess.
