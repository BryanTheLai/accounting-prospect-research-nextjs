# Call Desk script fidelity and mobile recovery

Owner: Bryan Lai. Verified: 2026-10-06. Scope: Call Desk content and mobile interaction.

## Content

The requested original opener is “Is this a bad time to talk, or do you have 60 seconds?” It is present in Hydroball's saved script (OC-SGMY-001, 2306 characters) and other Malaysian contacts. The visible Call script selector now defaults to Original “bad time to talk” scripts. Queue filtering checks saved phone_script wording before pagination, excluding older short introductions; 400 callable contacts match. All saved scripts, including YC, remain selectable. The direct link is `https://rather-gnu-gathered-diagram.trycloudflare.com/?callScript=original#dialer`.

The Call Desk uses the complete saved `phone_script` from the same local database as Streamlit. It changes only `{time_greeting}` and the `Good day` greeting, matching Streamlit's rendering behavior. No length cap, excerpt, or replacement sales script is applied.

The six full YC objection handlers and original follow-up template are copied from `../../accounting-prospect-research/app.py`. The six Malaysian objection handlers and original follow-up template are copied from this repository's legacy Streamlit `app.py`. `web/scripts/sync_streamlit_call_content.py` extracts the authored text using Python AST and produces `web/lib/streamlit-call-content.json`; run it with `--check` to verify source parity. `callPlaybook` selects the appropriate source by the lead's campaign.

The live script is open in a dedicated section above contact editing and other supporting material. Copy uses the same complete text displayed on the page. All original objection replies are available as individually expandable questions. Some historical YC imports contain only a one-line introduction in the database; this change preserves their source text rather than inventing a longer script.

## Mobile changes

- Single-column cards and forms; script text is 17px with generous line spacing and wrapping.
- Call and WhatsApp use native phone/WhatsApp links in a fixed bottom toolbar, with safe-area padding and content space underneath.
- Buttons and disclosures have at least 48px touch targets; main phone actions are at least 56px.
- Form text is 16px to avoid iOS focus zoom; outcomes use two columns.
- Removed whole-card swipe navigation, which could skip a lead while scrolling or selecting script text. Previous and Skip remain explicit controls.
- Call queue has its own loading state, request timeout, cancellation, and retry. Contact loading errors have a retry button.
- Notes, duration, and follow-up fields clear when browsing to another contact so they do not get logged against the wrong company. Skip does not save an outcome.
- The decorative canvas animation does not run on coarse-pointer devices or when reduced motion is requested.

## Verification

- `npm test`: 78 passed, 0 failed, including preservation of long scripts, full campaign-specific content and original-script queue pagination.
- `npm run typecheck`: exit code 0.
- `py -3 scripts/sync_streamlit_call_content.py --check`: full content matches both Streamlit sources.
- `npm run build`: exit code 0. Existing Windows native SWC warning falls back to WASM.
- Production app restarted through the paired launcher at `127.0.0.1:3002`, with live email delivery false. App/dispatcher exec session: `76200`.
- Deployed read-only verification: first 100 original queue contacts all have a bad-time opener. First contact FOMO Solution Sdn Bhd (OC-JOB-164) has the exact requested opener and complete 2344-character script. Hydroball's full 2306-character original remains unchanged.
- `py -3 scripts/verify_call_desk.py`: homepage HTTP 200; deployed mobile styles present; longest YC and JobStreet saved scripts returned unchanged (496 and 2,439 characters respectively); YC call queue 24 contacts; dispatcher idle and live false.
- Existing Cloudflare process remains pointed at port 3002. URL: `https://rather-gnu-gathered-diagram.trycloudflare.com/#dialer`.

Mobile visual and tap verification remains unconfirmed. The prior browser tool action to refresh the tunnel was rejected with `requested URL protocol is not allowed`; no alternate browser/navigation workaround was attempted. Local HTTP/data and compiled asset checks do not establish rendered-device behavior.
