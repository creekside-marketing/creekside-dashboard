# Contractor Machine Setup

One-time setup for a contractor machine to edit client reports through Claude. Most contractors already have steps 1-3 from working in the Creekside brain. Step 4 is the only thing that's usually new.

## What you need installed

### 1. macOS
Assumed. Everything here is Mac-specific.

### 2. Claude Code
Already installed if you've been using the Creekside brain. If not: https://claude.com/claude-code

### 3. Git
Already installed if you've been pulling the brain. To verify, open Terminal and run:
```
git --version
```
If it says "command not found," run `xcode-select --install` and follow the prompts.

### 4. Node.js (this is the one that's usually missing)

1. Go to https://nodejs.org
2. Download the LTS version (the big green button on the left)
3. Run the installer and click through — defaults are fine
4. Verify in Terminal:
   ```
   node --version
   ```
   You should see something like `v20.11.0`.

This takes 2-3 minutes total.

### 5. GitHub access
You should already be signed in to GitHub as `ads@creeksidemarketingpros.com`. If not, Peterson sends the login info.

## What the system handles automatically

- Cloning the dashboard repo to your machine
- Pulling the latest version every time you start Claude
- Installing all the project dependencies on your first edit (this is why Node.js has to be installed first)

You don't need to clone anything yourself, run any npm commands yourself, or configure anything else. Claude does all of it.

## The actual workflow

Once setup is done, every time you want to edit a client report:

1. Open Claude in the Creekside brain (same as always)
2. Say what you want changed. Example:
   > *Edit Aura Displays' Google report — make the conversion card red*
3. Claude figures out the rest. When it confirms "Done", the change is live on the dashboard in ~2 minutes.

No terminals. No git. No code knowledge needed.

## If something breaks

Screenshot it and message Peterson in Google Chat. Don't try to fix it yourself — there might be a safety issue that needs to be looked at.

## Rare case: first edit ever

The very first time you ask Claude to edit a report, it may say:
> "Setting up for the first time — this takes about a minute. I'll let you know when it's ready."

That's the dashboard dependencies downloading to your machine. It only happens once. Wait until Claude comes back with "ready" before continuing.
