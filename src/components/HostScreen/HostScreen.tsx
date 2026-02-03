import { useEffect, useState } from "react";
import type { RoomState, User, VoteTally } from "../../types/game";
import QRCode from "qrcode";
import HostControls from "../Shared/HostControls";

interface HostScreenProps {
  roomState: RoomState;
  ws: WebSocket | null;
  onLeave: () => void;
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

function Podium({ players }: { players: User[] }) {
  const top = players.slice(0, 3);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {top.map((player, index) => (
        <div
          key={player.id}
          className={`rounded-3xl p-6 text-center shadow-xl ${
            index === 0
              ? "bg-gradient-to-br from-amber-300 to-yellow-500 text-slate-900"
              : index === 1
              ? "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900"
              : "bg-gradient-to-br from-orange-300 to-orange-500 text-slate-900"
          }`}
        >
          <div className="font-display text-5xl">#{index + 1}</div>
          <div className="mt-2 text-2xl font-bold">{player.nickname}</div>
          <div className="mt-1 text-lg font-semibold">{player.score} pts</div>
        </div>
      ))}
    </div>
  );
}

export default function HostScreen({ roomState, ws, onLeave }: HostScreenProps) {
  const players = roomState.users.filter(user => !user.is_host);
  const hostUser = roomState.users.find(user => user.is_host) || roomState.users[0];
  const totalRounds = roomState.guessItems.length;
  const [qrUrl, setQrUrl] = useState<string>("");
  const baseUrl =
    (import.meta as any).env?.BUN_PUBLIC_BASE_URL ||
    (import.meta as any).env?.VITE_BASE_URL ||
    window.location.origin;

  useEffect(() => {
    const joinUrl = `${baseUrl.replace(/\/$/, "")}/?code=${roomState.room.code}`;

    QRCode.toDataURL(joinUrl, { margin: 1, width: 360 })
      .then((dataUrl) => setQrUrl(dataUrl))
      .catch(() => setQrUrl(""));
  }, [roomState.room.code]);

  if (roomState.room.status === "lobby") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_#6d28d9_0,_transparent_50%)]" />
        <div className="relative z-10 px-8 py-12 max-w-6xl mx-auto">
          <div className="text-center mb-10">
            <h1 className="font-display text-6xl md:text-7xl tracking-wide">RABBLE</h1>
            <p className="text-lg text-indigo-100 mt-3">Word association showdown</p>
          </div>

          <div className="bg-white/10 rounded-[2rem] border border-white/20 p-10 backdrop-blur">
            <div className="text-center">
              <div className="text-sm uppercase tracking-[0.4em] text-indigo-200">Room Code</div>
              <div className="font-display text-7xl md:text-8xl mt-4 tracking-[0.2em]">
                {roomState.room.code}
              </div>
              <p className="mt-4 text-indigo-100">Players join at this code on their phones.</p>
            </div>

            <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.2fr] items-center">
              <div className="flex flex-col items-center gap-4">
                <div className="text-sm uppercase tracking-[0.3em] text-indigo-200">Scan to Join</div>
                {qrUrl ? (
                  <img
                    src={qrUrl}
                    alt="Rabble join QR code"
                    className="w-52 h-52 rounded-2xl border border-white/30 shadow-xl bg-white p-3"
                  />
                ) : (
                  <div className="w-52 h-52 rounded-2xl border border-white/30 bg-white/10 flex items-center justify-center text-indigo-100">
                    QR loading...
                  </div>
                )}
                <div className="text-xs text-indigo-100 break-all text-center">
                  {baseUrl.replace(/\/$/, "")}/?code={roomState.room.code}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-2xl font-bold">Players</h2>
                  <span className="text-indigo-200">{players.length}/50</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {players.map(player => (
                    <div key={player.id} className="bg-white/10 rounded-2xl px-4 py-3">
                      <div className="text-lg font-semibold">{player.nickname}</div>
                    </div>
                  ))}
                  {players.length === 0 && (
                    <div className="col-span-full text-indigo-100">Waiting for players to join...</div>
                  )}
                </div>
              </div>
            </div>

            {hostUser && (
              <div className="mt-10 bg-white/10 rounded-3xl border border-white/20 p-6">
                <HostControls roomState={roomState} currentUser={hostUser} ws={ws} />
              </div>
            )}
          </div>

          <div className="mt-8 flex justify-center">
            <div className="bg-white/10 rounded-full px-6 py-3 text-indigo-100">
              Tip: At least 4 players needed to start.
            </div>
          </div>
        </div>
        {hostUser && (
          <div className="absolute bottom-6 right-6 w-80">
            <HostControls roomState={roomState} currentUser={hostUser} ws={ws} />
          </div>
        )}
      </div>
    );
  }

  if (roomState.room.status === "submitting") {
    const submittedCount = roomState.associations.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-700 via-teal-700 to-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top,_#34d399_0,_transparent_45%)]" />
        <div className="relative z-10 px-8 py-12 max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="font-display text-6xl">Submit Your Word</h1>
            <p className="text-emerald-100 mt-3">Players are sending their associations now.</p>
          </div>

          <div className="bg-white/10 rounded-[2rem] border border-white/20 p-10 backdrop-blur">
            <div className="text-center">
              <div className="font-display text-7xl">{submittedCount}/{players.length}</div>
              <div className="text-emerald-100 mt-2">Responses received</div>
            </div>

            <div className="mt-8">
              <div className="h-4 bg-white/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all duration-500"
                  style={{ width: `${(submittedCount / Math.max(players.length, 1)) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
        {hostUser && (
          <div className="absolute bottom-6 right-6 w-80">
            <HostControls roomState={roomState} currentUser={hostUser} ws={ws} />
          </div>
        )}
      </div>
    );
  }

  if ((roomState.room.status === "guessing" || roomState.room.status === "lightning") && roomState.currentRound) {
    const round = roomState.currentRound;
    const currentItem = roomState.guessItems.find(item => item.id === round.guess_item_id);
    const associations = roomState.associations.filter(a => a.guess_item_id === round.guess_item_id);
    const guesses = roomState.guesses.filter(g => g.round_number === round.round_number);
    const eligibleCount = players.length - associations.length;
    const tallies = buildTallies(roomState, round.round_number);
    const maxVotes = Math.max(...tallies.map(t => t.vote_count), 1);
    const phaseLabel = roomState.room.status === "lightning" ? "Lightning Finals" : "Round";

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-30 bg-[radial-gradient(circle_at_top,_#6366f1_0,_transparent_50%)]" />
        <div className="relative z-10 px-8 py-12 max-w-6xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-8">
            <div>
              <div className="text-sm uppercase tracking-[0.4em] text-indigo-200">{phaseLabel}</div>
              <div className="font-display text-6xl">{round.round_number}{roomState.room.status === "guessing" ? ` / ${Math.max(totalRounds, 1)}` : ""}</div>
            </div>
            <div className="bg-white/10 rounded-full px-6 py-3">
              {guesses.length}/{Math.max(eligibleCount, 1)} guesses in
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="bg-white/10 rounded-[2rem] border border-white/20 p-10 backdrop-blur">
              <h2 className="font-display text-5xl mb-6">Associated Words</h2>
              <div className="flex flex-wrap gap-3">
                {associations.map(assoc => (
                  <span
                    key={assoc.id}
                    className="px-4 py-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-lg shadow-lg"
                  >
                    {assoc.value}
                  </span>
                ))}
              </div>

              {round.status === "revealed" && (
                <div className="mt-10 bg-emerald-400/20 border border-emerald-200 rounded-3xl p-6 text-center">
                  <div className="text-sm uppercase tracking-[0.3em] text-emerald-100">Correct Answer</div>
                  <div className="font-display text-5xl mt-4">{currentItem?.name || "Unknown"}</div>
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="bg-white/10 rounded-[2rem] border border-white/20 p-6 backdrop-blur">
                <h3 className="text-sm uppercase tracking-[0.3em] text-indigo-200">Poll Results</h3>
                {round.status === "active" && (
                  <p className="mt-3 text-indigo-100">Waiting for players to vote...</p>
                )}
                {round.status !== "active" && (
                  <div className="mt-4 space-y-4">
                    {tallies.map(tally => (
                      <div key={tally.guess_item_id}>
                        <div className="flex items-center justify-between text-sm font-semibold">
                          <span>{tally.guess_item_name}</span>
                          <span>{tally.vote_count} votes</span>
                        </div>
                        <div className="h-3 bg-white/10 rounded-full overflow-hidden mt-2">
                          <div
                            className="h-full bg-gradient-to-r from-sky-400 to-indigo-400"
                            style={{ width: `${(tally.vote_count / maxVotes) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {tallies.length === 0 && (
                      <p className="text-indigo-100">No votes yet.</p>
                    )}
                  </div>
                )}
              </div>

              {round.status === "revealed" && (
                <div className="bg-white/10 rounded-[2rem] border border-white/20 p-6 backdrop-blur">
                  <h3 className="text-sm uppercase tracking-[0.3em] text-indigo-200">Leaderboard</h3>
                  <div className="mt-4 space-y-3">
                    {[...players].sort((a, b) => b.score - a.score).slice(0, 5).map(player => (
                      <div key={player.id} className="flex items-center justify-between">
                        <span className="font-semibold">{player.nickname}</span>
                        <span className="text-indigo-100 font-bold">{player.score} pts</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {hostUser && (
          <div className="absolute bottom-6 right-6 w-80">
            <HostControls roomState={roomState} currentUser={hostUser} ws={ws} />
          </div>
        )}

      </div>
    );
  }

  if (roomState.room.status === "finished") {
    const rankedPlayers = [...players].sort((a, b) => b.score - a.score);

    return (
      <div className="min-h-screen bg-gradient-to-br from-yellow-500 via-orange-500 to-rose-600 text-slate-900">
        <div className="px-8 py-12 max-w-6xl mx-auto">
          <div className="flex justify-end mb-4">
            <button
              onClick={onLeave}
              className="bg-white/90 text-slate-900 px-4 py-2 rounded-full text-sm font-semibold shadow-lg border border-white/80 hover:bg-white"
            >
              Return to Home
            </button>
          </div>
          <div className="text-center mb-10">
            <h1 className="font-display text-7xl">Rabble Results</h1>
            <p className="text-lg mt-3">Final scores are in!</p>
          </div>

          <Podium players={rankedPlayers} />

          <div className="mt-10 bg-white/80 rounded-[2rem] p-8 shadow-xl">
            <h2 className="text-xl font-bold mb-4">Full Ranking</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {rankedPlayers.map((player, index) => (
                <div key={player.id} className="flex items-center justify-between bg-white rounded-2xl px-4 py-3">
                  <span className="font-semibold">#{index + 1} {player.nickname}</span>
                  <span className="font-bold">{player.score} pts</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
