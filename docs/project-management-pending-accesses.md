# Project management: pending accesses and decisions

Updated: 2026-08-18
Owner: José Contreras (`jose.contreras@rasika.cl`)

This is the deployment checklist for the new private `/projects` area. Do not paste credentials into this file, source control, or chat. Store production secrets in Supabase Edge Function secrets and use a local ignored `.env.local` only for development.

## Required before the first production deployment

### 1. Rotate the exposed local Supabase personal access token

- [ ] Revoke and replace the Supabase personal access token that appeared in local command output on 2026-08-18.
- [ ] Re-authenticate the Supabase CLI after rotation.
- [ ] Confirm that the replacement token can access the **Rasika Website 2026** project (`firnxsegqamdoajycpyf`).

Reason: the current Codex Supabase connector points to a different project, so the project-management migration and Edge Function have only been prepared locally and must not be applied with the wrong connection.

### 2. Website Supabase access

- [ ] Connect the Supabase integration to **Rasika Website 2026**, or authorize the already-linked local CLI for project `firnxsegqamdoajycpyf`.
- [ ] Confirm permission to apply database migrations, deploy Edge Functions, and set function secrets.
- [ ] Confirm that the Supabase Auth user for `jose.contreras@rasika.cl` exists. The first slice intentionally grants project access only to this user.
- [ ] Apply `supabase/migrations/20260818161814_project_management_foundation.sql` and deploy `project-admin` only after the target project has been verified.

### 3. CRM client classification

- [ ] Review CRM contacts whose `lifecycle_stage` is `client` and associate them with their organization in `organization_contacts`.
- [ ] Add or correct organizations for clients that bought a project/service but are not yet represented as a client contact.
- [ ] Confirm whether a sent/accepted quote is sufficient to promote a contact to `client`, or whether this remains a manual CRM decision.

The project picker deliberately uses the existing CRM. An organization is selectable when it has at least one active CRM contact classified as a client, or when it is already linked to an active/historical project. This prevents generic leads from appearing as project clients.

### 4. Google Calendar authorization

- [ ] Select or create the Google Cloud project owned by the Rasika Workspace domain.
- [ ] Enable the Google Calendar API and configure an internal OAuth consent screen.
- [ ] Create a Web OAuth client and add the final Supabase callback URL after the calendar function is deployed.
- [ ] Authorize offline access for `jose.contreras@rasika.cl`.
- [ ] Select a dedicated calendar for project work, or explicitly approve use of José's primary calendar.
- [ ] Provide the selected calendar ID through a Supabase secret/config value.

Proposed least-privilege scopes for the calendar slice:

- `calendar.calendarlist.readonly`
- `calendar.freebusy`
- `calendar.events.owned` or the narrower app-created-event scope if it covers the agreed workflow

The initial integration will only schedule José. Calendar writes will be idempotent, visible in the audit log, and will require an approved agent action when initiated by AI.

### 5. Google Drive and Docs authorization

- [ ] Create a Shared Drive named **Rasika Projects** (recommended instead of a folder in My Drive).
- [ ] Create or select a dedicated Google integration principal managed by Rasika.
- [ ] Add that principal to the Shared Drive as **Contributor** (`writer`)—not Content Manager or Manager.
- [ ] Enable Google Drive API and Google Docs API in the selected Google Cloud project.
- [ ] Provide the Shared Drive ID and root projects folder ID as Supabase secrets/config values.
- [ ] Confirm whether Rasika will enroll in the Google Workspace Developer Preview for API-based suggest-mode writes.
- [ ] Create a `Minutas` subfolder inside every project folder and authorize the same Drive integration to read all of its descendants.
- [ ] Confirm the Notes by Gemini intake rule: notes are generated in the meeting organizer's `Google Meet` folder, so José must either place/share them into the project's `Minutas` folder or authorize the future synchronizer to copy them there using the same Drive connection.
- [ ] Enable Notes by Gemini for the selected Workspace account and keep José as organizer (or co-organizer with access) for project meetings.

The Contributor role is intentional: it can read inherited content, create files, comment, and edit content throughout the Shared Drive, but it cannot reorganize, trash, or permanently delete Shared Drive items. The application will add a second guardrail by never exposing Drive delete, trash, remove, move, or permission-management operations to the project agent.

Notes by Gemini will be registered in `pm_project_documents` as `meeting_transcript`, linked to the corresponding meeting task and Calendar event through metadata, and kept `read_only` and internal by default. The project agent may use only the indexed revision as evidence; every answer should preserve the source document link. Rescheduling, assignment, or priority changes inferred from a minute must enter the existing agent-action proposal and human-approval flow.

Document-write policy:

1. The agent may inspect project folders and subfolders.
2. The agent may create an app-level proposed change with a base revision and diff.
3. A human must approve the proposal.
4. Until Developer Preview access is confirmed and tested, the system will not change the Google document; the approved proposal must be applied manually in Google Docs.
5. If Developer Preview is approved, the executor may write only in `SUGGEST` mode and must verify Google's returned update state. It must never accept its own suggestion.

### 6. Email notifications through Resend

- [ ] Confirm `jose.contreras@rasika.cl` as the initial notification recipient.
- [ ] Approve a sender identity such as `Rasika Projects <projects@rasika.cl>` and verify the domain in Resend if needed.
- [ ] Add `PM_NOTIFICATION_FROM_EMAIL` and `PM_NOTIFICATION_TO_EMAIL` as Supabase secrets.
- [ ] Confirm the desired notification cadence: immediate for critical deviations and one daily digest for warnings is recommended.

The existing Resend connection can be reused; no additional paid notification product is required.

### 7. OpenAI connection for the future project agent

- [ ] Confirm that the existing `OPENAI_API_KEY` may be used by a new, separate `project-agent` Edge Function.
- [ ] Approve a monthly usage ceiling and retention policy before agent deployment.

The CourseMentor chatbot remains separate. Only its general safety patterns—structured actions, server validation, idempotency, audit trails, and explicit authorization—will be reused. The project agent will read the canonical `services` catalog and project performance data but will not reuse CourseMentor's sales prompt or lead-oriented proxy.

## Business inputs needed before template calibration

- [ ] Confirm the initial departments and owners. Proposed starting set: Project Management, Commercial/Admin, Instructional Design, Audiovisual, Development/LMS, and QA/Client Review.
- [ ] Confirm Chile working days, standard daily capacity, holidays, and whether half-days are supported.
- [ ] Select the first 3–5 services/bundles to calibrate into reusable task blueprints.
- [ ] For each selected service, confirm task sequence, dependencies, department, required inputs, planned effort hours, and elapsed working-day offsets.
- [ ] Confirm the immutable project ID format `RAS-YYYY-NNNN`.
- [x] Client share scope for the first slice: project identity, committed dates, department names/colors, and `client_visible` Gantt activities only. Documents, internal notes, agent proposals, Calendar/Drive details, people, inputs, effort, prices, and internal metadata are excluded. Links are opaque, revocable, and expire after 90 days.

## Free-first dependency policy

- [x] No paid Gantt dependency is included in the first slice.
- [x] The timeline is built with local HTML/CSS/JavaScript and the existing Astro stack.
- [x] Existing Supabase, Google Workspace, Resend, and OpenAI connections are reused where appropriate.
- [ ] Any future open-source package must be reviewed for license, maintenance, accessibility, and bundle size before adoption.
