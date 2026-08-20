# Google OAuth for Mother Bird

The browser integration uses Supabase Auth. Google passwords and the Google
client secret must never be added to this repository or to GitHub Pages.

## 1. Create the Google OAuth client

In Google Cloud Console:

1. Create or select the Walk & Wildlife project.
2. Configure the OAuth consent screen with the project support email.
3. Create an **OAuth client ID** with application type **Web application**.
4. Add this authorized redirect URI exactly:

   `https://havvemzeixrysivwiwfh.supabase.co/auth/v1/callback`

Keep the Google client ID and client secret in Google Cloud and Supabase only.

## 2. Enable Google in Supabase

In the Supabase dashboard for project `havvemzeixrysivwiwfh`:

1. Open **Authentication → Providers → Google**.
2. Enable Google.
3. Paste the Google client ID and client secret.
4. Save.

## 3. Allow the Pages return URL

In **Authentication → URL Configuration**:

- Site URL: `https://sethryst.github.io/gremlin_labs/`
- Redirect URL: `https://sethryst.github.io/gremlin_labs/`
- Optional local development redirect: `http://127.0.0.1:4173/`

The application derives this return URL without copying OAuth query parameters
or fragments. Supabase exchanges the OAuth response and restores the browser
session. A first-time user then chooses the public username used by Mother Bird.

## Verification

1. Open Mother Bird and choose **Journal → Go Online**.
2. Select **Continue with Google**.
3. Complete Google consent.
4. Confirm that the browser returns to the Pages URL.
5. Reopen **Go Online** and create the public Mother Bird username.

