# AI Call Assistant Project Roadmap

This roadmap outlines actionable steps to build an AI-powered call assistant integrating Twilio, Google Cloud Speech-to-Text, and Kayako API (mocked initially). The MVP focuses on core functionalities, and later stages integrate real Kayako API access.

---

## Phase 1: Domain Understanding & Setup

1. **Research & Build Domain Expertise**
   - Study Voice AI, STT/TTS, and telephony systems.
   - Understand customer support workflows and ticketing systems.
   - Develop your spiky POV: list 3–5 strong opinions about current AI support limitations.

2. **Set Up Development Environment**
   - Install [Cursor](https://cursor.sh/) or your preferred IDE (VS Code recommended).
   - Create a project directory structure:

     /kayako-ai-assistant
       ├── backend/        # Node.js/Express server
       ├── ai-model/       # AI/NLU logic (Dialogflow/OpenAI GPT-4 integration)
       ├── telephony/      # Twilio integration scripts
       ├── logs/           # Call transcripts & debug logs
       ├── mock/           # Mock data for Kayako API (e.g., mock_kb.json)
       ├── .env            # Environment variables (API keys, credentials)
       └── README.md       # Project documentation

   - Install dependencies:

     ```sh
     npm install express twilio @google-cloud/speech axios dotenv
     ```

---

## Phase 2: Build Core AI Call Handling MVP (No Kayako Access Yet)

1. **Twilio Integration**
   - Set up a Twilio account and purchase a phone number.
   - Configure a Twilio webhook to point to your local server (use ngrok to expose localhost).
   - Create an Express endpoint (`/voice`) to answer incoming calls and record messages.

2. **Google Cloud STT Setup**
   - Create a Google Cloud project, enable the Speech-to-Text API, and set up a service account.
   - Install and configure the Google Cloud client library.
   - Build a function to transcribe recorded audio from Twilio using Google STT.

3. **Mock Kayako API Integration**
   - Create a local JSON file (`mock/mock_kb.json`) with sample knowledge base entries.
   - Develop a function `processQuery(transcription)` to search the mock KB and return a response.
   - Simulate ticket creation by logging ticket data to a file or console.

4. **Test End-to-End Flow Locally**
   - Use ngrok to expose your local server.
   - Configure Twilio to call your `/voice` endpoint.
   - Validate:
     - Incoming calls are answered.
     - Audio is recorded and sent to Google STT.
     - Transcription is processed against the mock KB.
     - Appropriate responses are generated (or a "ticket creation" message is logged).

---

## Phase 3: Integrate Real Kayako API

1. **Obtain Kayako Access**
   - Sign up for a Kayako free trial to get API credentials.
   - Store your Kayako API key and related credentials in the `.env` file.

2. **Replace Mock KB Search with Real API Calls**
   - Update your `processQuery()` function to call Kayako’s API for knowledge base retrieval.
   - Use Axios to fetch articles and process them.
   - Validate the response format and adjust your matching logic accordingly.

3. **Automate Ticket Creation**
   - Implement a function to create a ticket in Kayako using their REST API.
   - Update the workflow to call this function when no KB article matches the transcription.

4. **Test and Debug the Full Integration**
   - Perform end-to-end tests: call → STT → API KB search → ticket creation.
   - Use Twilio’s Debugger and log responses for troubleshooting.

---

## Phase 4: Refinement & Future Enhancements

1. **Performance and Latency Optimization**
   - Monitor Google STT response times and adjust settings as needed.
   - Optimize API calls to ensure real-time performance.

2. **Optional UI Development**
   - If needed, build a React dashboard for call analytics and ticket monitoring.
   - Otherwise, rely on Kayako’s built-in UI for ticket management.

3. **Documentation and Spiky POVs**
   - Document your learnings and opinions in the README or a separate markdown file.
   - Maintain changelogs and notes on how your approach diverges from the general consensus.

4. **Deployment Preparation**
   - Prepare your application for production (e.g., Dockerize, set up on Heroku/AWS).
   - Set up monitoring/logging for the deployed service.

---

## Final Notes

- **Start Simple:** Build and test core functionalities with mocks before full API integration.
- **Iterate Quickly:** Validate each integration step (Twilio, Google STT, then Kayako) before proceeding.
- **Keep Learning:** Continue refining your domain expertise and update your spiky POVs based on real-world feedback.

Happy coding! 🚀
