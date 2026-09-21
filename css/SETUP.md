# Ensemble Fitness — Member Uploads: Setup Guide

This app lets signed-up members log in, edit a profile, and upload photos/videos
that stay private to them until you (or another admin) approve them. It's a
separate app from the ensemblezone.com marketing site — meant to run at
something like `app.ensemblezone.com`.

It needs a Supabase project to store accounts, profile data, and files.
None of it works until you complete the steps below.

## 1. Create the Supabase project

1. Go to supabase.com and sign up / log in.
2. Click **New project**. Give it a name (e.g. "ensemble-fitness"), set a database
   password (save it somewhere safe — you likely won't need it day-to-day),
   pick a region close to Dallas–Fort Worth, and create it. Takes about 2 minutes
   to provision.

## 2. Run the database setup

1. In your new project, open the **SQL Editor** in the left sidebar.
2. Click **New query**.
3. Open `sql/schema.sql` from this folder, copy the whole file, paste it in, and click **Run**.
4. You should see "Success. No rows returned." This creates the profiles,
   media, and admins tables, all the security rules, and a private storage
   bucket called `media`.

## 3. Check the file size limit

Supabase's default upload limit may be too small for workout videos.

1. Go to **Storage** → click the `media` bucket → **Configuration**.
2. Raise "File size limit" to whatever you're comfortable with (e.g. 100MB).
   Free-tier projects have an overall plan cap; if you hit it, that's a sign
   to move to a paid Supabase tier before it becomes a problem.

## 4. Get your two connection values

1. Go to **Project Settings** (gear icon) → **API**.
2. Copy the **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`).
3. Copy the **anon public** key (a long string starting with `eyJ...`).
   This key is safe to use in client-side code — it only ever works within
   the limits of the security rules from step 2.
4. Send both of those back and the app will be wired up and ready to deploy.

## 5. Make yourself an admin (so you can review uploads)

You'll do this after you've signed up for an account in the app itself once
it's live (Create Account on the login page).

1. In Supabase, go to **Table Editor** → `admins` table.
2. Go to **Table Editor** → `profiles` (or **Authentication** → **Users**) to
   find your own user ID (a UUID) next to your email.
3. Back in `admins`, click **Insert row**, paste your user ID into `user_id`, and save.
4. Now when you log into the app and visit `admin.html` ("Review Queue" in
   the nav), you'll be able to approve or reject member uploads.

Repeat step 5 for anyone else you want reviewing content (a co-founder, etc.).

## 6. Deploying the app itself

Once the config is wired up, this folder (`member-app/`) can be deployed the
same way as the marketing site — as a static site on Netlify, Vercel, or
similar. The only extra step is pointing a subdomain at it:

- In your host (Netlify/Vercel), add the custom domain `app.ensemblezone.com`.
- At your domain registrar (wherever ensemblezone.com is registered), add
  the DNS record the host gives you for that subdomain.

Once that's live, `app.ensemblezone.com/login.html` is where members sign
up and log in.

## What this does and doesn't do yet

**Does:** real accounts, real login, real private file storage, a review
queue so nothing goes public without a human looking at it first, a profile
photo flow, delete-your-own-upload.

**Doesn't yet:** show member uploads anywhere on the public marketing site
(the "Active Members" and "Latest Workouts" sections on ensemblezone.com
are still placeholder content — connecting those to real approved uploads is
a follow-up step once you have real members and content flowing in),
password reset emails (can be added), email verification wording/branding
(Supabase sends a default email — this can be customized in Supabase's Auth
settings), and push/email notifications when something is approved or
rejected (member currently has to check back on their profile page).
