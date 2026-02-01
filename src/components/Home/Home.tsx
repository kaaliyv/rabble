import { useState } from "react";

interface HomeProps {
  onCreateRoom: (nickname: string) => void;
  onJoinRoom: (code: string, nickname: string) => void;
}

export default function Home({ onCreateRoom, onJoinRoom }: HomeProps) {
  const [createName, setCreateName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  const handleCreate = () => {
    const nickname = createName.trim();
    if (!nickname) {
      setError("Please enter a nickname to host");
      return;
    }
    setError("");
    onCreateRoom(nickname);
  };

  const handleJoin = () => {
    const nickname = joinName.trim();
    const code = joinCode.trim().toUpperCase();

    if (!nickname || !code) {
      setError("Enter both a room code and nickname");
      return;
    }

    if (code.length !== 4) {
      setError("Room codes are 4 letters");
      return;
    }

    setError("");
    onJoinRoom(code, nickname);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 text-white">
      <div className="max-w-5xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="font-display text-6xl tracking-wide">Rabble</h1>
          <p className="text-lg text-slate-200 mt-3">
            One word each. Guess together. Reveal the truth.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="bg-white text-slate-900 rounded-3xl p-8 shadow-2xl">
            <h2 className="text-2xl font-bold mb-2">Host a Room</h2>
            <p className="text-sm text-slate-600 mb-6">
              Create a room, enter your items, and start the game.
            </p>

            <label className="block text-sm font-medium text-slate-700 mb-2">Nickname</label>
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              placeholder="Your name"
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-slate-500 focus:outline-none mb-4"
              maxLength={20}
            />

            <button
              onClick={handleCreate}
              className="w-full bg-slate-900 text-white py-3 px-6 rounded-xl font-bold hover:bg-slate-800 transition"
            >
              Create Room
            </button>
          </div>

          <div className="bg-white text-slate-900 rounded-3xl p-8 shadow-2xl">
            <h2 className="text-2xl font-bold mb-2">Join a Room</h2>
            <p className="text-sm text-slate-600 mb-6">
              Enter a 4-letter code and your nickname.
            </p>

            <label className="block text-sm font-medium text-slate-700 mb-2">Room Code</label>
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="ABCD"
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-slate-500 focus:outline-none mb-4 tracking-widest text-center"
              maxLength={4}
            />

            <label className="block text-sm font-medium text-slate-700 mb-2">Nickname</label>
            <input
              type="text"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="Your name"
              className="w-full px-4 py-3 border-2 border-slate-200 rounded-xl focus:border-slate-500 focus:outline-none mb-4"
              maxLength={20}
            />

            <button
              onClick={handleJoin}
              className="w-full bg-slate-900 text-white py-3 px-6 rounded-xl font-bold hover:bg-slate-800 transition"
            >
              Join Room
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 bg-red-100 text-red-700 px-4 py-3 rounded-xl text-center">
            {error}
          </div>
        )}

        <div className="mt-10 text-center text-sm text-slate-300">
          Up to 50 players. Each round: submit one word, then guess the item.
        </div>
      </div>
    </div>
  );
}
