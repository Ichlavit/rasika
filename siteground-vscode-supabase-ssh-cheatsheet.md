# VS Code + SiteGround + Supabase SSH Cheatsheet

This guide is a reusable setup checklist for a local VS Code project that builds a static frontend, deploys it to SiteGround over SSH/SFTP, and uses Supabase as the backend.

Keep secrets local. Do not commit private keys, passphrases, FTP passwords, Supabase service-role keys, database passwords, or production `.env` files.

## 1. Required Credentials

Collect these values from the hosting/dashboard panels:

- SSH host, for example `ssh.example.com`
- SSH username
- SSH port
- SSH private key
- SSH key passphrase, if the key is encrypted
- Remote deploy path, for example `/home/username/www/domain.com/public_html/`
- Supabase project URL
- Supabase anon key for frontend use
- Supabase service-role key only for trusted backend/admin scripts

The private key must look like this:

```text
-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----
```

The public key is different. The public key is what gets installed in the hosting dashboard. The private key stays only on your machine.

## 2. Store The SSH Key In The Project

From the project root:

```bash
mkdir -p .ssh
nano .ssh/siteground_project_key
```

Paste the full private key exactly, including the first and last lines.

Then lock down permissions:

```bash
chmod 700 .ssh
chmod 600 .ssh/siteground_project_key
```

If the key lives inside the project, commands must reference:

```bash
.ssh/siteground_project_key
```

not:

```bash
~/.ssh/siteground_project_key
```

Use `~/.ssh/...` only if the key is actually stored in your home SSH folder.

## 3. Ignore Secrets In Git

Make sure `.gitignore` includes:

```gitignore
.env
.env.*
!.env.example
.ssh/
```

Keep a safe example file in the repo:

```bash
cp .env.local .env.example
```

Then remove all real values from `.env.example`.

## 4. Test The SSH Connection

Use this shape:

```bash
ssh -i .ssh/siteground_project_key -p SSH_PORT -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new SSH_USER@SSH_HOST
```

Example shape:

```bash
ssh -i .ssh/siteground_project_key -p 18765 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new username@ssh.example.com
```

If SSH asks:

```text
Enter passphrase for key...
```

type the passphrase manually. Terminal usually does not show any characters while typing a passphrase.

Once connected, check the remote deploy path:

```bash
pwd
ls -la
ls -la www
ls -la www/domain.com
ls -la www/domain.com/public_html
```

Exit the remote shell:

```bash
exit
```

## 5. Optional SSH Config Shortcut

You can add a host alias to `~/.ssh/config`:

```sshconfig
Host siteground-project
  HostName ssh.example.com
  User username
  Port 18765
  IdentityFile /absolute/path/to/project/.ssh/siteground_project_key
  IdentitiesOnly yes
```

Then connect with:

```bash
ssh siteground-project
```

Use an absolute path for `IdentityFile`; VS Code terminals and automation tools may not resolve relative paths the same way.

## 6. Optional SSH Agent Setup

To avoid typing the passphrase repeatedly:

```bash
ssh-add .ssh/siteground_project_key
```

On macOS, if supported:

```bash
ssh-add --apple-use-keychain .ssh/siteground_project_key
```

If `ssh-add` says no agent is running, start one:

```bash
eval "$(ssh-agent -s)"
ssh-add .ssh/siteground_project_key
```

## 7. Supabase Frontend Environment

For Vite-style frontend apps, `.env.local` usually contains:

```bash
VITE_SUPABASE_URL=https://PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_ANALYSIS_MODE=supabase
```

Only the anon key belongs in browser-facing env variables. Never expose the service-role key in frontend code.

For local-only testing, a project may temporarily use:

```bash
VITE_ANALYSIS_MODE=local
```

Switch back to `supabase` before building a live backend-connected deployment.

## 8. Build The Static Site

From the project root:

```bash
npm run build
```

The output is usually:

```text
dist/
```

Check the build output before deploy:

```bash
ls -la dist
```

## 9. Deploy To SiteGround With Rsync

