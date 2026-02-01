# Rabble

Rabble is a fast, Jackbox-style word association party game for groups. Players join from their phones, submit one word for a secret item, and then everyone guesses which item the words describe. The host runs the big screen.

## How It Works

1. The host creates a room and enters a list of items to guess.
2. Players join with the room code on their phones.
3. Each player is assigned one item and submits a single-word association.
4. The group guesses which item the words describe (multiple choice).
5. The host reveals the poll results, then the correct answer.
6. Repeat for each round, then show the final leaderboard.

For large rooms (15+ players), the game automatically caps normal rounds and finishes with **Lightning Finals** so the game stays short while still using all submitted words.

## Getting Started

Install dependencies:

```bash
bun install
```

Run in development:

```bash
bun dev
```

Build for production:

```bash
bun run build
```

Run production server:

```bash
bun start
```

## Notes

- The host is a screen-only role (not a player).
- Players can reconnect after refresh using local storage.
- Hosts can skip stages or cancel the game in the lobby.

## Screenshots
<img width="1024" height="684" alt="image" src="https://github.com/user-attachments/assets/71c2155d-e36e-4540-825c-269c6910a88f" />

<img width="1906" height="916" alt="image" src="https://github.com/user-attachments/assets/1dfcee66-077f-4570-ae92-d2ed4f431357" />
