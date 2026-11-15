<div align="center">

<img src="docs/images/rin-index-banner.png" alt="Rin Index — a self-hosted Google Drive index" width="960">

**Browse, preview, and download files from your Google Drive.**

<p>
  <a href="https://github.com/Chowdhury-Siam/Google-Index/actions"><img alt="GitHub Actions" src="https://img.shields.io/badge/Deploy-GitHub_Actions-9DE9B1?style=for-the-badge&logo=githubactions&logoColor=183323"></a>
  <a href="https://developers.cloudflare.com/workers/"><img alt="Cloudflare Workers" src="https://img.shields.io/badge/Hosting-Cloudflare_Workers-F6B887?style=for-the-badge&logo=cloudflare&logoColor=4b2e15"></a>
  <a href="https://developers.google.com/workspace/drive/api/guides/api-specific-auth"><img alt="Read-only Google Drive access" src="https://img.shields.io/badge/Google_Drive-Read_only-BADBC4?style=for-the-badge&logo=googledrive&logoColor=1a3d27"></a>
</p>

[**Deploy**](#deploy) · [**Features**](#features) · [**Repository secrets**](#repository-secrets) · [**Troubleshooting**](#troubleshooting)

</div>

---

## Meet Rin Index

Rin Index gives a Drive folder, Shared Drive, or My Drive a file browser on your own Cloudflare Worker. Google Drive remains the file source. The Worker reads the selected files using Google’s read-only Drive permission.

## Features

| Feature | What you can do |
| --- | --- |
| **Browse** | Follow folder breadcrumbs and see each item’s type, date, and size on desktop or mobile. |
| **Search** | Search by name when indexing My Drive or a Shared Drive. |
| **Preview** | Open supported text, image, audio, video, and PDF files in the browser. |
| **Download** | Download a file from its row or preview page. |
| **Download folder** | Download the current folder and its subfolders as one ZIP, or copy its direct URL. |
| **Folder notes** | Display `HEAD.md` above a folder’s files and `README.md` below them. |
| **Access** | Add an optional browser password and choose whether direct downloads also require it. |

### Download an entire folder

Open a folder and click **Download folder**, or click **Copy ZIP link** to share the direct URL or paste it into a download manager. A private index requires the same username and password when opening the ZIP link.

The Worker can stream a ZIP64 archive on demand over a single connection. An interrupted on-demand transfer starts again from the beginning. Large on-demand ZIPs can exceed the CPU or request limits of Workers Free. [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Prepare resumable ZIPs for large folders

1. In Cloudflare **R2 Object Storage**, create a private bucket. Create an R2 API token with **Object Read & Write** access scoped to that bucket. Save its **Access Key ID** and **Secret Access Key**. [Cloudflare R2 setup](https://developers.cloudflare.com/r2/get-started/s3/)
2. In GitHub, go to **Settings → Secrets and variables → Actions → Secrets**. Add these repository secrets.

   | Secret | Value |
   | --- | --- |
   | `R2_ARCHIVE_BUCKET` | The R2 bucket name |
   | `R2_ARCHIVE_ACCESS_KEY_ID` | The R2 access key ID |
   | `R2_ARCHIVE_SECRET_ACCESS_KEY` | The R2 secret access key |

3. Run **Actions → Deploy Rin Index** on `main` to connect the Worker to the bucket.
4. Run **Actions → Prepare folder ZIP** on `main`. Paste the folder page URL from Rin Index into **folder**, then wait for the run to succeed.
5. Open the folder and use **Copy ZIP link**. Start a new download after preparing the archive. Your download manager can resume that download or request multiple parts.

The prepared ZIP is a snapshot. Run **Prepare folder ZIP** again to publish Drive changes. The previous ZIP remains available while its replacement uploads. R2 retains earlier ZIP versions until you delete them. To withdraw a prepared snapshot, remove its `current` object or the ZIP version it points to. Existing links follow the index's sign-in settings.

The ZIP includes empty folders. Google Docs, Sheets, Slides, Drawings, and Apps Script files are exported. Google Drive shortcuts and Workspace files without a supported export are included as links. [Google Drive’s download and export limits](https://developers.google.com/workspace/drive/api/guides/manage-downloads)

When updating from the browser-based folder downloader, remove the old files `public/rin-folder-download.mjs` and `public/assets/js/folder-archive.mjs` from your repository.

## Deploy

### 1. Connect Google Drive

1. In [Google Cloud Console](https://console.cloud.google.com/), select a project and enable the **Google Drive API**.
2. In **Google Auth Platform**, configure **Branding** and **Audience**. If your app is **External** and in **Testing**, add the Google account that can access your folder under **Audience → Test users**.
3. Go to **Clients → Create client**. Choose **Web application**, name it **Rin Index**, and leave **Authorized JavaScript origins** blank. Add this exact value under **Authorized redirect URIs**.

   ```text
   https://developers.google.com/oauthplayground
   ```

4. Click **Create** and save the client ID and client secret. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/), click the gear icon, and select **Use your own OAuth credentials**. Enter both values. Keep the flow **Server-side** and the access type **Offline**.
5. In **Step 1**, paste `https://www.googleapis.com/auth/drive.readonly` into **Input your own scopes**. Click **Authorize APIs**, sign in with the account that can open the folder, and grant access.
6. In **Step 2**, click **Exchange authorization code for tokens**. Copy the full **Refresh token** field. Store it with the matching client ID and client secret. See [Google’s OAuth Playground guide](https://developers.google.com/explorer-help/code-samples).

> [!NOTE]
> Google expires Drive refresh tokens after seven days while an **External** OAuth app is in **Testing**. If you later change the app’s publishing status, generate a fresh token and update the GitHub secret. [Google’s refresh token rules](https://developers.google.com/identity/protocols/oauth2#expiration)

### 2. Prepare Cloudflare

1. In **Workers & Pages**, set up your `workers.dev` subdomain and copy the **Account ID**.
2. Create a Cloudflare API token using **Edit Cloudflare Workers** and scope it to your Cloudflare account. [Cloudflare’s GitHub Actions setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
3. To upgrade the existing deployment at `bhadoo-drive-index.<subdomain>.workers.dev`, keep the `name` in `wrangler.toml`. For a new URL, set it to an available name such as `rin-index` before deploying. [Cloudflare’s workers.dev setup](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

### 3. Add your repository secrets

Create or open the GitHub repository, then go to **Settings → Secrets and variables → Actions → Secrets**. Use **New repository secret** for each required entry below. [GitHub’s repository secret setup](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)

<a id="repository-secrets"></a>

| Required secret | Value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | The API token from Cloudflare |
| `GOOGLE_CLIENT_ID` | Your Web application’s OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | The matching OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | The **Refresh token** from Step 2 in the OAuth Playground |
| `DRIVE_ROOT_ID` | The folder or Shared Drive ID. Use `root` to index all of My Drive. |

For `DRIVE_ROOT_ID`, copy the part of the Drive URL after `/folders/` and before the `?`. For example, `/folders/1AbC_dEf-123?usp=sharing` gives `1AbC_dEf-123`.

| Optional secret | Default | Effect |
| --- | --- | --- |
| `SITE_NAME` | Rin Index | Labels the collection and the browser tab. |
| `INDEX_PASSWORD` | Unset | Require a password to browse the index. |
| `INDEX_USERNAME` | `viewer` | Set the username for password-protected browsing. |
| `INDEX_PUBLIC` | Automatic | The index is public with no password. Set this to `true` to allow public browsing with a password configured. |
| `PROTECT_FILE_LINK` | `false` | Set to `true` with an index password to require sign-in for direct downloads. |

> [!TIP]
> Direct download URLs work without a password by default. Turn on `PROTECT_FILE_LINK` if you want the index password to cover downloads as well.

### 4. Run GitHub Actions

For a **new repository**, open PowerShell in the extracted folder that contains `wrangler.toml` and run the commands below. Replace the example remote URL with your repository URL.

```powershell
git init -b main
git add --all
git commit -m "Set up Rin Index"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

To **upgrade an existing repository**, copy the project contents into its working folder, including `.github/workflows/deploy.yml`. Remove the old Bootstrap and MDUI assets under `public/assets`, the old `public/assets/favicon.ico`, and the two old screenshots in `images`. Commit the update and push to `main`.

Open **Actions → Deploy Rin Index**. The workflow runs the tests, prepares the browser assets, checks Google Drive access, and sends the code and Worker secrets to Cloudflare. Expand **Deploy to Cloudflare** to find your `workers.dev` URL. Open it and try browsing a folder and downloading a file.

After editing a repository secret, start a fresh run with **Actions → Deploy Rin Index → Run workflow → main**.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| **Set DRIVE_ROOT_ID before deploying** | Add the repository secret `DRIVE_ROOT_ID` and start a fresh workflow run. |
| **DRIVE_ROOT_ID must be a folder ID, Shared Drive ID, or root** | Paste the ID from the folder URL, or enter `root` for My Drive. |
| **Google rejected the token refresh** | Check that the client ID, client secret, and refresh token belong to the same OAuth client. Generate a new token if it expired. |
| **Google Drive could not open DRIVE_ROOT_ID** | Check the folder ID, the Google account’s access to that folder, and whether the Drive API is enabled. |
| **Cloudflare rejects the deployment** | Check the account ID, token permissions, and `workers.dev` subdomain setup. |
| **Search is missing** | Search is available for My Drive and Shared Drive roots. Use breadcrumbs to browse a selected subfolder. |

## Credits

Rin Index’s interface and documentation take their visual cues from [Yutaka](https://github.com/Chowdhury-Siam/Yutaka). The Drive Worker builds on [Bhadoo Drive Index](https://github.com/ParveenBhadooOfficial/Bhadoo-Drive-Index) by Parveen Bhadoo and TheFirstSpeedster, with earlier work from [GDIndex](https://github.com/maple3142/GDIndex) and [goindex](https://github.com/yanzai/goindex).

