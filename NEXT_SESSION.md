# Next Session

## First mailing campaign

- The 2020 SENCE OTEC registry is now represented as 3,236 organizations, 3,584 unique institutional contacts, and 3,617 organization/contact relationships under the `OTEC` label.
- Six OTECs were preserved as organizations without a valid email address. The source CSV remains local and ignored by Git.
- Every imported OTEC contact is `not_subscribed` and `not_synced`; the registry import did not create newsletter consent or send data to Resend.
- Use the admin CSV dry run for future registry refreshes. It maps organization fields, extracts multiple valid addresses, detects existing organizations and contacts, reports unresolved rows, and recognizes repeat uploads by source-file hash.
- Preserve each contact's source, consent status, consent date, language, organization, tags, and any available relationship history. Do not treat an imported address as subscribed unless its consent basis supports marketing email.
- Before the first OTEC campaign, define the lawful contact basis, exclusions, suppression rules, and whether addresses need verification or enrichment. Keep campaign eligibility separate from the `OTEC` group label.
- Define the initial audience segment, campaign objective, sender identity, subject line, Spanish/English content requirements, and measurable conversion action.
- Prepare the first campaign in the admin dashboard using the existing Resend integration, with recipient count, exclusions, preview, test email, and explicit human approval before any production send.
- Confirm unsubscribe handling, suppression-list behavior, bounce/complaint processing, and campaign attribution before launch.
- Add a clear option to follow Rasika on LinkedIn in the campaign template. Use the canonical Rasika LinkedIn company-page URL once confirmed.
- Consider the same LinkedIn follow action for newsletter confirmation and other relevant subscription-success surfaces, without making it a condition of subscribing.

## Remaining client demo

- Buffalo Waffles now launches internally from `/courses/bw_scorm/index_scorm.html?StandAlone=true`; preserve its MP4 card preview.
- EY "LMS Custom Integration" still uses TalentLMS until an internal case-study destination is chosen.
- Preserve the client card and modal presentation when replacing that remaining destination.

## Future CourseMentor channel

- Add WhatsApp as an additional CourseMentor conversation channel.
- Reuse the same lead identity, conversation history, qualification, quote, and meeting-scheduling flow used by the website chatbot.
- Define explicit opt-in, message-template, handoff, and unsubscribe rules before enabling outbound conversations.
