# Voice Commands for Clara (Clinician Only)

This file lists voice commands you can use to interact with the AI assistant, Clara, during an active interpretation session.

**How to Use:** To issue a command, first say the trigger word "Clara," followed by your request. For example: "Clara, pause session."

Command parsing will only activate for utterances identified as coming from the clinician.

## Action-Oriented Commands

These commands trigger specific backend actions. Some may require confirmation or further details via the UI.

- `Clara write prescription [medication name] [dosage] [frequency]`: Initiates the prescription writing process (likely setting status to `pending_review`). Needs robust entity extraction for medication details.
- `Clara send lab order [lab test name]`: Triggers sending a lab order (e.g., CBC, TSH). Needs entity extraction for test name.
- `Clara schedule follow-up [number] [days/weeks/months]`: Initiates scheduling a follow-up appointment.
- `Clara refer patient to [specialty]`: Initiates a referral process.
- `Clara add note to chart [note content]`: Allows adding a quick dictated note to the patient's chart (associated with the session).
- `Clara update vital signs temperature [value] blood pressure [systolic]/[diastolic] heart rate [value]`: Allows dictating vital signs.

## Session Control / Information Commands

These commands control the session flow or request information.

- `Clara repeat that` / `Clara say again`: Asks Clara to repeat the last translation/utterance.
- `Clara pause session`: Temporarily pauses recording/interpretation.
- `Clara resume session`: Resumes a paused session.
- `Clara end session`: Marks the conversation as ended and potentially triggers summary generation.
- `Clara show summary`: (If summary is real-time) Requests displaying the current summary.
- `Clara list actions`: Requests displaying the list of detected actions for the current session.
- `Clara switch language to [language name]`: Manually changes the target translation language (less ideal than auto-detection but could be a fallback).

## Implementation Notes

- **Trigger Word:** Using "Clara" helps differentiate commands from regular conversation.
- **Speaker Identification:** Crucial for ensuring only the clinician can issue commands.
- **Parsing:** Start simple (keyword/phrase matching), evolve to NLU/LLM for complex commands (e.g., prescriptions).
- **Confirmation:** Critical actions (prescriptions, orders) MUST require explicit UI confirmation before final execution.
