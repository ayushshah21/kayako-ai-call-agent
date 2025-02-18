# Kayako AI Call Assistant - Product Requirements

## Problem Statement

We want to create a system where:

- Kayako can automatically answer incoming customer calls using AI
- The system retrieves answers from a connected knowledge base
- The AI responds in real-time on the call if an answer is found
- If an answer is not found, the AI ends the call by informing the caller that an expert will follow up
- A ticket is created in Kayako with the full call context, including key details like email and call transcript

## Key Components

### 1. Voice AI System

- Ability to answer and process incoming calls
- Human-like speech synthesis and natural language understanding (NLU)

### 2. Knowledge Base Integration

- AI retrieves relevant responses from the knowledge base via API

### 3. Call Handling Logic

- Determines whether an answer is found
- Ends call if no answer is available and triggers expert follow-up

### 4. Kayako API Integration

- Creates a ticket with call details, including transcript and caller information

### 5. User Data Capture

- Collects key details such as caller's email and reason for calling

## User Flow

1. A customer calls the support line
2. Kayako AI answers the call using human-like speech
3. The AI extracts key details (e.g., email, issue description)
4. It searches the knowledge base for a relevant answer
5. If an answer is found → AI delivers the response in real-time
6. If no answer is found → AI informs the caller that a human agent will follow up
7. The system ends the call and automatically creates a Kayako support ticket
8. A human agent reviews the ticket and follows up as needed

## Example User Experience

### Customer Calls Support

AI: "Thank you for calling Kayako Support. How can I assist you today?"

### AI Identifies the Issue & Searches Knowledge Base

Customer: "I forgot my password. How do I reset it?"
AI (searches KB, finds answer): "You can reset your password by visiting our login page and clicking 'Forgot Password.' Would you like me to send you a reset link?"

### No Answer Found Scenario

Customer: "I need help with a custom API integration."
AI (no KB match): "I'll pass this on to our expert support team. They'll follow up shortly. Have a great day!"

### Ticket Created in Kayako

- A new ticket logs the call transcript, caller details, and AI actions

## Architectural Building Blocks

### Voice AI Engine

- Speech-to-text (STT) for understanding customer input
- Text-to-speech (TTS) for natural, human-like responses

### Knowledge Base Search Module

- Connects to Kayako's KB via API
- Retrieves relevant articles and provides summarized answers

### Call Management System

- Handles incoming calls
- Determines if an answer exists
- Ends call appropriately

### Ticket Creation in Kayako

- Logs call details, transcript, and key extracted information
- Tags tickets for agent review

## Benefits & Takeaways

- Faster response times - AI handles common questions instantly
- Reduced agent workload - AI resolves simple issues, leaving complex cases for experts
- Seamless customer experience - AI speaks naturally and provides immediate answers
- Automatic ticketing - Ensures no customer request is lost

## User Stories & Acceptance Criteria

### User Story 1: AI Handles Incoming Calls & Provides Answers

**Title:** As a VP of Customer Support, I want AI to handle incoming support calls so my team can focus on more complex issues.

**Description:** The AI assistant should answer calls, understand customer inquiries, and provide accurate responses using our knowledge base.

**Acceptance Criteria:**

- AI system automatically answers incoming customer calls
- AI listens to customer inquiries and processes them using natural language understanding
- AI searches the knowledge base and provides relevant answers in a natural, conversational tone
- AI handles simple conversational flows, such as clarifying questions when needed

### User Story 2: AI Escalates Unresolved Issues to Human Agents

**Title:** As a VP of Customer Support, I want AI to recognize when it doesn't have an answer and ensure a human follows up, so no customer inquiry is left unresolved.

**Description:** If the AI cannot find an answer in the knowledge base, it should politely end the call while assuring the customer that a human agent will follow up.

**Acceptance Criteria:**

- AI searches the knowledge base for answers before responding
- If no relevant answer is found, AI informs the caller that a human agent will follow up
- AI ends the call professionally and ensures a support ticket is created

### User Story 3: AI Captures Key Customer Information

**Title:** As a VP of Customer Support, I want AI to capture key customer details so my team has all the necessary context to follow up efficiently.

**Description:** AI should collect and log important customer details such as name, email, and issue summary to ensure accurate and efficient follow-ups.

**Acceptance Criteria:**

- AI asks for and confirms the customer's email address
- AI summarizes the customer's issue based on the conversation
- AI logs the collected information into a new support ticket in Kayako

### User Story 4: AI Automatically Creates Support Tickets

**Title:** As a VP of Customer Support, I want AI to automatically generate tickets from calls so my team can easily track and manage customer inquiries.

**Description:** The AI should create a support ticket in Kayako with the full call transcript, customer details, and issue summary.

**Acceptance Criteria:**

- AI generates a ticket when a call ends
- Ticket includes the full call transcript, caller details, and a summary of the issue
- Ticket is categorized and tagged appropriately for easy triage by the support team

### User Story 5: AI Integrates Seamlessly with Kayako's APIs

**Title:** As a VP of Customer Support, I want AI to connect with Kayako's APIs so it can retrieve knowledge base answers and create tickets without manual intervention.

**Description:** The AI assistant should use Kayako's APIs to pull information from the knowledge base and log support tickets.

**Acceptance Criteria:**

- AI retrieves knowledge base articles via the Kayako API
- AI creates and updates support tickets using the Kayako API
- API calls follow security and authentication best practices

## Developer Resources

### API Documentation

- [Kayako API Reference](https://developer.kayako.com/api/v1/reference/introduction/)
