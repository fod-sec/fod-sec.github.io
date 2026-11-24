# The Secretariat

A responsive program, attendance, and billeting portal built with Next.js and Firebase. The static site is deployed to GitHub Pages at `fod-sec.github.io`.

## Local development

```bash
npm install
npm run dev
```

Firebase web settings are in `src/lib/firebase.ts` and can be overridden with the `NEXT_PUBLIC_FIREBASE_*` variables in `.env.local`.

## Firebase setup

1. In Firebase Authentication, enable **Anonymous** sign-in for access-code users and **Email/Password** sign-in for admins.
2. Add `fod-sec.github.io` to Firebase Authentication’s authorized domains.
3. Create a Firestore database and deploy the included rules with `firebase deploy --only firestore:rules`.
4. Create the admin's email/password account in Authentication. In Firestore, add `admins/{AUTH_UID}` with `{ "enabled": true }` to grant that account admin access. Admin documents can only be provisioned through the Firebase console or trusted admin tooling.
5. The first admin can add programs and rooms after signing in. A program must exist before attendees can confirm attendance.

The shared access code is `fod`, matching the requested entry flow. It is a front-end entry gate, so it should not be treated as a private credential; Firestore rules separately protect attendee contact details and restrict management actions to the `admins` collection.

## GitHub Pages

The `Deploy Secretariat to GitHub Pages` workflow builds the Next.js static export and publishes `out/` on pushes to `main`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

## Address dropdown data

`src/data/locations.json` contains the Philippine Standard Geographic Code hierarchy bundled for offline use. The pinned 2026 Q2 snapshot was adapted from the [ph-psgc dataset](https://github.com/Tenasia/ph-psgc), which credits the [Philippine Statistics Authority PSGC](https://psa.gov.ph/classification/psgc). Refresh the snapshot when the PSA publishes a new PSGC release.

The attendee form limits province choices to Region XIII’s five provinces. Butuan City is available among Agusan del Norte’s city options.
