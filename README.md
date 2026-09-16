<p align="center">
  <img src="public/readme/binah-banner.png" alt="Binah — The Intelligent Classroom" width="800"/>
</p>

<p align="center">
  <strong>Binah — The Intelligent Classroom</strong><br/>
  Built in Bertoua, Cameroon.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg?style=flat-square" alt="License: MIT"/></a>
  <img src="https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js" alt="Next.js 16"/>
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5"/>
</p>

Upload a textbook, name a topic, or just ask a question — Binah builds a real course around it: an AI teacher, AI classmates, quizzes and exams with genuine grading, and a certificate at the end. It's a classroom, not a chatbot.

## Features

- **AI teacher + AI classmates** — every lesson is taught live by an AI teacher, with AI classmates in the room asking questions and getting quizzed alongside the learner, the way a real classroom works.
- **Structured Courses** — turn a single prompt or an uploaded textbook into a multi-lesson course, planned into modules and chapters and generated lesson by lesson as the learner advances.
- **Quizzes, Continuous Assessment & Exams** — real, AI-graded assessments (not multiple-choice guessing) with retakes, scored against the learner's actual answers.
- **Certificates of Excellence** — a learner who finishes a course earns a certificate with its own public verification page.
- **PDF textbook ingestion** — upload a PDF and Binah detects its chapter/module structure automatically, with an Audio Overview to listen to before diving in.
- **Role-based accounts** — learner, parent, and admin roles, with an admin panel for managing system-wide defaults (LLM provider routing and failover, API keys, feature flags) across every account.
- **Google sign-in** — alongside standard email/password, via Supabase Auth.

## Supported Languages

Binah's interface is fully translated into 12 languages, for real learners in each of them:

Simplified Chinese (简体中文) · Traditional Chinese (繁體中文) · English · Japanese (日本語) · Russian (Русский) · Arabic (العربية) · Portuguese, Brazil (Português) · Korean (한국어) · Spanish, Mexico (Español) · French (Français) · Vietnamese (Tiếng Việt) · German (Deutsch)

## Getting Started

**Prerequisites:** [Node.js](https://nodejs.org/) >= 22.19.0, [pnpm](https://pnpm.io/) (latest), a [Supabase](https://supabase.com/) project.

```bash
# Clone the repository
git clone https://github.com/Lineker-star/binah.git
cd binah

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local: at minimum, a Supabase project (NEXT_PUBLIC_SUPABASE_URL,
# NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY) and at least one
# LLM provider API key.

# Start the development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Every environment variable is documented inline in [`.env.example`](.env.example) — LLM providers, TTS/ASR, image and video generation, web search, and Supabase are all independently optional except Supabase itself and one LLM provider.

## Tech Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · Supabase (Auth + Postgres) · Zustand

## Project Structure

```
binah/
├── app/              # Next.js app router pages and API routes
├── components/       # React components
├── lib/              # Shared utilities and core logic (i18n in lib/i18n/locales/)
├── packages/         # Internal packages (@binah/dsl, @binah/renderer, @binah/generation, ...)
├── skills/           # OpenClaw agent-discovery skill for Binah setup/extension
└── supabase/         # Database schema and migrations
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow, branch naming, and PR guidelines.

## About

Binah is built in Bertoua, in Cameroon's East Region, with real classroom use as the design target — not a demo. It began as a fork of [OpenMAIC](https://github.com/THU-MAIC/OpenMAIC) (see [NOTICE.md](NOTICE.md) for full attribution) and has since diverged into its own product: real Supabase-backed accounts, an admin-managed multi-provider LLM routing layer with automatic failover, Structured Courses, graded assessments, verifiable certificates, and full 12-language coverage.

## License

MIT — see [LICENSE](LICENSE). Attribution to the upstream project this fork began from is in [NOTICE.md](NOTICE.md).
