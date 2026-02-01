import { useState, useEffect } from "react";
import type { RoomState, User, GuessItem } from "../../types/game";

interface PlayerProps {
  roomState: RoomState;
  currentUser: User;
  ws: WebSocket | null;
}

export default function Player({ roomState, currentUser, ws }: PlayerProps) {
  const [assignedItem, setAssignedItem] = useState<{ id: number; name: string } | null>(null);
  const [associationInput, setAssociationInput] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);

  const [currentRoundData, setCurrentRoundData] = useState<{
    associations: { value: string }[];
    options: GuessItem[];
    eligible: boolean;
  } | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [hasGuessed, setHasGuessed] = useState(false);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data);

      switch (msg.type) {
        case "assignment":
          setAssignedItem({
            id: msg.payload.guess_item_id,
            name: msg.payload.guess_item_name
          });
          break;

        case "association_submitted":
          if (msg.payload.user_id === currentUser.id) {
            setHasSubmitted(true);
          }
          break;

        case "round_started":
          const isEligible = msg.payload.eligible_user_ids.includes(currentUser.id);
          setCurrentRoundData({
            associations: msg.payload.associations,
            options: msg.payload.options,
            eligible: isEligible
          });
          setHasGuessed(false);
          setSelectedOption(null);
          break;

        case "guess_submitted":
          if (msg.payload.user_id === currentUser.id) {
            setHasGuessed(true);
          }
          break;
      }
    };

    ws.addEventListener("message", handleMessage);
    return () => ws.removeEventListener("message", handleMessage);
  }, [ws, currentUser.id]);

  useEffect(() => {
    if (roomState.room.status === "submitting") {
      const submitted = roomState.associations.some(a => a.user_id === currentUser.id);
      setHasSubmitted(submitted);
    }
  }, [roomState, currentUser.id]);

  useEffect(() => {
    if (roomState.room.status === "guessing" && roomState.currentRound) {
      const guessed = roomState.guesses.some(
        g => g.user_id === currentUser.id && g.round_number === roomState.currentRound?.round_number
      );
      setHasGuessed(guessed);
    }
  }, [roomState, currentUser.id]);

  useEffect(() => {
    if (roomState.room.status !== "guessing") {
      setCurrentRoundData(null);
      setSelectedOption(null);
    }

    if (roomState.room.status !== "submitting") {
      setAssociationInput("");
    }
  }, [roomState.room.status]);

  const handleSubmitAssociation = () => {
    if (!associationInput.trim() || !ws || hasSubmitted) return;

    ws.send(JSON.stringify({
      type: "submit_association",
      payload: { value: associationInput.trim() }
    }));
  };

  const handleSubmitGuess = (itemId: number) => {
    if (!ws || hasGuessed) return;

    setSelectedOption(itemId);
    ws.send(JSON.stringify({
      type: "submit_guess",
      payload: { guessed_item_id: itemId }
    }));
  };

  if (roomState.room.status === "lobby") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-600 to-indigo-700 p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-4xl font-bold text-gray-800 mb-2 tracking-widest">
              {roomState.room.code}
            </div>
            <p className="text-gray-600">Room Code</p>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-700 mb-3">
              Players ({roomState.users.length}/50)
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {roomState.users.map(user => (
                <div
                  key={user.id}
                  className={`p-3 rounded-xl ${
                    user.id === currentUser.id
                      ? "bg-indigo-100 border-2 border-indigo-400"
                      : "bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {user.nickname}
                      {user.is_host && " (Host)"}
                    </span>
                    {user.id === currentUser.id && (
                      <span className="text-xs text-indigo-600 font-semibold">You</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="text-center text-gray-600 text-sm">
            Waiting for host to start the game...
          </div>
        </div>
      </div>
    );
  }

  if (roomState.room.status === "submitting") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-teal-600 p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl">
          {assignedItem && !hasSubmitted ? (
            <>
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Your Item</h2>
              <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white p-6 rounded-2xl mb-6 text-center">
                <div className="text-3xl font-bold">{assignedItem.name}</div>
              </div>

              <p className="text-gray-600 mb-4">
                Enter one word you associate with this:
              </p>

              <input
                type="text"
                value={associationInput}
                onChange={(e) => setAssociationInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmitAssociation()}
                placeholder="Your word..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:border-indigo-500 focus:outline-none mb-4"
                maxLength={30}
              />

              <button
                onClick={handleSubmitAssociation}
                disabled={!associationInput.trim()}
                className="w-full bg-indigo-600 text-white py-3 px-6 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit
              </button>
            </>
          ) : hasSubmitted ? (
            <div className="text-center">
              <div className="text-4xl mb-4">Submitted</div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Thanks!</h2>
              <p className="text-gray-600">Waiting for other players...</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-800 mb-2">Waiting for assignment</div>
              <p className="text-gray-600">Hold on while the host starts the round.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (roomState.room.status === "guessing" && !currentRoundData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl text-center">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Loading Round</h2>
          <p className="text-gray-600">Please wait a moment...</p>
        </div>
      </div>
    );
  }

  if (roomState.room.status === "guessing" && currentRoundData) {
    if (!currentRoundData.eligible) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-orange-500 to-red-600 p-4 flex items-center justify-center">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl text-center">
            <div className="text-3xl mb-4">Not this round</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Sit This One Out</h2>
            <p className="text-gray-600">
              You wrote an association for this item, so you cannot guess.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-600 to-purple-700 p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-6 shadow-2xl">
          <h2 className="text-xl font-bold text-gray-800 mb-4">Associated Words</h2>

          <div className="flex flex-wrap gap-2 mb-6">
            {currentRoundData.associations.map((assoc, idx) => (
              <div
                key={idx}
                className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-4 py-2 rounded-full font-medium"
              >
                {assoc.value}
              </div>
            ))}
          </div>

          {!hasGuessed ? (
            <>
              <p className="text-gray-700 font-medium mb-4">Which item do these describe?</p>
              <div className="space-y-3">
                {currentRoundData.options.map(option => (
                  <button
                    key={option.id}
                    onClick={() => handleSubmitGuess(option.id)}
                    className={`w-full bg-gray-100 hover:bg-indigo-100 border-2 border-transparent hover:border-indigo-400 py-3 px-4 rounded-xl font-semibold text-gray-800 transition ${
                      selectedOption === option.id ? "border-indigo-500" : ""
                    }`}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="text-center">
              <div className="text-4xl mb-4">Guess submitted</div>
              <h3 className="text-xl font-bold text-gray-800 mb-2">Thanks!</h3>
              <p className="text-gray-600">Waiting for results...</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (roomState.room.status === "finished") {
    const sortedUsers = [...roomState.users].sort((a, b) => b.score - a.score);
    const me = roomState.users.find(u => u.id === currentUser.id) || currentUser;

    return (
      <div className="min-h-screen bg-gradient-to-br from-amber-400 to-orange-500 p-4 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-2xl">
          <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Game Over</h2>

          <div className="space-y-3">
            {sortedUsers.map((user, idx) => (
              <div
                key={user.id}
                className={`p-4 rounded-xl flex items-center justify-between ${
                  user.id === currentUser.id
                    ? "bg-indigo-100 border-2 border-indigo-400"
                    : "bg-gray-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-gray-400">#{idx + 1}</span>
                  <span className="font-semibold">{user.nickname}</span>
                </div>
                <span className="text-xl font-bold text-indigo-600">{user.score}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 text-center">
            <p className="text-gray-600">
              Your score: <span className="font-bold text-indigo-600">{me.score}</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