Use:

```bash
rsync -avz --delete -e "ssh -i .ssh/siteground_project_key -p SSH_PORT -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" dist/ SSH_USER@SSH_HOST:/remote/public_html/path/
```

Example shape:

```bash
rsync -avz --delete -e "ssh -i .ssh/siteground_project_key -p 18765 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" dist/ username@ssh.example.com:/home/username/www/domain.com/public_html/
```

Important details:

- `dist/` with a trailing slash means upload the contents of `dist`.
- `--delete` removes old remote files that are no longer in the build.
- Confirm the remote path before using `--delete`.

## 10. SPA `.htaccess`

For React/Vite single-page apps, place `.htaccess` in `public/.htaccess` so it is copied into `dist` during build.

Basic SPA fallback:

```apache
Options -Indexes

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteBase /

  RewriteCond %{HTTPS} !=on [OR]
  RewriteCond %{HTTP_HOST} ^www\.example\.com$ [NC]
  RewriteRule ^ https://example.com%{REQUEST_URI} [R=301,L]

  RewriteRule ^index\.html$ - [L]
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule . /index.html [L]
</IfModule>

<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set Permissions-Policy "camera=(), microphone=(), geolocation=()"
</IfModule>

<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/html "access plus 0 seconds"
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType image/svg+xml "access plus 1 year"
  ExpiresByType image/png "access plus 1 year"
  ExpiresByType image/jpeg "access plus 1 year"
  ExpiresByType image/webp "access plus 1 year"
</IfModule>
```

Replace `example.com` with the project domain.

The HTTPS redirect matters because Supabase Auth redirects and Edge Function CORS allow-lists usually expect the secure production origin.

## 11. Verify The Live Site

Check HTTP redirects:

```bash
curl -I http://example.com/
curl -I https://example.com/
```

Expected:

- HTTP returns `301` or `302` to HTTPS.
- HTTPS returns `200`.

Check the app in the browser:

- sign in
- run a backend action
- refresh on a nested route
- verify static assets load
- verify Supabase Auth redirect flows

## 12. Common Errors

### `No such file or directory`

The key path is wrong.

Check:

```bash
ls -la .ssh
```

If the key is in the project, use `.ssh/key_name`. If it is in the home folder, use `~/.ssh/key_name`.

### `Invalid format`

The private key was pasted incorrectly.

Common causes:

- missing `BEGIN` or `END` line
- copied the public key instead of private key
- rich-text formatting
- extra text before or after the key
- broken line wrapping

### `Permission denied (publickey)`

Usually one of these:

- wrong username
- wrong host
- wrong port
- wrong private key
- public key not installed on the server
- server expects a different SSH account

Add `-o IdentitiesOnly=yes` so SSH does not try unrelated keys first.

### `Host key verification failed`

First-time connection needs host acceptance:

```bash
-o StrictHostKeyChecking=accept-new
```

If a host key changed unexpectedly, stop and verify the server before deleting known-host entries.

### Passphrase Paste Fails

Type the passphrase manually. It will not show on screen.

To avoid repeated prompts:

```bash
ssh-add .ssh/siteground_project_key
```

### Site Works On `/` But Refresh Fails On App Routes

The SPA fallback is missing or not deployed.

Confirm `.htaccess` exists in:

```bash
dist/.htaccess
```

and on the remote `public_html` folder.

### Supabase Edge Function Fails Only On Live Site

Check:

- browser is using `https://`
- Supabase Auth Site URL is the live HTTPS URL
- Supabase Redirect URLs include the live HTTPS URL
- Edge Function CORS allow-list includes the exact live origin
- frontend `.env.local` was set correctly before `npm run build`

## 13. Minimal Repeatable Deploy Flow

```bash
npm run build
rsync -avz --delete -e "ssh -i .ssh/siteground_project_key -p SSH_PORT -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" dist/ SSH_USER@SSH_HOST:/remote/public_html/path/
curl -I https://example.com/
```

That is the basic loop: build, sync, verify.
