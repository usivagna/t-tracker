# Publishing for Windows

T-Tracker is a static PWA. The Pages workflow publishes the complete app shell,
which is required before packaging it for Windows.

## One-time setup

1. Open the deployed Pages URL in [PWABuilder](https://www.pwabuilder.com/)
   and generate a Windows MSIX bundle.
2. Reserve the app name and complete the first submission in Partner Center.
   Attach the generated `.msixbundle` to a published GitHub release.
3. Submit the first `Usivagna.TTracker` manifest to
   [winget-pkgs](https://github.com/microsoft/winget-pkgs) and fork that
   repository under the owner of this repository.
4. Configure these repository secrets:
   `STORE_TENANT_ID`, `STORE_SELLER_ID`, `STORE_CLIENT_ID`,
   `STORE_CLIENT_SECRET`, `STORE_APP_ID`, and `WINGET_TOKEN`.

After that bootstrap, publishing a release runs
`.github/workflows/publish-windows.yml`. It submits the MSIX bundle to the
Microsoft Store and opens a WinGet update pull request for each release.

The first Store submission and first WinGet manifest cannot be automated until
their respective publisher records exist.
