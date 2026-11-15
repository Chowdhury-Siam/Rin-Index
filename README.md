# Bhadoo Drive Index

Browse and download files from a Google Drive folder, a Shared Drive, or My Drive. GitHub Actions checks your Google connection, packages the browser assets, and deploys the site to Cloudflare Workers.

## 1. Get a Google Drive refresh token

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project and enable the **Google Drive API**.
2. In **Google Auth Platform**, configure Branding and Audience. If the app is **External** and in **Testing**, add the Google account that can open the folder as a test user.
3. Under **Clients**, create an OAuth client of type **Web application**. Add `https://developers.google.com/oauthplayground` under **Authorized redirect URIs**. Save the client ID and client secret.
4. Open [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground). In the gear menu, select **Use your own OAuth credentials** and enter the client ID and secret.
5. In Step 1, enter `https://www.googleapis.com/auth/drive.readonly` as the scope and click **Authorize APIs**. Sign in with the account that can open the folder.
6. In Step 2, click **Exchange authorization code for tokens**. Save the **Refresh token** with the client ID and secret.

For an External app in Testing, Google expires the refresh token after seven days. To keep the index running long term, configure your Google app for your intended audience and generate a new refresh token after changing its publishing status. See [Google’s OAuth setup](https://developers.google.com/explorer-help/code-samples) and [refresh token rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## 2. Prepare Cloudflare

In **Workers & Pages**, make sure your account has a `workers.dev` subdomain. Copy the **Account ID**, then create an API token with the **Edit Cloudflare Workers** template, scoped to that account. If you already use the Worker name `bhadoo-drive-index`, change `name` in `wrangler.toml` to your intended Worker name before deploying. See [Cloudflare’s GitHub Actions setup](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) and [workers.dev setup](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

## 3. Configure GitHub

Create an empty GitHub repository. Open **Settings → Secrets and variables → Actions** and add these **repository secrets**.

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `GOOGLE_CLIENT_ID` | OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | OAuth web client secret |
| `GOOGLE_REFRESH_TOKEN` | Refresh token from the OAuth Playground |
| `INDEX_PASSWORD` | Optional password for browsing the index. Leave it unset for a public index. |

On the **Variables** tab, add `DRIVE_ROOT_ID`. For a folder or Shared Drive, use the ID after `/folders/` in its Google Drive URL. Use `root` for My Drive. A folder is a good first deployment because it limits what visitors can browse.

These repository variables are optional.

| Name | Default | Effect |
| --- | --- | --- |
| `SITE_NAME` | Bhadoo Drive Index | Name shown in the browser title and drive menu |
| `INDEX_USERNAME` | viewer | Username for the private index |
| `INDEX_PUBLIC` | Automatic | The index is public when `INDEX_PASSWORD` is unset. Set this to `true` to make it public even with a password configured. |
| `PROTECT_FILE_LINK` | false | Set to `true` and configure `INDEX_PASSWORD` to also require sign-in for direct downloads. |

Anyone with a direct download URL can use it by default, even if browsing the index requires a password. The workflow installs the credentials as encrypted Worker bindings during deployment. Enter real credentials in GitHub’s Secrets tab and keep them out of commits. See [GitHub’s instructions for repository secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## 4. Deploy

Open PowerShell in the extracted project folder containing `wrangler.toml` and run these commands. Substitute your new GitHub repository URL in the fourth command.

```powershell
git init -b main
git add --all
git commit -m "Set up Bhadoo Drive Index"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

In GitHub, open **Actions → Deploy Drive index**. Open the run, expand **Deploy to Cloudflare**, and follow the `workers.dev` URL shown in the log. If you set an index password, sign in as `viewer` or your configured username. Check that you can open a folder and download a file.

The workflow deploys on pushes to `main`. After changing a secret or variable, use **Actions → Deploy Drive index → Run workflow** and select `main`.

## Troubleshooting

- **Google rejected the token refresh** means the client ID, client secret, or refresh token needs checking. Generate a new token if it expired, and rerun the workflow after updating the GitHub secret.
- **Google Drive could not open DRIVE_ROOT_ID** means the folder ID, Drive API, or Google account access needs checking. Use the account that can open the folder in Drive.
- **Cloudflare rejected the deployment** means you should check the token permissions, the account ID, and the `workers.dev` subdomain.
- The original index supports search for My Drive and Shared Drives. With a single subfolder selected, browse its contents through the folder list. My Drive search can show matching filenames from **Shared with me**. Use a specific folder if you need to limit the index to one folder.

## Credits

Bhadoo Drive Index was redesigned by Parveen Bhadoo and TheFirstSpeedster. It builds on [GDIndex](https://github.com/maple3142/GDIndex) and [goindex](https://github.com/yanzai/goindex), with Bootstrap and MDUI for the interface.

