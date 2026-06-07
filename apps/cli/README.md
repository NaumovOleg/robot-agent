# Robocode

Robocode is an AI code assistant CLI application built with Ink and React. It provides an interactive terminal user interface to manage profiles, sessions, and chat interactions with AI models.

## Features

- Profile management with setup and active profile selection
- Session management to maintain conversation state
- Simple navigation between welcome, profile setup, and assistant chat screens
- Utilizes AI models for code assistance

## Technologies

- TypeScript
- React and Ink for CLI UI
- Langchain core
- Dotenv for environment variable management

## Getting Started

### Installation

Clone the repository and install dependencies:

```bash
pnpm install
```

### Development

Start the development mode with live reload:

```bash
pnpm run dev
```

### Build

Build the project to dist folder:

```bash
pnpm run build
```

### Run

Start the built application:

```bash
pnpm start
```

## Architecture

Robocode is architected as a modular, context-driven CLI AI assistant application, designed to provide developers with scalable, maintainable, and extensible interaction capabilities.

### Core Architecture Components

- **Screens**: Various UI states including Welcome Screen, Profile Setup, Assistant Chat, and Active Profile Display. These represent navigation and interaction states of the CLI app.

- **Providers**: React context providers that manage global state such as active profiles, sessions, and API configurations, facilitating state sharing across the app.

- **Hooks**: Custom hooks encapsulate logic for handling profiles, chat sessions, and AI model interactions, promoting reusable and side effect management code.

- **Components**: Reusable UI elements that render interface parts consistently across screens.

### Data Flow

- On startup, profiles and configurations are loaded and initialized.
- Application state is managed through providers, updated and accessed via hooks.
- User inputs in chat flow through hooks to dispatch to AI models (via Langchain).
- State changes trigger UI rerendering through React's context and hooks.

### Directory Structure

- `src/screens/`: CLI UI screens reflecting different user interactions and status.
- `src/providers/`: Context providers exposing state and methods globally.
- `src/hooks/`: Abstractions for business logic and state management.
- `src/components/`: Modular UI building blocks for consistent rendering.
- `src/types/`: TypeScript types and interfaces defining data shapes.

### Design Principles

- **Modularity**: Clear separation of concerns supports maintainability.
- **Context-Driven State**: Enables centralized, consistent app state.
- **Scalability**: Hook and provider patterns allow extending features with minimal coupling.
- **Responsiveness**: React and Ink ensure interactive CLI experience with live updates.
- **Integration**: Seamlessly connects to AI models through Langchain.

This architecture ensures that Robocode remains developer-friendly, easy to maintain, and extend, providing robust AI assistant functionality through a straightforward CLI interface.



- **Main Components:**
  - **Screens:** These represent the different UI states of the CLI app, including Welcome Screen for initial interaction, Profile Setup for managing user profiles, Assistant Chat for ongoing AI conversations, and Active Profile Display.
  - **Providers:** React context providers that supply global state and services such as active profiles, chat sessions, and configuration settings.
  - **Hooks:** Custom hooks like `useProfiles` and `useChatSessions` encapsulate logic for managing state and side effects.
  - **Components:** Reusable UI building blocks used across screens, managing presentation and interaction.

- **Data Flow:**
  - The application initializes by loading available profiles and environment configs.
  - User actions update profile selections and session states through hooks.
  - Chat input is processed by AI models accessed via Langchain, with results rendered on the chat screen.
  - Providers manage state propagation ensuring all components reflect current data.

This modular architecture allows efficient state management, clear UI flow, and seamless integration with AI models while maintaining a responsive CLI experience.

- `src/screens/`: Contains UI screens like Welcome, Profile Setup, Chat Assistant for different app states and navigation
- `src/providers/`: Context providers managing global state such as Profiles, Sessions, and API
- `src/hooks/`: Custom hooks for accessing and manipulating profile, session, and AI interaction logic
- `src/components/`: Reusable UI components used across screens
- `src/types/`: TypeScript types and interfaces for data models and props

## Architecture Overview

The application architecture follows a modular and context-driven design with the following core parts:

1. **Screens:** Represent different app views - Welcome screen, Profile Setup screen, and the Assistant Chat screen. Navigating between these screens manages UI state transitions.

2. **Providers:** React context providers encapsulate global app state including user profiles, active session management, and AI API communication. They enable shared state and logic access throughout the app.

3. **Hooks:** Custom hooks provide simplified interaction with providers and encapsulate business logic for managing profiles, sessions, and chat flows with AI models.

4. **Components:** UI building blocks used by screens for rendering and interaction handling.

5. **Data Flow:** User interaction flows initiate state changes via hooks -> providers update context states -> screens re-render accordingly. AI interaction happens asynchronously with state updates on responses.

This layered structure ensures separation of concerns, easier testing, and extensibility for new features or AI models.



- `src/`: Source code including screens, providers, hooks, components, and types
- `dist/`: Compiled output
- `package.json`: Configuration and dependencies

## Usage

- Run the CLI app.
- Set up or select an active profile.
- Interact with the AI assistant through chat sessions.

## License

This project is private and for learning purposes only.
