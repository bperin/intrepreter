# Voice Commands for Clara (Clinician Only)

This file lists voice commands you can use to interact with the AI assistant, Clara, during an active interpretation session.

**How to Use:** To issue a command, first say the trigger phrase "Hey Clara," followed by your request. For example: "Hey Clara, take a note about the patient's cough."

The system uses AI to detect if your speech contains a command and extract relevant details. Command detection only activates for utterances identified as coming from the clinician.

## Action-Oriented Commands

These commands trigger specific backend actions, often creating an item in the "Actions" list for review or completion.

- `Hey Clara, take a note [note content]`: Records a clinical note. The AI extracts the content of your note.
  _Example: "Hey Clara, take a note patient reports intermittent dizziness for the past 3 days."_

- `Hey Clara, schedule follow-up [details]`: Records the intent to schedule a follow-up. The AI extracts details like timeframe or reason.
  _Example: "Hey Clara, schedule follow up in 2 weeks to check blood pressure."_

- `Hey Clara, write prescription [medication details]`: Initiates the prescription writing process by capturing the details. The AI extracts medication name, dosage, frequency etc. Requires UI review/confirmation.
  _Example: "Hey Clara, write prescription for Lisinopril 10mg once daily."_

_Future commands may include: send lab order, refer patient, update vital signs._

## Session Control / Information Commands (Not Currently Implemented via Voice)

These commands were previously considered but are **not** currently handled by the voice command system. They would need separate implementation if desired.

- `Clara repeat that` / `Clara say again`
- `Clara pause session`
- `Clara resume session`
- `Clara end session`
- `Clara show summary`
- `Clara list actions`

## Implementation Notes

- **Trigger Phrase:** Using "Hey Clara" helps differentiate commands.
- **Speaker Identification:** Crucial for ensuring only the clinician can issue commands.
- **Tool Calling:** Uses OpenAI's tool/function calling to understand commands and extract parameters.
- **Confirmation:** Critical actions (prescriptions, orders) should ideally require explicit UI confirmation before final execution, even after being detected via voice.
