# GitHub Pages deployment

The static frontend is intended for `Jerryluo2020/Jerryluo2020.github.io`, under the new `a-share/` directory. The existing homepage remains unchanged.

Build from the source project root:

```sh
pnpm exec vite build --config github-pages/vite.config.ts
```

Copy `public/favicon.svg` into the resulting `github-pages-dist/` folder. Publish the generated HTML, CSS, JavaScript and favicon together under `a-share/`.

The frontend reuses the existing React application. Its API origin is set in `github-pages/main.tsx`. GitHub Pages cannot run `app/api/stocks` or `app/api/patterns`; these remain on the existing backend.

The owner has approved publishing the website source and making the backend public. CORS support for the exact GitHub Pages origin is prepared in `lib/api-cors.ts`; CORS does not bypass the hosting platform's access policy. Do not embed a bypass token or credentials in frontend code. Deploy the approved backend before publishing the frontend and verify the GitHub Pages deployment status.

Source snapshot and prebuilt frontend are published together in this repository. The frontend is in the sibling a-share/ directory.
