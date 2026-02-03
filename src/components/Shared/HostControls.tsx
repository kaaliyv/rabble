import { useState } from "react";
import type { RoomState, User, VoteTally } from "../../types/game";

interface HostControlsProps {
  roomState: RoomState;
  currentUser: User;
  ws: WebSocket | null;
}

function buildTallies(roomState: RoomState, roundNumber: number): VoteTally[] {
  const counts = new Map<number, number>();
  const roundGuesses = roomState.guesses.filter(g => g.round_number === roundNumber);

  roundGuesses.forEach(guess => {
    counts.set(guess.guessed_item_id, (counts.get(guess.guessed_item_id) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([itemId, count]) => {
      const item = roomState.guessItems.find(i => i.id === itemId);
      return {
        guess_item_id: itemId,
        guess_item_name: item?.name || "Unknown",
        vote_count: count
      };
    })
    .sort((a, b) => b.vote_count - a.vote_count);
}

export default function HostControls({ roomState, ws }: HostControlsProps) {
  const [itemsInput, setItemsInput] = useState("");
  const [error, setError] = useState("");
  const players = roomState.users.filter(user => !user.is_host);

  const handleStartGame = () => {
    if (!itemsInput.trim() || !ws) return;

    const items = Array.from(
      new Set(
        itemsInput
          .split(",")
          .map(item => item.trim())
          .filter(item => item.length > 0)
          .map(item => item.slice(0, 50))
      )
    );

    if (items.length < 4) {
      setError("Please enter at least 4 items");
      return;
    }

    setError("");

    ws.send(JSON.stringify({
      type: "start_game",
      payload: { items }
    }));
  };

  const handleRevealVotes = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "reveal_votes" }));
  };

  const handleRevealAnswer = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "reveal_answer" }));
  };

  const handleNextRound = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: "next_round" }));
  };

  if (roomState.room.status === "lobby") {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-slate-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Host Controls</h3>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Enter items (comma-separated)
          </label>
          <textarea
            value={itemsInput}
            onChange={(e) => setItemsInput(e.target.value)}
            placeholder="Example: Basketball, Chess Club, Drama, Debate"
            className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-slate-600 focus:outline-none resize-none"
            rows={4}
          />
          <p className="text-xs text-gray-500 mt-1">
            Minimum 4 items. If you enter more than players, we will randomly pick enough.
          </p>
          {error && (
            <p className="text-xs text-red-600 mt-2">{error}</p>
          )}
        </div>

        <button
          onClick={handleStartGame}
          disabled={!itemsInput.trim() || players.length < 4}
          className="w-full bg-slate-900 text-white py-3 px-6 rounded-xl font-bold hover:bg-slate-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Start Game
        </button>
        {players.length < 4 && (
          <p className="text-xs text-slate-500 mt-2">Waiting for at least 4 players.</p>
        )}

        <button
          onClick={() => ws?.send(JSON.stringify({ type: "cancel_game" }))}
          className="mt-4 w-full bg-white text-slate-900 py-2 px-6 rounded-xl font-bold border border-slate-200 hover:bg-slate-100 transition"
        >
          Cancel Game
        </button>
      </div>
    );
  }

  if (roomState.room.status === "submitting") {
    const associationCount = roomState.associations.length;
    const totalUsers = players.length;

    return (
      <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-emerald-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Submission Phase</h3>
        <div className="text-center">
          <div className="text-4xl font-bold text-emerald-600 mb-2">
            {associationCount}/{totalUsers}
          </div>
          <p className="text-gray-600">Players have submitted</p>

          <div className="mt-4 bg-gray-100 rounded-full h-4 overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${(associationCount / Math.max(totalUsers, 1)) * 100}%` }}
            />
          </div>
        </div>

        <button
          onClick={() => ws?.send(JSON.stringify({ type: "skip_stage" }))}
          className="mt-5 w-full bg-slate-900 text-white py-3 px-6 rounded-xl font-bold hover:bg-slate-800 transition"
        >
          Force Start Guessing
        </button>
      </div>
    );
  }

  if ((roomState.room.status === "guessing" || roomState.room.status === "lightning") && roomState.currentRound) {
    const currentRound = roomState.currentRound;
    const associations = roomState.associations.filter(
      a => a.guess_item_id === currentRound.guess_item_id
    );
    const phaseLabel = roomState.room.status === "lightning" ? "Lightning Finals" : "Round";

    const eligibleCount = players.length - associations.length;
    const roundGuesses = roomState.guesses.filter(
      g => g.round_number === currentRound.round_number
    );

    const allGuessed = roundGuesses.length >= eligibleCount;
    const tallies = buildTallies(roomState, currentRound.round_number);

    const showRevealVotes = currentRound.status === "active" && allGuessed;
    const showRevealAnswer = currentRound.status === "voting";
    const showNextRound = currentRound.status === "revealed";
    const sortedUsers = [...players].sort((a, b) => b.score - a.score);
    const forceLabel =
      currentRound.status === "active"
        ? "Force Reveal Votes"
        : currentRound.status === "voting"
        ? "Force Reveal Answer"
        : currentRound.status === "revealed"
        ? "Force Next Round"
        : "Skip Stage";

    return (
      <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-indigo-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4">
          {phaseLabel} {currentRound.round_number}
        </h3>

        <div className="mb-4 text-sm text-gray-600">
          Guesses: {roundGuesses.length}/{Math.max(eligibleCount, 0)}
        </div>

        {currentRound.status !== "active" && tallies.length > 0 && (
          <div className="mb-4">
            <h4 className="font-semibold text-gray-700 mb-2">Vote Results</h4>
            <div className="space-y-2">
              {tallies.map((tally) => (
                <div key={tally.guess_item_id} className="flex items-center gap-2">
                  <span className="font-medium flex-1">{tally.guess_item_name}</span>
                  <span className="text-lg font-bold text-indigo-600">{tally.vote_count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentRound.status === "revealed" && (
          <div className="mb-4 bg-emerald-50 border-2 border-emerald-300 rounded-xl p-4 text-center">
            <p className="text-sm text-gray-600 mb-1">Correct Answer</p>
            <p className="text-2xl font-bold text-emerald-700">
              {roomState.guessItems.find(i => i.id === currentRound.guess_item_id)?.name || "Unknown"}
            </p>
          </div>
        )}

        {currentRound.status === "revealed" && sortedUsers.length > 0 && (
          <div className="mb-4 bg-slate-50 border-2 border-slate-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-slate-700 mb-2">Scores</p>
            <div className="space-y-1 text-sm">
              {sortedUsers.slice(0, 5).map(user => (
                <div key={user.id} className="flex items-center justify-between">
                  <span className="text-slate-700">{user.nickname}</span>
                  <span className="font-bold text-slate-900">{user.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {showRevealVotes && (
          <button
            onClick={handleRevealVotes}
            className="w-full bg-indigo-600 text-white py-3 px-6 rounded-xl font-bold hover:bg-indigo-700 transition mb-3"
          >
            Reveal Votes
          </button>
        )}

        {showRevealAnswer && (
          <button
            onClick={handleRevealAnswer}
            className="w-full bg-emerald-600 text-white py-3 px-6 rounded-xl font-bold hover:bg-emerald-700 transition"
          >
            Reveal Answer
          </button>
        )}

        {showNextRound && (
          <button
            onClick={handleNextRound}
            className="w-full bg-slate-900 text-white py-3 px-6 rounded-xl font-bold hover:bg-slate-800 transition"
          >
            Next Round
          </button>
        )}

        {!showRevealVotes && !showRevealAnswer && !showNextRound && (
          <button
            onClick={() => ws?.send(JSON.stringify({ type: "skip_stage" }))}
            className="w-full bg-slate-900 text-white py-3 px-6 rounded-xl font-bold hover:bg-slate-800 transition"
          >
            {forceLabel}
          </button>
        )}

        {(showRevealVotes || showRevealAnswer || showNextRound) && (
          <button
            onClick={() => ws?.send(JSON.stringify({ type: "skip_stage" }))}
            className="w-full bg-white text-slate-900 py-3 px-6 rounded-xl font-bold border border-slate-200 hover:bg-slate-100 transition"
          >
            {forceLabel}
          </button>
        )}
      </div>
    );
  }

  if (roomState.room.status === "finished") {
    return (
      <div className="bg-white rounded-2xl p-6 shadow-lg border-2 border-amber-200">
        <h3 className="text-xl font-bold text-gray-800 mb-4">Game Finished</h3>
        <p className="text-gray-600 text-center">Thanks for playing Rabble.</p>
      </div>
    );
  }

  return null;
}
