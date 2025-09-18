<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://lemmaiot.com.ng/assets/images/index-meta.jpg" />
</div>

# ImageSpark — AI-powered Image Studio

ImageSpark is a small, focused web app that demonstrates modern client-side AI integrations for image generation and manipulation. Built with Vite and TypeScript, ImageSpark is designed to be a starting point for developer teams and businesses that want to prototype AI-first web experiences quickly.

Why ImageSpark matters to businesses
- Faster experimentation: rapidly build and test AI-powered user flows (image generation, editing).
- Lower integration risk: a minimal, well-documented starter that integrates with cloud AI services and is ready for CI/CD and static hosting.
- Customer-facing MVPs: ship prototypes and landing pages with integrated AI features to validate product-market fit.

Core benefits for business owners
- Rapid prototyping reduces time-to-insight for new features and reduces developer overhead.
- Clear separation of build-time secrets and runtime features makes it easier to comply with security policies.
- Out-of-the-box Netlify + GitHub friendliness enables continuous deployment and staged rollouts.

Key features
- Single-page app (React + TypeScript) starter scaffold using Vite.
- Integration points for cloud AI providers (uses env var `GEMINI_API_KEY` in `vite.config.ts`).
- SPA routing support and Netlify-ready redirects (`_redirects` / `netlify.toml`).
- GitHub Actions CI workflow included to validate builds on push/PR.

Technical components used
- Vite (build tool and dev server)
- TypeScript
- React (JSX runtime configured in `tsconfig.json`)
- GitHub Actions for CI (`.github/workflows/ci.yml`)
- Netlify configuration (`netlify.toml` and `public/_redirects`)
- Optional cloud AI SDK: `@google/genai` (listed in `package.json`)

Quickstart (developer)

Prerequisites: Node.js (recommended 18+)

1. Install dependencies

```powershell
npm install
```

2. Add your build-time secrets (do not commit)

Create a `.env.local` file at the project root and add:

```
GEMINI_API_KEY=your_api_key_here
```

3. Run locally

```powershell
npm run dev
```

4. Build for production

```powershell
npm run build
```

Deployment notes
- Netlify
  - Build command: `npm run build`
  - Publish directory: `dist`
  - Ensure `GEMINI_API_KEY` is set under Site settings → Build & deploy → Environment variables.
  - `_redirects` or `netlify.toml` is included to support client-side routing.

GitHub & CI
- A basic GitHub Actions workflow is included to run `npm ci` and `npm run build` on pushes and PRs. Use the Actions tab to review build logs and artifacts.

Security & secrets
- Do not store private API keys in client-side code or commit them to the repo. Use server-side functions or secure environment variables in your hosting platform for secrets.

Extending ImageSpark
- Add serverless functions (Netlify Functions or similar) for private AI calls.
- Add user authentication and per-user quotas to manage costs.
- Replace the sample AI SDK with your preferred provider; config is mostly centralized in `vite.config.ts`.

About LemmaIoT Cloud Solution

ImageSpark is delivered as a product of LemmaIoT Cloud Solution — a platform helping organizations integrate cloud-native IoT and AI solutions quickly. Learn more at https://lemmaiot.com.ng

Contributing
- PRs are welcome. Open an issue if you want new features or guidance on production hardening.

License
- This project is provided AS-IS for demonstration purposes. Add your preferred license.

---

If you'd like, I can also:
- Expand the product page with screenshots and usage examples, or
- Draft a short marketing blurb/email you can send to potential customers.
