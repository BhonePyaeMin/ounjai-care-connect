# Progress 2 VDO: outline and speaking plan (about 6 minutes)

Requirement: a **prototype demo** where **all 3 members** explain their own contribution to **testing and evaluation**. The public link goes on **page 1** of the PDF.

Before recording: run `npm start`, open http://localhost:3000 in a clean browser window, have a test account ready (register one on camera or just before). Keep the PDF's Figure/Table pages handy as backup. Say your real contribution; the lines below are suggestions to edit.

| Time | Who | Show on screen | What to say |
|---|---|---|---|
| 0:00 | Naruedee | Home page | One sentence on the problem (14.49M older adults, 1.8M living alone) and what OunJai does. "This is the Progress 1 design, now working." |
| 0:30 | Naruedee | Register (tick consent), paste "Grandmother, 74, early dementia and diabetes, recently fell and needs help walking" | The user flow and PDPA consent. Usability and phone-layout checks you did. |
| 1:15 | Naruedee | Matching page, open "Why this match?", Book Now, confirm booking | How the score is explained to users; what you tested on screens and forms. |
| 2:00 | Sarah | Tracking page, click "Demo: start the trip now", watch the marker and ETA | Booking, conflict and tracking tests; say clearly that GPS is simulated. |
| 2:45 | Sarah | Press SOS, show result; then Emergency page contacts | SOS and contacts tests; say clearly that SMS is simulated and 1669 is the real route. Account-deletion and security tests (access control, rate limits). |
| 3:30 | Prakaikan | Services page: run the 4 examples, then the "elephant on her chest" text | How triage works (rules decide, LLM can never lower urgency); show Emergency, Urgent, Thai, Routine and the amber "Not sure" answer. |
| 4:30 | Prakaikan | PDF section 3.3 table | The three evaluation sets. Be upfront: first run on unseen wording found only 2/8 and 3/8 emergencies; you fixed the causes and added the "Not sure" safety net. Matching: 11/11 on test queries. |
| 5:15 | Sarah | Terminal: `npm test` (67 pass) | Automated tests and speed results. |
| 5:40 | Naruedee | PDF section 5.5 | Verdict: not ready for public use; gates before a pilot (clinician review, real SOS and GPS, caregiver verification, PDPA legal review). Thank you. |

## Tips
- Upload the video somewhere that opens **without signing in** (for example "anyone with the link can view"), then open the link in a private window to check.
- Put the link in the red box on page 1 of the PDF (it currently says PASTE THE PUBLIC VDO LINK HERE).
- Edit section 6 of the PDF (team contributions) so each line is true for that person. The build script is not needed for small edits; ask for a rebuild with new text.
- Do not claim real GPS, SMS or payments. The report says they are simulated; the video should match.
